(function () {
    'use strict';

    var PLUGIN_ID = 'opensubtitles_ru';
    var PLUGIN_TITLE = 'OpenSubtitles';
    var DEFAULT_ADDON = 'https://opensubtitles-v3.strem.io';
    var DEFAULT_LANG = 'rus';

    var LANGUAGES = [
        { code: 'eng', iso2: 'en', name: 'English', aliases: ['english'] },
        { code: 'rus', iso2: 'ru', name: 'Русский', aliases: ['russian'] },
        { code: 'spa', iso2: 'es', name: 'Español', aliases: ['spanish'] },
        { code: 'fre', iso2: 'fr', name: 'Français', aliases: ['fra', 'french'] },
        { code: 'ger', iso2: 'de', name: 'Deutsch', aliases: ['deu', 'german'] },
        { code: 'ita', iso2: 'it', name: 'Italiano', aliases: ['italian'] },
        { code: 'por', iso2: 'pt', name: 'Português', aliases: ['portuguese', 'pob', 'pt-br'] },
        { code: 'pol', iso2: 'pl', name: 'Polski', aliases: ['polish'] },
        { code: 'ukr', iso2: 'uk', name: 'Українська', aliases: ['ukrainian'] },
        { code: 'tur', iso2: 'tr', name: 'Türkçe', aliases: ['turkish'] }
    ];

    if (window.openSubtitlesRuPlugin) return;
    window.openSubtitlesRuPlugin = true;

    if (!window.Lampa) return;

    var Lampa = window.Lampa;
    var network = new Lampa.Reguest();
    var subtitleNetwork = new Lampa.Reguest();
    var activePlayerId = 0;
    var lastPlayerData = null;
    var lastKnownSubs = [];
    var stremioSubs = [];
    var searchState = 'idle';

    var settingsIcon = '<svg width="38" height="38" viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="30" height="22" rx="4" stroke="white" stroke-width="3"/><path d="M9 32h20" stroke="white" stroke-width="3" stroke-linecap="round"/><path d="M11 13h16M11 19h11" stroke="white" stroke-width="3" stroke-linecap="round"/></svg>';

    function storage(name, fallback) {
        return Lampa.Storage.get(name, fallback);
    }

    function storageBool(name, fallback) {
        var value = Lampa.Storage.get(name, fallback ? 'true' : 'false');

        return value === true || value === 'true';
    }

    function notify(text) {
        if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(text);
        else if (Lampa.Bell && Lampa.Bell.push) Lampa.Bell.push({ text: text, icon: settingsIcon });
    }

    function logDebug() {
        if (window.console && console.log) {
            try {
                var args = Array.prototype.slice.call(arguments);
                args.unshift('[OpenSubtitles]');
                console.log.apply(console, args);
            }
            catch (e) {}
        }
    }

    function findLanguage(code) {
        code = (code || '').toLowerCase();

        for (var i = 0; i < LANGUAGES.length; i++) {
            if (LANGUAGES[i].code === code) return LANGUAGES[i];
        }

        return null;
    }

    function selectedLanguage() {
        return findLanguage(storage(PLUGIN_ID + '_lang', DEFAULT_LANG)) || findLanguage(DEFAULT_LANG);
    }

    function matchesLanguage(rawLang, lang) {
        if (!lang) return true;

        var normalized = (rawLang || '').toLowerCase().trim().replace(/_/g, '-');
        var primary = normalized.split('-')[0];

        if (normalized === lang.code || primary === lang.code) return true;
        if (normalized === lang.iso2 || primary === lang.iso2) return true;
        if (normalized === lang.name.toLowerCase()) return true;

        for (var i = 0; i < lang.aliases.length; i++) {
            if (normalized === lang.aliases[i] || primary === lang.aliases[i]) return true;
        }

        return false;
    }

    function addonBase() {
        var value = (storage(PLUGIN_ID + '_addon_url', DEFAULT_ADDON) || DEFAULT_ADDON).trim();

        value = value.replace(/\/manifest\.json$/i, '');
        value = value.replace(/\/+$/, '');

        if (value.indexOf('http') !== 0) value = 'https://' + value;

        return value;
    }

    function languageOptions() {
        var values = {};

        LANGUAGES.forEach(function (lang) {
            values[lang.code] = lang.name;
        });

        return values;
    }

    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID,
            icon: settingsIcon,
            name: PLUGIN_TITLE,
            after: 'player'
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                name: PLUGIN_ID + '_enabled',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Включить поиск субтитров'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                name: PLUGIN_ID + '_lang',
                type: 'select',
                values: languageOptions(),
                default: DEFAULT_LANG
            },
            field: {
                name: 'Язык субтитров'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                name: PLUGIN_ID + '_addon_url',
                type: 'input',
                values: '',
                default: DEFAULT_ADDON,
                placeholder: DEFAULT_ADDON
            },
            field: {
                name: 'Stremio addon URL',
                description: 'По умолчанию используется OpenSubtitles v3: https://opensubtitles-v3.strem.io'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                name: PLUGIN_ID + '_limit',
                type: 'select',
                values: {
                    5: '5',
                    10: '10',
                    15: '15',
                    25: '25',
                    50: '50'
                },
                default: '15'
            },
            field: {
                name: 'Сколько вариантов показывать'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                name: PLUGIN_ID + '_debug',
                type: 'trigger',
                default: false
            },
            field: {
                name: 'Показывать ошибки поиска'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                name: PLUGIN_ID + '_check',
                type: 'button'
            },
            field: {
                name: 'Проверить Stremio addon'
            },
            onChange: function () {
                checkAddon();
            }
        });
    }

    function checkAddon() {
        network.timeout(10000);
        network.silent(addonBase() + '/manifest.json', function (manifest) {
            if (manifest && manifest.resources && manifest.resources.indexOf('subtitles') >= 0) {
                notify(PLUGIN_TITLE + ': Stremio addon доступен');
            }
            else {
                notify(PLUGIN_TITLE + ': addon ответил, но не похож на subtitle-addon');
            }
        }, function (xhr) {
            notify(PLUGIN_TITLE + ': ' + decodeError(xhr));
        });
    }

    function decodeError(xhr) {
        try {
            if (xhr && xhr.responseText) {
                var json = JSON.parse(xhr.responseText);
                return json.message || json.error || 'ошибка запроса';
            }
        }
        catch (e) {}

        if (network && network.errorDecode) {
            try {
                return network.errorDecode(xhr);
            }
            catch (e2) {}
        }

        return 'ошибка запроса';
    }

    function isEnabled() {
        return storageBool(PLUGIN_ID + '_enabled', true);
    }

    function activeCard(data) {
        var activity = Lampa.Activity && Lampa.Activity.active ? Lampa.Activity.active() : {};

        return (data && (data.card || data.movie)) ||
            (activity && (activity.movie || activity.card)) ||
            {};
    }

    function isSeries(card, data) {
        return Boolean(
            (card && (card.name || card.original_name || card.number_of_seasons)) ||
            (data && (data.season || data.episode || data.season_number || data.episode_number))
        );
    }

    function parseEpisode(data) {
        var season = data && (data.season || data.season_number);
        var episode = data && (data.episode || data.episode_number);
        var text = [
            data && data.title,
            data && data.fname,
            data && data.path,
            data && data.url
        ].join(' ');
        var match;

        if (!season || !episode) {
            match = text.match(/[Ss](\d{1,2})[ ._-]*[Ee](\d{1,3})/);
            if (match) {
                season = season || parseInt(match[1], 10);
                episode = episode || parseInt(match[2], 10);
            }
        }

        if (!season || !episode) {
            match = text.match(/(\d{1,2})x(\d{1,3})/i);
            if (match) {
                season = season || parseInt(match[1], 10);
                episode = episode || parseInt(match[2], 10);
            }
        }

        return {
            season: parseInt(season || 0, 10) || 0,
            episode: parseInt(episode || 0, 10) || 0
        };
    }

    function normalizeImdb(imdb) {
        if (!imdb) return '';

        imdb = (imdb + '').trim();
        if (!/^tt\d+/i.test(imdb)) imdb = 'tt' + imdb.replace(/\D/g, '');

        return /^tt\d+/i.test(imdb) ? imdb : '';
    }

    function loadImdbIfNeeded(card, data, done) {
        if (card && card.imdb_id) return done(normalizeImdb(card.imdb_id));
        if (!card || !card.id || !Lampa.TMDB || !Lampa.TMDB.external_imdb_id) return done('');

        Lampa.TMDB.external_imdb_id({
            type: isSeries(card, data) ? 'tv' : 'movie',
            id: card.id
        }, function (imdb) {
            imdb = normalizeImdb(imdb);

            if (imdb && card) card.imdb_id = imdb;

            done(imdb);
        });
    }

    function stremioRequest(card, data, imdb) {
        var episode = parseEpisode(data || {});
        var type = isSeries(card, data) ? 'series' : 'movie';
        var id = imdb;

        if (!id) return null;

        if (type === 'series') {
            if (!episode.season || !episode.episode) return null;

            id += ':' + episode.season + ':' + episode.episode;
        }

        return {
            type: type,
            id: id,
            url: addonBase() + '/subtitles/' + type + '/' + encodeURIComponent(id) + '.json'
        };
    }

    function searchFor(data) {
        var playerId = activePlayerId;
        var card = activeCard(data);

        stremioSubs = [];
        searchState = 'searching';
        installToPanel();

        loadImdbIfNeeded(card, data, function (imdb) {
            if (playerId !== activePlayerId) return;

            var request = stremioRequest(card, data, imdb);

            if (!request) {
                searchState = isSeries(card, data) ? 'no-episode' : 'no-imdb';
                installToPanel();
                return;
            }

            logDebug('search', request.url);

            network.timeout(15000);
            network.silent(request.url, function (json) {
                if (playerId !== activePlayerId) return;

                var rawList = json && json.subtitles ? json.subtitles : [];

                logDebug('addon returned', rawList.length, 'items');

                stremioSubs = mapStremioResults(rawList);

                logDebug('after language filter', stremioSubs.length, 'items for', selectedLanguage().code);

                searchState = stremioSubs.length ? 'ready' : 'empty';
                installToPanel();
            }, function (xhr) {
                if (playerId !== activePlayerId) return;

                stremioSubs = [];
                searchState = 'error';
                installToPanel();

                logDebug('addon error', xhr && xhr.status, decodeError(xhr));

                if (storageBool(PLUGIN_ID + '_debug', false)) notify(PLUGIN_TITLE + ': ' + decodeError(xhr));
            });
        });
    }

    function mapStremioResults(results) {
        var limit = parseInt(storage(PLUGIN_ID + '_limit', '15'), 10) || 15;
        var lang = selectedLanguage();
        var seen = {};
        var mapped = [];

        results.forEach(function (item) {
            var rawLang = (item && (item.lang || item.language || item.SubLanguageID || item.iso639)) || '';
            var url = item && item.url;

            if (!url || !matchesLanguage(rawLang, lang)) return;
            if (seen[url]) return;

            seen[url] = true;

            mapped.push({
                stremio: true,
                source: 'stremio-opensubtitles',
                id: item.id || url,
                url: url,
                lang: lang.iso2,
                langCode: lang.code,
                encoding: item.SubEncoding || item.subEncoding || '',
                match: item.m || '',
                score: item.g || ''
            });
        });

        mapped.sort(function (a, b) {
            var ag = parseInt(a.score || '0', 10) || 0;
            var bg = parseInt(b.score || '0', 10) || 0;

            return bg - ag;
        });

        return mapped.slice(0, limit);
    }

    function normalExistingSubs() {
        var base = [];
        var video = Lampa.PlayerVideo && Lampa.PlayerVideo.video ? Lampa.PlayerVideo.video() : null;
        var tracks = video && video.textTracks ? video.textTracks : [];

        if (lastKnownSubs && lastKnownSubs.length) base = Array.prototype.slice.call(lastKnownSubs);
        else if (tracks && tracks.length) base = Array.prototype.slice.call(tracks);

        return base.filter(function (item) {
            return item && !item.stremio && item.source !== 'stremio-opensubtitles' && item.index !== -1;
        });
    }

    function statusSubtitle(index) {
        var lang = selectedLanguage();
        var text = PLUGIN_TITLE;

        if (searchState === 'searching') text += ': поиск ' + lang.name + '...';
        else if (searchState === 'no-imdb') text += ': нет IMDb ID';
        else if (searchState === 'no-episode') text += ': нет сезона/серии';
        else if (searchState === 'empty') text += ': ' + lang.name + ' не найдены';
        else if (searchState === 'error') text += ': ошибка поиска';
        else return null;

        return {
            stremio: true,
            source: 'stremio-opensubtitles',
            index: index,
            language: lang.iso2,
            label: text,
            title: text,
            selected: false,
            noenter: true,
            ghost: true,
            mode: 'disabled'
        };
    }

    function createSubtitleItem(item, index) {
        var parts = [PLUGIN_TITLE, '#' + item.id];
        var info = [];

        if (item.encoding) info.push(item.encoding);
        if (item.score) info.push('score: ' + item.score);

        var label = parts.join(' / ') + (info.length ? ' / ' + info.join(' / ') : '');
        var sub = {
            stremio: true,
            source: 'stremio-opensubtitles',
            index: index,
            language: item.lang || 'en',
            label: label,
            title: label,
            subtitle: item.url,
            selected: false,
            url: item.url,
            onSelect: function () {
                renderer.select(sub);
            }
        };

        Object.defineProperty(sub, 'mode', {
            configurable: true,
            set: function (value) {
                if (value === 'showing') renderer.select(sub);
                else if (renderer.current === sub) renderer.disable();
            },
            get: function () {
                return renderer.current === sub ? 'showing' : 'disabled';
            }
        });

        return sub;
    }

    function installToPanel() {
        if (!Lampa.PlayerPanel || !Lampa.PlayerPanel.setSubs) return;
        if (!Lampa.Player || !Lampa.Player.opened || !Lampa.Player.opened()) return;

        var base = normalExistingSubs();
        var nextIndex = 0;

        base.forEach(function (item, pos) {
            if (typeof item.index === 'undefined') item.index = pos;
            nextIndex = Math.max(nextIndex, parseInt(item.index, 10) + 1 || pos + 1);
        });

        var mixed = base.slice();

        if (stremioSubs.length) {
            stremioSubs.forEach(function (item) {
                mixed.push(createSubtitleItem(item, nextIndex++));
            });
        }
        else {
            var status = statusSubtitle(nextIndex++);
            if (status) mixed.push(status);
        }

        if (mixed.length) Lampa.PlayerPanel.setSubs(mixed);
    }

    var renderer = {
        current: null,
        cues: [],
        timer: 0,
        loading: false,
        lastText: null,
        select: function (item) {
            var self = this;

            if (self.current === item && (self.loading || self.cues.length)) return;

            self.disable(false);
            self.current = item;
            self.loading = true;
            self.lastText = null;
            item.selected = true;

            showSubtitleText('');

            subtitleNetwork.timeout(20000);
            subtitleNetwork.silent(item.url, function (text) {
                if (self.current !== item) return;

                self.cues = parseSubtitles(text || '');
                self.loading = false;

                if (!self.cues.length) {
                    notify(PLUGIN_TITLE + ': файл субтитров пустой или не распознан');
                    self.disable();
                    return;
                }

                self.start();
            }, function (xhr) {
                if (self.current !== item) return;

                notify(PLUGIN_TITLE + ': ' + decodeError(xhr));
                self.disable();
            }, false, {
                dataType: 'text'
            });
        },
        start: function () {
            var self = this;

            clearInterval(self.timer);
            self.timer = setInterval(function () {
                self.update();
            }, 200);

            self.update();
        },
        update: function () {
            var video = Lampa.PlayerVideo && Lampa.PlayerVideo.video ? Lampa.PlayerVideo.video() : null;
            var shift = parseInt(storage('player_subs_shift_time', '0'), 10) || 0;
            var time = video && typeof video.currentTime === 'number' ? (video.currentTime - shift) * 1000 : 0;
            var text = '';

            if (!this.current || !this.cues.length) return;

            for (var i = 0; i < this.cues.length; i++) {
                if (time >= this.cues[i].start && time <= this.cues[i].end) {
                    text = this.cues[i].text;
                    break;
                }
            }

            if (this.lastText !== text) {
                this.lastText = text;
                showSubtitleText(text);
            }
        },
        disable: function (clearText) {
            clearInterval(this.timer);
            subtitleNetwork.clear();

            this.timer = 0;
            this.cues = [];
            this.loading = false;

            if (this.current) this.current.selected = false;
            this.current = null;
            this.lastText = null;

            if (clearText !== false) showSubtitleText('');
        },
        destroy: function () {
            this.disable();
        }
    };

    function subtitleBox() {
        if (!Lampa.PlayerVideo || !Lampa.PlayerVideo.render) return $();

        return Lampa.PlayerVideo.render().find('.player-video__subtitles > div');
    }

    function showSubtitleText(text) {
        var box = subtitleBox();

        if (!box.length) return;

        box.html(text || '&nbsp;').css({
            display: text ? 'inline-block' : 'none'
        });
    }

    function parseSubtitles(raw) {
        raw = (raw || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        return parseByBlocks(raw, /^\s*WEBVTT/i.test(raw));
    }

    function parseByBlocks(raw, isVtt) {
        var blocks = raw.split(/\n{2,}/);
        var cues = [];

        blocks.forEach(function (block) {
            var lines = block.split('\n').map(function (line) {
                return line.trim();
            }).filter(Boolean);
            var timeIndex = -1;
            var timeMatch;

            if (!lines.length) return;
            if (isVtt && /^(WEBVTT|NOTE|STYLE|REGION)/i.test(lines[0])) return;

            for (var i = 0; i < lines.length; i++) {
                timeMatch = lines[i].match(/((?:\d{1,2}:)?\d{2}:\d{2}[\.,]\d{3})\s+-->\s+((?:\d{1,2}:)?\d{2}:\d{2}[\.,]\d{3})/);
                if (timeMatch) {
                    timeIndex = i;
                    break;
                }
            }

            if (timeIndex < 0 || !timeMatch) return;

            cues.push({
                start: timeToMs(timeMatch[1]),
                end: timeToMs(timeMatch[2]),
                text: cleanSubtitleText(lines.slice(timeIndex + 1).join('\n'))
            });
        });

        return cues.filter(function (cue) {
            return cue.end > cue.start && cue.text;
        });
    }

    function timeToMs(value) {
        var parts = value.replace(',', '.').split(':');
        var sec = parts.pop().split('.');
        var seconds = parseInt(sec[0], 10) || 0;
        var ms = parseInt((sec[1] || '0').slice(0, 3), 10) || 0;
        var minutes = parseInt(parts.pop() || '0', 10) || 0;
        var hours = parseInt(parts.pop() || '0', 10) || 0;

        return hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
    }

    function cleanSubtitleText(text) {
        return escapeHtml(
            (text || '')
                .replace(/\\N/g, '\n')
                .replace(/\{\\[^}]+\}/g, '')
                .replace(/<[^>]+>/g, '')
                .trim()
        ).replace(/\n/g, '<br>');
    }

    function escapeHtml(text) {
        return (text || '').replace(/[&<>"']/g, function (char) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            }[char];
        });
    }

    function startPlayer(data) {
        if (!isEnabled()) return;

        activePlayerId++;
        lastPlayerData = data || {};
        lastKnownSubs = normalExistingSubs();
        stremioSubs = [];
        searchState = 'idle';

        renderer.destroy();

        setTimeout(function () {
            if (!Lampa.Player || !Lampa.Player.opened || !Lampa.Player.opened()) return;

            lastKnownSubs = normalExistingSubs();
            searchFor(lastPlayerData);
        }, 600);
    }

    function destroyPlayer() {
        activePlayerId++;
        lastKnownSubs = [];
        lastPlayerData = null;
        stremioSubs = [];
        searchState = 'idle';
        renderer.destroy();
        network.clear();
    }

    addSettings();

    Lampa.Player.listener.follow('ready', startPlayer);
    Lampa.Player.listener.follow('destroy', destroyPlayer);

    if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
        Lampa.PlayerVideo.listener.follow('subs', function (event) {
            if (event && event.subs) {
                lastKnownSubs = Array.prototype.slice.call(event.subs).filter(function (item) {
                    return item && !item.stremio && item.source !== 'stremio-opensubtitles';
                });

                if (stremioSubs.length || searchState !== 'idle') {
                    setTimeout(installToPanel, 50);
                }
            }
        });
    }
})();
