(function () {
    'use strict';

    var PLUGIN_ID = 'opensubtitles_ru';
    var PLUGIN_TITLE = 'OpenSubtitles';
    var DEFAULT_LANG = 'rus';

    var ADDONS = [
        'https://opensubtitles-v3.strem.io'
    ];

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
    var injectingSubs = false;
    var nativeSubsSeen = false;
    var manualOverride = null;
    var pendingDisableId = 0;
    var SHIFT_KEY = PLUGIN_ID + '_shift_ms';

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

    function addonBases() {
        return ADDONS.slice();
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

    function stremioRequestId(card, data, imdb) {
        var type = isSeries(card, data) ? 'series' : 'movie';
        var id = imdb;

        if (manualOverride && manualOverride.type) type = manualOverride.type;
        if (!id) return null;

        if (type === 'series') {
            var season = manualOverride && manualOverride.season;
            var episode = manualOverride && manualOverride.episode;

            if (!season || !episode) {
                var auto = parseEpisode(data || {});
                season = season || auto.season;
                episode = episode || auto.episode;
            }

            if (!season || !episode) return null;
            id += ':' + season + ':' + episode;
        }

        return { type: type, id: id };
    }

    function buildAddonUrl(base, type, id) {
        return base + '/subtitles/' + type + '/' + encodeURIComponent(id) + '.json';
    }

    function searchFor(data) {
        var playerId = activePlayerId;
        var card = activeCard(data);

        stremioSubs = [];
        searchState = 'searching';
        installToPanel();

        loadImdbIfNeeded(card, data, function (imdb) {
            if (playerId !== activePlayerId) return;

            var request = stremioRequestId(card, data, imdb);

            if (!request) {
                searchState = isSeries(card, data) ? 'no-episode' : 'no-imdb';
                installToPanel();
                return;
            }

            var bases = addonBases();
            var pending = bases.length;
            var rawList = [];
            var anySuccess = false;
            var lastError = null;

            logDebug('search', request.type, request.id, 'across', bases.length, 'addons');

            bases.forEach(function (base) {
                var url = buildAddonUrl(base, request.type, request.id);
                var net = new Lampa.Reguest();

                net.timeout(15000);
                net.silent(url, function (json) {
                    if (playerId !== activePlayerId) return;

                    anySuccess = true;
                    var items = json && json.subtitles ? json.subtitles : [];

                    items.forEach(function (item) { item._addon = base; });
                    rawList = rawList.concat(items);

                    logDebug('addon', base, 'returned', items.length);

                    if (--pending === 0) finalize();
                }, function (xhr) {
                    if (playerId !== activePlayerId) return;

                    lastError = xhr;
                    logDebug('addon error', base, xhr && xhr.status);

                    if (--pending === 0) finalize();
                });
            });

            function finalize() {
                stremioSubs = mapStremioResults(rawList);

                logDebug('merged', rawList.length, '→ filtered', stremioSubs.length, 'for', selectedLanguage().code);

                if (!anySuccess) searchState = 'error';
                else searchState = stremioSubs.length ? 'ready' : 'empty';

                installToPanel();

                if (!anySuccess && lastError && storageBool(PLUGIN_ID + '_debug', false)) {
                    notify(PLUGIN_TITLE + ': ' + decodeError(lastError));
                }
            }
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

    function isOurSub(item) {
        return item && (item.stremio || item.source === 'stremio-opensubtitles');
    }

    function normalExistingSubs() {
        var base = [];
        var video = Lampa.PlayerVideo && Lampa.PlayerVideo.video ? Lampa.PlayerVideo.video() : null;
        var tracks = video && (video.customSubs || video.textTracks) || [];

        if (lastKnownSubs && lastKnownSubs.length) base = Array.prototype.slice.call(lastKnownSubs);
        else if (tracks && tracks.length) base = Array.prototype.slice.call(tracks);

        return base.filter(function (item) {
            return item && !isOurSub(item) && item.index !== -1;
        });
    }

    function actionsItem(index) {
        var label = '⚙ ' + PLUGIN_TITLE;
        var item = {
            stremio: true,
            source: 'stremio-opensubtitles',
            isPicker: true,
            index: index,
            language: '',
            label: label,
            title: label,
            selected: false,
            onSelect: function () { openActionsMenu(); }
        };

        Object.defineProperty(item, 'mode', {
            configurable: true,
            set: function (value) {
                if (value === 'showing') {
                    pendingDisableId++;
                    openActionsMenu();
                }
            },
            get: function () { return 'disabled'; }
        });

        return item;
    }

    function openActionsMenu() {
        if (!Lampa.Select || !Lampa.Select.show) return;

        var items = [];

        if (isSeries(activeCard(lastPlayerData), lastPlayerData)) {
            items.push({ title: 'Поиск по другой серии', method: 'episode' });
        }

        items.push({ title: 'Задержка субтитров', subtitle: formatShiftLabel(currentShiftMs()), method: 'shift' });

        Lampa.Select.show({
            title: PLUGIN_TITLE,
            items: items,
            nohide: true,
            onBack: function () {},
            onSelect: function (a) {
                if (a.method === 'episode') promptManualOverride();
                else if (a.method === 'shift') promptShiftDelay();
            }
        });
    }

    function rangeItems(count, current) {
        var items = [];
        for (var i = 1; i <= count; i++) {
            items.push({ title: String(i), value: i, selected: i === current });
        }
        return items;
    }

    function promptManualOverride() {
        if (!Lampa.Select || !Lampa.Select.show) return;

        var card = activeCard(lastPlayerData);
        var auto = parseEpisode(lastPlayerData || {});
        var currentSeason = (manualOverride && manualOverride.season) || auto.season || 1;
        var currentEpisode = (manualOverride && manualOverride.episode) || auto.episode || 1;
        var maxSeason = Math.max(card && card.number_of_seasons || 0, 25, currentSeason);
        var maxEpisode = Math.max(currentEpisode + 50, 100);

        Lampa.Select.show({
            title: 'Выберите сезон',
            items: rangeItems(maxSeason, currentSeason),
            nohide: true,
            onBack: function () { openActionsMenu(); },
            onSelect: function (seasonItem) {
                Lampa.Select.show({
                    title: 'Сезон ' + seasonItem.value + ' — выберите серию',
                    items: rangeItems(maxEpisode, currentEpisode),
                    nohide: true,
                    onBack: function () { promptManualOverride(); },
                    onSelect: function (episodeItem) {
                        manualOverride = {
                            type: 'series',
                            season: seasonItem.value,
                            episode: episodeItem.value
                        };

                        logDebug('manual override', manualOverride);

                        if (lastPlayerData) searchFor(lastPlayerData);
                    }
                });
            }
        });
    }

    function currentShiftMs() {
        return parseInt(storage(SHIFT_KEY, '0'), 10) || 0;
    }

    function formatShiftLabel(ms) {
        if (!ms) return '0';
        var sign = ms > 0 ? '+' : '−';
        var abs = Math.abs(ms);
        var sec = abs / 1000;
        return sign + (sec % 1 === 0 ? sec : sec.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + ' с';
    }

    function promptShiftDelay() {
        if (!Lampa.Select || !Lampa.Select.show) return;

        var current = currentShiftMs();
        var stepsMs = [-5000, -3000, -2000, -1000, -500, -250, -100, 0, 100, 250, 500, 1000, 2000, 3000, 5000];

        var items = stepsMs.map(function (ms) {
            return {
                title: ms === 0 ? '0' : (ms > 0 ? '+' : '−') + Math.abs(ms / 1000) + ' с',
                value: ms,
                selected: ms === current
            };
        });

        Lampa.Select.show({
            title: 'Задержка (текущая: ' + formatShiftLabel(current) + ')',
            items: items,
            nohide: true,
            onBack: function () { openActionsMenu(); },
            onSelect: function (a) {
                Lampa.Storage.set(SHIFT_KEY, a.value);
                logDebug('shift set to', a.value, 'ms');
                promptShiftDelay();
            }
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
            url: item.url,
            onSelect: function () {
                renderer.select(sub);
            }
        };

        Object.defineProperty(sub, 'selected', {
            configurable: true,
            set: function () {},
            get: function () {
                return Boolean(renderer.current && renderer.current.url === sub.url);
            }
        });

        Object.defineProperty(sub, 'mode', {
            configurable: true,
            set: function (value) {
                if (value === 'showing') {
                    pendingDisableId++;
                    renderer.select(sub);
                }
                else if (renderer.current && renderer.current.url === sub.url) {
                    var disableId = ++pendingDisableId;
                    setTimeout(function () {
                        if (disableId === pendingDisableId && renderer.current && renderer.current.url === sub.url) {
                            renderer.disable();
                        }
                    }, 50);
                }
            },
            get: function () {
                return renderer.current && renderer.current.url === sub.url ? 'showing' : 'disabled';
            }
        });

        return sub;
    }

    function dispatchSubs(list) {
        if (!Lampa.PlayerVideo || !Lampa.PlayerVideo.listener) return;

        injectingSubs = true;

        try {
            Lampa.PlayerVideo.listener.send('subs', { subs: list });
        }
        catch (e) {
            logDebug('dispatch error', e && e.message);
        }

        if (Lampa.PlayerPanel && Lampa.PlayerPanel.setSubs) {
            try { Lampa.PlayerPanel.setSubs(list); } catch (e) {}
        }

        injectingSubs = false;
    }

    function hookPanelSetSubs() {
        if (!Lampa.PlayerPanel || !Lampa.PlayerPanel.setSubs) return;
        if (Lampa.PlayerPanel._opensubtitles_hooked) return;

        var original = Lampa.PlayerPanel.setSubs;

        Lampa.PlayerPanel._opensubtitles_hooked = true;
        Lampa.PlayerPanel.setSubs = function (list) {
            var arr = Array.prototype.slice.call(list || []);
            var nonOurs = arr.filter(function (item) { return item && !isOurSub(item); });
            var hasOurs = arr.length !== nonOurs.length;

            if (!injectingSubs && !hasOurs) {
                lastKnownSubs = nonOurs;
                if (nonOurs.length) nativeSubsSeen = true;
                logDebug('hook setSubs: captured', nonOurs.length, 'native subs');
            }

            var result = original.call(this, list);

            if (!injectingSubs && !hasOurs && nonOurs.length && (stremioSubs.length || searchState !== 'idle')) {
                setTimeout(installToPanel, 0);
            }

            return result;
        };
    }

    function installToPanel() {
        if (!Lampa.Player || !Lampa.Player.opened || !Lampa.Player.opened()) return;

        var base = normalExistingSubs();
        var nextIndex = 0;

        base.forEach(function (item, pos) {
            if (typeof item.index === 'undefined') item.index = pos;
            nextIndex = Math.max(nextIndex, parseInt(item.index, 10) + 1 || pos + 1);
        });

        var hasResults = stremioSubs.length > 0;
        var canAugment = nativeSubsSeen && base.length > 0;

        if (!hasResults && !canAugment) {
            logDebug('skip dispatch: nothing to add (native=' + base.length + ' seen=' + nativeSubsSeen + ' state=' + searchState + ')');
            return;
        }

        var rendererActive = !!renderer.current;
        if (rendererActive) {
            base.forEach(function (item) {
                try { item.selected = false; } catch (e) {}
            });
        }

        var mixed = base.slice();

        if (hasResults) {
            stremioSubs.forEach(function (item) {
                mixed.push(createSubtitleItem(item, nextIndex++));
            });
        }
        else {
            var status = statusSubtitle(nextIndex++);
            if (status) mixed.push(status);
        }

        mixed.push(actionsItem(nextIndex++));

        logDebug('install panel: native=' + base.length + ' stremio=' + stremioSubs.length + ' state=' + searchState);

        if (mixed.length) dispatchSubs(mixed);
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
            var shiftMs = currentShiftMs();
            var time = video && typeof video.currentTime === 'number' ? video.currentTime * 1000 - shiftMs : 0;
            var text = '';

            if (!this.current || !this.cues.length) return;

            for (var i = 0; i < this.cues.length; i++) {
                if (time >= this.cues[i].start && time <= this.cues[i].end) {
                    text = this.cues[i].text;
                    break;
                }
            }

            this.lastText = text;
            showSubtitleText(text);
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

    function showSubtitleText(text) {
        var video = Lampa.PlayerVideo && Lampa.PlayerVideo.video ? Lampa.PlayerVideo.video() : null;
        if (!video || typeof video.dispatchEvent !== 'function') return;

        try {
            var event = new Event('subtitle');
            event.text = text || '';
            video.dispatchEvent(event);
        }
        catch (e) {
            logDebug('subtitle dispatch error', e && e.message);
        }
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
        lastKnownSubs = [];
        stremioSubs = [];
        searchState = 'idle';
        nativeSubsSeen = false;
        manualOverride = null;

        renderer.destroy();

        setTimeout(function () {
            if (!Lampa.Player || !Lampa.Player.opened || !Lampa.Player.opened()) return;

            searchFor(lastPlayerData);
        }, 600);
    }

    function destroyPlayer() {
        activePlayerId++;
        lastKnownSubs = [];
        lastPlayerData = null;
        stremioSubs = [];
        searchState = 'idle';
        nativeSubsSeen = false;
        manualOverride = null;
        renderer.destroy();
        network.clear();
    }

    addSettings();
    hookPanelSetSubs();

    Lampa.Player.listener.follow('ready', function (data) {
        hookPanelSetSubs();
        startPlayer(data);
    });
    Lampa.Player.listener.follow('destroy', destroyPlayer);

    if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
        Lampa.PlayerVideo.listener.follow('subs', function (event) {
            if (injectingSubs) return;
            if (!event || !event.subs) return;

            lastKnownSubs = Array.prototype.slice.call(event.subs).filter(function (item) {
                return item && !isOurSub(item);
            });
            nativeSubsSeen = true;

            logDebug('captured native subs', lastKnownSubs.length);

            if (stremioSubs.length || searchState !== 'idle') {
                setTimeout(installToPanel, 0);
            }
        });
    }
})();
