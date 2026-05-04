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

    var PLUGIN_VERSION = 'v10-original-title-inline';
    var EXTERNAL_SEARCH_TIMEOUT = 3500;

    if (!window.Lampa) return;

    if (window.console && window.console.log) {
        try { console.log('[OpenSubtitles]', 'plugin source loaded', PLUGIN_VERSION); } catch (e) {}
    }

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
    var actionWasPicked = false;
    var latestPanelSubs = [];

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
                name: PLUGIN_ID + '_android_external',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Android: передавать во внешние плееры'
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

    function buildRestUrl(type, id, langCode) {
        var parts = id.split(':');
        var imdbDigits = parts[0].replace(/^tt/i, '');

        if (type === 'series' && parts.length >= 3) {
            return 'https://rest.opensubtitles.org/search/episode-' + parts[2] +
                '/imdbid-' + imdbDigits +
                '/season-' + parts[1] +
                '/sublanguageid-' + langCode;
        }
        return 'https://rest.opensubtitles.org/search/imdbid-' + imdbDigits + '/sublanguageid-' + langCode;
    }

    function mapRestItems(items) {
        if (!items || !items.length) return [];
        var mapped = [];
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (!item || !item.IDSubtitleFile) continue;
            mapped.push({
                id: item.IDSubtitle || item.IDSubtitleFile,
                url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/' + item.IDSubtitleFile,
                lang: item.SubLanguageID || '',
                SubEncoding: 'utf-8',
                m: 'i',
                g: String(parseInt(item.SubDownloadsCnt, 10) || 0)
            });
        }
        return mapped;
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
            var lang = selectedLanguage();
            var pending = bases.length + 1;
            var rawList = [];
            var anySuccess = false;
            var lastError = null;

            logDebug('search', request.type, request.id, 'across', bases.length, 'addons + rest.opensubtitles.org');

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

            (function fetchRest() {
                var url = buildRestUrl(request.type, request.id, lang.code);
                var net = new Lampa.Reguest();

                net.timeout(15000);
                net.silent(url, function (items) {
                    if (playerId !== activePlayerId) return;

                    anySuccess = true;
                    var mapped = mapRestItems(items);
                    rawList = rawList.concat(mapped);

                    logDebug('rest.opensubtitles.org returned', mapped.length, 'items for', lang.code);

                    if (--pending === 0) finalize();
                }, function (xhr) {
                    if (playerId !== activePlayerId) return;

                    lastError = lastError || xhr;
                    logDebug('rest.opensubtitles.org error', xhr && xhr.status);

                    if (--pending === 0) finalize();
                });
            })();

            function finalize() {
                stremioSubs = mapStremioResults(rawList);

                logDebug('merged', rawList.length, '→ filtered', stremioSubs.length, 'for', selectedLanguage().code);

                if (!anySuccess) searchState = 'error';
                else searchState = stremioSubs.length ? 'ready' : 'empty';

                installToPanel();

                if (manualOverride) {
                    if (stremioSubs.length) notify('Найдено ' + stremioSubs.length + ' субтитров');
                    else if (!anySuccess) notify(PLUGIN_TITLE + ': ошибка поиска');
                    else notify(selectedLanguage().name + ' не найдены для S' + manualOverride.season + 'E' + manualOverride.episode);
                }
                else if (!anySuccess && lastError && storageBool(PLUGIN_ID + '_debug', false)) {
                    notify(PLUGIN_TITLE + ': ' + decodeError(lastError));
                }
            }
        });
    }

    function searchExternalSubs(data, done) {
        var card = activeCard(data);
        var finished = false;
        var nets = [];
        var timer = setTimeout(function () {
            finish([], 'timeout');
        }, EXTERNAL_SEARCH_TIMEOUT);

        function finish(list, state) {
            if (finished) return;

            finished = true;
            clearTimeout(timer);

            nets.forEach(function (net) {
                try { net.clear(); } catch (e) {}
            });

            done(list || [], state || 'empty');
        }

        loadImdbIfNeeded(card, data, function (imdb) {
            if (finished) return;

            var savedManualOverride = manualOverride;
            var request;

            try {
                manualOverride = null;
                request = stremioRequestId(card, data, imdb);
            }
            finally {
                manualOverride = savedManualOverride;
            }

            if (!request) {
                finish([], isSeries(card, data) ? 'no-episode' : 'no-imdb');
                return;
            }

            var bases = addonBases();
            var lang = selectedLanguage();
            var pending = bases.length + 1;
            var rawList = [];
            var anySuccess = false;

            function finalize() {
                var mapped = mapStremioResults(rawList);

                finish(mapped, anySuccess ? (mapped.length ? 'ready' : 'empty') : 'error');
            }

            logDebug('external android: search', request.type, request.id, 'across', bases.length, 'addons + rest.opensubtitles.org');

            bases.forEach(function (base) {
                var url = buildAddonUrl(base, request.type, request.id);
                var net = new Lampa.Reguest();

                nets.push(net);
                net.timeout(EXTERNAL_SEARCH_TIMEOUT);
                net.silent(url, function (json) {
                    if (finished) return;

                    anySuccess = true;
                    rawList = rawList.concat(json && json.subtitles ? json.subtitles : []);

                    if (--pending === 0) finalize();
                }, function () {
                    if (finished) return;

                    if (--pending === 0) finalize();
                });
            });

            (function fetchRest() {
                var url = buildRestUrl(request.type, request.id, lang.code);
                var net = new Lampa.Reguest();

                nets.push(net);
                net.timeout(EXTERNAL_SEARCH_TIMEOUT);
                net.silent(url, function (items) {
                    if (finished) return;

                    anySuccess = true;
                    rawList = rawList.concat(mapRestItems(items));

                    if (--pending === 0) finalize();
                }, function () {
                    if (finished) return;

                    if (--pending === 0) finalize();
                });
            })();
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
                lang: lang.code,
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

    function normalizeExternalSubtitle(item) {
        var url = typeof item === 'string' ? item : item && (item.url || item.src);

        if (!url) return null;

        return {
            url: url,
            label: item && (item.label || item.title || item.name) || PLUGIN_TITLE,
            language: item && (item.language || item.lang) || ''
        };
    }

    function externalSubtitleItem(item, index, total) {
        var lang = selectedLanguage();
        var label = PLUGIN_TITLE + ' ' + lang.name;

        if (total > 1) label += ' #' + (index + 1);

        return {
            url: item.url,
            label: label,
            language: item.lang || lang.code
        };
    }

    function mergeSubtitleLists(existing, additions) {
        var result = [];
        var seen = {};

        (Array.isArray(existing) ? existing : []).forEach(function (item) {
            var sub = normalizeExternalSubtitle(item);

            if (!sub || seen[sub.url]) return;

            seen[sub.url] = true;
            result.push(sub);
        });

        additions.forEach(function (item) {
            var sub = normalizeExternalSubtitle(item);

            if (!sub || seen[sub.url]) return;

            seen[sub.url] = true;
            result.push(sub);
        });

        return result;
    }

    function normalizeVideoUrl(url) {
        return (url || '').replace('&preload', '&play');
    }

    function attachExternalSubtitles(data, items) {
        if (!data || !items || !items.length) return 0;

        var additions = items.map(function (item, index) {
            return externalSubtitleItem(item, index, items.length);
        });
        var playlist = Array.isArray(data.playlist) ? data.playlist : [];
        var currentUrl = normalizeVideoUrl(data.url);
        var attachedToPlaylist = false;

        data.subtitles = mergeSubtitleLists(data.subtitles, additions);

        playlist.forEach(function (item) {
            if (!item || !item.url) return;

            if (normalizeVideoUrl(item.url) === currentUrl) {
                item.subtitles = mergeSubtitleLists(item.subtitles, additions);
                attachedToPlaylist = true;
            }
        });

        if (!attachedToPlaylist && playlist.length === 1) {
            playlist[0].subtitles = mergeSubtitleLists(playlist[0].subtitles, additions);
        }

        return additions.length;
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

    function disabledItem() {
        var item = {
            title: 'Отключено',
            index: -1,
            stremio: true,
            source: 'stremio-opensubtitles',
            isDisabled: true
        };

        Object.defineProperty(item, 'selected', {
            configurable: true,
            set: function () {},
            get: function () {
                if (renderer.current) return false;
                for (var i = 0; i < lastKnownSubs.length; i++) {
                    try {
                        if (lastKnownSubs[i] && lastKnownSubs[i].selected === true) return false;
                    }
                    catch (e) {}
                }
                return true;
            }
        });

        Object.defineProperty(item, 'mode', {
            configurable: true,
            set: function (value) {
                if (value === 'showing' && renderer.current) {
                    logDebug('disabled picked: stopping renderer');
                    renderer.disable();
                }
            },
            get: function () { return ''; }
        });

        return item;
    }

    function separatorItem(title) {
        return {
            title: title,
            separator: true,
            index: -1,
            stremio: true,
            source: 'stremio-opensubtitles',
            selected: false
        };
    }

    function searchItem() {
        var item = {
            title: 'Поиск по другой серии',
            index: -1,
            stremio: true,
            source: 'stremio-opensubtitles',
            isPicker: true,
            onSelect: function () {
                if (renderer.current && Lampa.PlayerVideo && Lampa.PlayerVideo.subsview) {
                    Lampa.PlayerVideo.subsview(true);
                }
                promptManualOverride();
            }
        };

        Object.defineProperty(item, 'selected', {
            configurable: true,
            get: function () { return false; },
            set: function () {}
        });

        Object.defineProperty(item, 'mode', {
            configurable: true,
            set: function (value) {
                if (value === 'showing') {
                    actionWasPicked = true;
                    setTimeout(function () { actionWasPicked = false; }, 200);
                }
            },
            get: function () { return 'disabled'; }
        });

        return item;
    }

    function rangeItems(count, current) {
        var items = [];
        for (var i = 1; i <= count; i++) {
            items.push({ title: String(i), value: i, selected: i === current });
        }
        return items;
    }

    function returnToController(name) {
        if (!Lampa.Controller) return;

        var candidates = [name, 'player_panel', 'player', 'content'].filter(function (n) {
            return n && n !== 'select';
        });

        for (var i = 0; i < candidates.length; i++) {
            var target = candidates[i];
            try {
                Lampa.Controller.toggle(target);
            }
            catch (e) {
                logDebug('Controller.toggle threw for', target, e && e.message);
                continue;
            }

            try {
                var nowName = Lampa.Controller.enabled && Lampa.Controller.enabled().name;
                if (nowName && nowName !== 'select') return;
            }
            catch (e) {}
        }

        logDebug('returnToController: no target accepted, last try was', candidates[candidates.length - 1]);
    }

    function captureController() {
        if (!Lampa.Controller || !Lampa.Controller.enabled) return 'player_panel';

        try {
            var current = Lampa.Controller.enabled();
            var name = current && current.name;
            if (name && name !== 'select') return name;
        }
        catch (e) {}

        if (Lampa.Platform && Lampa.Platform.screen && Lampa.Platform.screen('mobile')) return 'player';
        return 'player_panel';
    }

    function promptManualOverride(prevController) {
        if (!Lampa.Select || !Lampa.Select.show) return;

        if (!prevController) prevController = captureController();

        var card = activeCard(lastPlayerData);
        var auto = parseEpisode(lastPlayerData || {});
        var currentSeason = (manualOverride && manualOverride.season) || auto.season || 1;
        var currentEpisode = (manualOverride && manualOverride.episode) || auto.episode || 1;
        var maxSeason = Math.max(card && card.number_of_seasons || 0, 25, currentSeason);
        var maxEpisode = Math.max(currentEpisode + 50, 100);

        Lampa.Select.show({
            title: 'Выберите сезон',
            items: rangeItems(maxSeason, currentSeason),
            onBack: function () { returnToController(prevController); },
            onSelect: function (seasonItem) {
                Lampa.Select.show({
                    title: 'Сезон ' + seasonItem.value + ' — выберите серию',
                    items: rangeItems(maxEpisode, currentEpisode),
                    onBack: function () { promptManualOverride(prevController); },
                    onSelect: function (episodeItem) {
                        returnToController(prevController);

                        manualOverride = {
                            type: 'series',
                            season: seasonItem.value,
                            episode: episodeItem.value
                        };

                        logDebug('manual override', manualOverride);

                        notify('Поиск ' + selectedLanguage().name + ' для S' + seasonItem.value + 'E' + episodeItem.value + '...');

                        if (lastPlayerData) searchFor(lastPlayerData);
                    }
                });
            }
        });
    }

    function statusSubtitle(index) {
        var lang = selectedLanguage();
        var text = PLUGIN_TITLE;

        if (searchState === 'searching') text += ': поиск ' + lang.name + '...';
        else return null;

        return {
            stremio: true,
            source: 'stremio-opensubtitles',
            index: index,
            language: lang.code,
            label: text,
            title: text,
            selected: false,
            noenter: true,
            ghost: true,
            mode: 'disabled'
        };
    }

    function createSubtitleItem(item, index) {
        var sub = {
            stremio: true,
            source: 'stremio-opensubtitles',
            index: index,
            language: item.lang || selectedLanguage().code,
            label: PLUGIN_TITLE,
            title: PLUGIN_TITLE,
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
                if (value === 'showing') renderer.select(sub);
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
        if (Lampa.PlayerPanel.setSubs._opensub_version === PLUGIN_VERSION) return;

        var original = Lampa.PlayerPanel.setSubs;

        var wrapper = function (list) {
            var arr = Array.prototype.slice.call(list || []);
            latestPanelSubs = arr;

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

        wrapper._opensub_version = PLUGIN_VERSION;
        Lampa.PlayerPanel.setSubs = wrapper;

        logDebug('hookPanelSetSubs: installed', PLUGIN_VERSION);
    }

    function hookVideoSubsview() {
        if (!Lampa.PlayerVideo || typeof Lampa.PlayerVideo.subsview !== 'function') {
            logDebug('hookVideoSubsview: Lampa.PlayerVideo.subsview not available');
            return;
        }
        if (Lampa.PlayerVideo.subsview._opensub_version === PLUGIN_VERSION) return;

        var original = Lampa.PlayerVideo.subsview;

        var wrapper = function (status) {
            logDebug('Lampa.PlayerVideo.subsview status=' + status + ' actionPicked=' + actionWasPicked + ' rendererActive=' + (!!renderer.current));

            if (status === false && renderer.current && !actionWasPicked) {
                var picked = null;
                for (var i = 0; i < latestPanelSubs.length; i++) {
                    try {
                        if (latestPanelSubs[i] && latestPanelSubs[i].selected === true) {
                            picked = latestPanelSubs[i];
                            break;
                        }
                    }
                    catch (e) {}
                }

                if (picked && !picked.isDisabled && picked.url && picked.url === renderer.current.url) {
                    logDebug('Lampa.PlayerVideo.subsview: overriding to true (our sub active)');
                    status = true;
                }
                else if (picked && !picked.isDisabled && picked.url && picked.url !== renderer.current.url) {
                    logDebug('Lampa.PlayerVideo.subsview: different sub picked, disabling our renderer');
                    renderer.disable();
                }
                else if (!picked || picked.isDisabled) {
                    logDebug('Lampa.PlayerVideo.subsview: nothing or disabled picked, disabling our renderer');
                    renderer.disable();
                }
            }

            return original.call(this, status);
        };

        wrapper._opensub_version = PLUGIN_VERSION;
        Lampa.PlayerVideo.subsview = wrapper;

        logDebug('hookVideoSubsview: installed', PLUGIN_VERSION);
    }

    function hookSubsviewSignal() {
        if (!Lampa.PlayerPanel || !Lampa.PlayerPanel.listener) {
            logDebug('hookSubsviewSignal: no Lampa.PlayerPanel.listener available');
            return;
        }

        var bus = Lampa.PlayerPanel.listener;
        var prev = Lampa.PlayerPanel._opensub_subsview_listener;

        if (prev && typeof bus.remove === 'function') {
            try { bus.remove('subsview', prev); }
            catch (e) {}
        }

        var listenerFn = function (event) {
            logDebug('subsview event fired status=' + (event && event.status) + ' actionPicked=' + actionWasPicked);

            if (actionWasPicked) return;

            setTimeout(function () {
                if (!renderer.current) {
                    logDebug('subsview check: no renderer.current');
                    return;
                }

                var picked = null;
                for (var i = 0; i < latestPanelSubs.length; i++) {
                    try {
                        if (latestPanelSubs[i] && latestPanelSubs[i].selected === true) {
                            picked = latestPanelSubs[i];
                            break;
                        }
                    }
                    catch (e) {}
                }

                if (!picked || picked.isDisabled) {
                    logDebug('subsview disable: nothing selected or disabled item picked');
                    renderer.disable();
                }
                else if (picked.url && picked.url === renderer.current.url) {
                    logDebug('subsview keep: our sub still picked');
                }
                else {
                    logDebug('subsview disable: different item picked', picked.title);
                    renderer.disable();
                }
            }, 0);
        };

        bus.follow('subsview', listenerFn);
        Lampa.PlayerPanel._opensub_subsview_listener = listenerFn;
        Lampa.PlayerPanel._opensub_subsview_version = PLUGIN_VERSION;

        logDebug('hookSubsviewSignal: installed');
    }

    function hookAndroidOpenPlayer() {
        if (!Lampa.Android || typeof Lampa.Android.openPlayer !== 'function') {
            logDebug('hookAndroidOpenPlayer: Lampa.Android.openPlayer not available');
            return;
        }
        if (Lampa.Android.openPlayer._opensub_version === PLUGIN_VERSION) return;

        var original = Lampa.Android.openPlayer._opensub_original || Lampa.Android.openPlayer;

        var wrapper = function (link, data) {
            var self = this;
            var payload = data;

            if (!isEnabled() ||
                !storageBool(PLUGIN_ID + '_android_external', true) ||
                !Lampa.Platform ||
                !Lampa.Platform.is ||
                !Lampa.Platform.is('android') ||
                typeof window.AndroidJS === 'undefined' ||
                !payload ||
                typeof payload !== 'object') {
                return original.apply(self, arguments);
            }

            if (!payload.url && link) payload.url = link;

            logDebug('external android: preparing subtitles for', payload.title || payload.path || payload.url);

            searchExternalSubs(payload, function (items, state) {
                if (items && items.length) {
                    var count = attachExternalSubtitles(payload, items);
                    logDebug('external android: attached', count, 'subs');
                }
                else {
                    logDebug('external android: launch without subtitles, state=' + state);
                }

                original.call(self, link, payload);
            });
        };

        wrapper._opensub_version = PLUGIN_VERSION;
        wrapper._opensub_original = original;
        Lampa.Android.openPlayer = wrapper;

        logDebug('hookAndroidOpenPlayer: installed', PLUGIN_VERSION);
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

        if (renderer.current) {
            base.forEach(function (item) {
                try { item.selected = false; } catch (e) {}
            });
        }

        var mixed = [];
        mixed.push(disabledItem());

        base.forEach(function (item) { mixed.push(item); });

        if (hasResults) {
            stremioSubs.forEach(function (item) {
                mixed.push(createSubtitleItem(item, nextIndex++));
            });
        }
        else {
            var status = statusSubtitle(nextIndex++);
            if (status) mixed.push(status);
        }

        if (isSeries(activeCard(lastPlayerData), lastPlayerData)) {
            mixed.push(separatorItem(PLUGIN_TITLE));
            mixed.push(searchItem());
        }

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

            logDebug('renderer.select', item && item.url);

            if (self.current === item && (self.loading || self.cues.length)) {
                logDebug('renderer.select skipped: already current');
                return;
            }

            self.disable(false);
            self.current = item;
            self.loading = true;
            self.lastText = null;
            item.selected = true;

            showSubtitleText('');

            subtitleNetwork.timeout(20000);
            subtitleNetwork.silent(item.url, function (text) {
                if (self.current !== item) {
                    logDebug('renderer.select fetch ignored: current changed');
                    return;
                }

                self.cues = parseSubtitles(text || '');
                self.loading = false;

                logDebug('renderer.select parsed', self.cues.length, 'cues from', (text || '').length, 'chars');

                if (!self.cues.length) {
                    notify(PLUGIN_TITLE + ': файл субтитров пустой или не распознан');
                    self.disable();
                    return;
                }

                self.start();
            }, function (xhr) {
                if (self.current !== item) return;

                logDebug('renderer.select fetch error', xhr && xhr.status);
                notify(PLUGIN_TITLE + ': ' + decodeError(xhr));
                self.disable();
            }, false, {
                dataType: 'text'
            });
        },
        start: function () {
            var self = this;

            logDebug('renderer.start: timer fires every 200ms');

            if (Lampa.PlayerVideo && typeof Lampa.PlayerVideo.subsview === 'function') {
                try { Lampa.PlayerVideo.subsview(true); } catch (e) {}
            }

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
                logDebug('cue change at ' + Math.round(time) + 'ms: "' + (text ? text.substring(0, 40) : '<empty>') + '"');
            }

            this.lastText = text;
            showSubtitleText(text);
        },
        disable: function (clearText) {
            if (this.current || this.cues.length || this.loading) {
                logDebug('renderer.disable', this.current && this.current.url);
            }

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

    var firstDispatchLogged = false;

    function showSubtitleText(text) {
        var video = Lampa.PlayerVideo && Lampa.PlayerVideo.video ? Lampa.PlayerVideo.video() : null;
        if (!video) {
            if (!firstDispatchLogged) { logDebug('showSubtitleText: no video element'); firstDispatchLogged = true; }
            return;
        }
        if (typeof video.dispatchEvent !== 'function') {
            if (!firstDispatchLogged) { logDebug('showSubtitleText: no dispatchEvent on video'); firstDispatchLogged = true; }
            return;
        }

        try {
            var event = new Event('subtitle');
            event.text = text || '';
            video.dispatchEvent(event);

            if (!firstDispatchLogged) {
                firstDispatchLogged = true;
                logDebug('showSubtitleText: first dispatch ok, currentTime=' + video.currentTime + ' text="' + (text || '').substring(0, 30) + '"');
            }
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

    function injectOriginalTitle(body, movie) {
        if (!body || !body.find || !movie) return;

        var displayTitle = (movie.title || movie.name || '').trim();
        var origTitle = (movie.original_title || movie.original_name || '').trim();

        if (!origTitle || origTitle === displayTitle) return;

        body.find('.opensub-original-title-row').remove();

        var details = body.find('.full-start-new__details').first();
        if (!details.length) return;

        var titleSpan = $('<span class="opensub-original-title-row"></span>').text(origTitle);
        var separator = $('<span class="full-start-new__split opensub-original-title-row">●</span>');

        details.prepend(separator);
        details.prepend(titleSpan);
    }

    if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
        if (Lampa.Listener._opensub_full_listener) {
            try { Lampa.Listener.remove('full', Lampa.Listener._opensub_full_listener); }
            catch (e) {}
        }

        var fullListener = function (event) {
            if (event && (event.type === 'complite' || event.type === 'build') && event.body && event.data && event.data.movie) {
                injectOriginalTitle(event.body, event.data.movie);
            }
        };

        Lampa.Listener.follow('full', fullListener);
        Lampa.Listener._opensub_full_listener = fullListener;
    }

    addSettings();
    hookPanelSetSubs();
    hookSubsviewSignal();
    hookVideoSubsview();
    hookAndroidOpenPlayer();

    Lampa.Player.listener.follow('ready', function (data) {
        hookPanelSetSubs();
        hookSubsviewSignal();
        hookVideoSubsview();
        hookAndroidOpenPlayer();
        startPlayer(data);
    });
    Lampa.Player.listener.follow('destroy', destroyPlayer);

    if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
        var bus = Lampa.PlayerVideo.listener;
        var prev = Lampa.PlayerVideo._opensub_subs_listener;

        if (prev && typeof bus.remove === 'function') {
            try { bus.remove('subs', prev); } catch (e) {}
        }

        var subsListener = function (event) {
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
        };

        bus.follow('subs', subsListener);
        Lampa.PlayerVideo._opensub_subs_listener = subsListener;
    }
})();
