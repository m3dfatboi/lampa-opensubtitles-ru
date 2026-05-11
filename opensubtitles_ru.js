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

    var PLUGIN_VERSION = 'v13-auto-select-translated';
    var EXTERNAL_SEARCH_TIMEOUT = 3500;
    var SERVICE_API_BASE = 'https://lampa-subs.194.67.101.239.sslip.io';
    var TELEGRAM_BOT_URL = 'https://t.me/LampaSubsBot';
    var SERVICE_POLL_INTERVAL = 2500;
    var SERVICE_POLL_TIMEOUT = 900000;
    var SERVICE_CREDIT_CHARS = 10000;

    var EXTRA_LANGUAGE_META = {
        jpn: { iso2: 'ja', name: 'Japanese', aliases: ['japanese'] },
        chi: { iso2: 'zh', name: 'Chinese', aliases: ['zho', 'chinese', 'mandarin', 'cn'] },
        kor: { iso2: 'ko', name: 'Korean', aliases: ['korean'] },
        ara: { iso2: 'ar', name: 'Arabic', aliases: ['arabic'] },
        hin: { iso2: 'hi', name: 'Hindi', aliases: ['hindi'] },
        dut: { iso2: 'nl', name: 'Dutch', aliases: ['nld', 'dutch', 'nederlands'] },
        swe: { iso2: 'sv', name: 'Swedish', aliases: ['swedish'] },
        nor: { iso2: 'no', name: 'Norwegian', aliases: ['norwegian', 'nb', 'nn'] },
        dan: { iso2: 'da', name: 'Danish', aliases: ['danish'] },
        fin: { iso2: 'fi', name: 'Finnish', aliases: ['finnish'] },
        rum: { iso2: 'ro', name: 'Romanian', aliases: ['ron', 'romanian'] },
        cze: { iso2: 'cs', name: 'Czech', aliases: ['ces', 'czech'] },
        hun: { iso2: 'hu', name: 'Hungarian', aliases: ['hungarian'] },
        gre: { iso2: 'el', name: 'Greek', aliases: ['ell', 'greek'] },
        heb: { iso2: 'he', name: 'Hebrew', aliases: ['hebrew', 'iw'] },
        vie: { iso2: 'vi', name: 'Vietnamese', aliases: ['vietnamese'] },
        tha: { iso2: 'th', name: 'Thai', aliases: ['thai'] },
        ind: { iso2: 'id', name: 'Indonesian', aliases: ['indonesian'] },
        may: { iso2: 'ms', name: 'Malay', aliases: ['msa', 'malay'] }
    };
    var LANGUAGE_META = buildLanguageMeta();

    if (!window.Lampa) return;

    if (window.console && window.console.log) {
        try { console.log('[OpenSubtitles]', 'plugin source loaded', PLUGIN_VERSION); } catch (e) {}
    }

    var Lampa = window.Lampa;
    var network = new Lampa.Reguest();
    var subtitleNetwork = new Lampa.Reguest();
    var serviceNetwork = new Lampa.Reguest();
    var activePlayerId = 0;
    var lastPlayerData = null;
    var lastKnownSubs = [];
    var stremioSubs = [];
    var translatedSubs = [];
    var searchState = 'idle';
    var injectingSubs = false;
    var nativeSubsSeen = false;
    var manualOverride = null;
    var actionWasPicked = false;
    var latestPanelSubs = [];
    var translationMemory = {};
    var translationPending = {};
    var translationPrefetched = {};
    var translationCheckResults = {};
    var translationCheckInflight = {};
    var translationStatusNode = null;
    var translationStatusTextNode = null;

    var settingsIcon = '<svg width="38" height="38" viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="30" height="22" rx="4" stroke="white" stroke-width="3"/><path d="M9 32h20" stroke="white" stroke-width="3" stroke-linecap="round"/><path d="M11 13h16M11 19h11" stroke="white" stroke-width="3" stroke-linecap="round"/></svg>';

    function buildLanguageMeta() {
        var meta = {};

        LANGUAGES.forEach(function (lang) {
            meta[lang.code] = {
                iso2: lang.iso2,
                name: lang.name,
                aliases: (lang.aliases || []).slice()
            };
        });

        for (var code in EXTRA_LANGUAGE_META) {
            if (Object.prototype.hasOwnProperty.call(EXTRA_LANGUAGE_META, code)) {
                meta[code] = EXTRA_LANGUAGE_META[code];
            }
        }

        return meta;
    }

    function storage(name, fallback) {
        return Lampa.Storage.get(name, fallback);
    }

    function localStorageGet(name) {
        try {
            if (!window.localStorage) return '';
            return window.localStorage.getItem(name) || '';
        }
        catch (e) {
            return '';
        }
    }

    function localStorageSet(name, value) {
        try {
            if (window.localStorage) window.localStorage.setItem(name, String(value || ''));
        }
        catch (e) {}
    }

    function localStorageRemove(name) {
        try {
            if (window.localStorage) window.localStorage.removeItem(name);
        }
        catch (e) {}
    }

    function persistentStorage(name, fallback) {
        var local = localStorageGet(name);
        var value;

        if (local !== '') {
            try { Lampa.Storage.set(name, local); } catch (e) {}
            return local;
        }

        value = storage(name, '');

        if (value !== '' && value !== null && typeof value !== 'undefined') {
            localStorageSet(name, value);
            return value;
        }

        return fallback;
    }

    function setPersistentStorage(name, value) {
        try { Lampa.Storage.set(name, String(value || '')); } catch (e) {}
        localStorageSet(name, value);
    }

    function clearPersistentStorage(name) {
        try { Lampa.Storage.set(name, ''); } catch (e) {}
        localStorageRemove(name);
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

    function normalizeLangCode(rawLang) {
        var normalized = (rawLang || '').toLowerCase().trim().replace(/_/g, '-');
        var primary = normalized.split('-')[0];
        var parts = normalized ? [normalized, primary] : [];

        if (!normalized) return '';

        for (var code in LANGUAGE_META) {
            if (!Object.prototype.hasOwnProperty.call(LANGUAGE_META, code)) continue;

            var meta = LANGUAGE_META[code];
            var aliases = (meta.aliases || []).concat([code, meta.iso2, meta.name]);

            for (var i = 0; i < aliases.length; i++) {
                var alias = (aliases[i] || '').toLowerCase().replace(/_/g, '-');

                if (parts.indexOf(alias) >= 0 || (alias.length >= 3 && normalized.indexOf(alias) >= 0)) return code;
            }
        }

        return /^[a-z]{3}$/.test(primary) ? primary : '';
    }

    function languageName(code) {
        var meta = LANGUAGE_META[normalizeLangCode(code) || code];

        return meta && meta.name ? meta.name : (code || '').toUpperCase();
    }

    function promptLanguageName(code) {
        var names = {
            eng: 'English',
            rus: 'Russian',
            spa: 'Spanish',
            fre: 'French',
            ger: 'German',
            ita: 'Italian',
            por: 'Portuguese',
            pol: 'Polish',
            ukr: 'Ukrainian',
            tur: 'Turkish'
        };
        var normalized = normalizeLangCode(code) || code;

        return names[normalized] || languageName(normalized);
    }

    function matchesLanguage(rawLang, lang) {
        if (!lang) return true;

        var normalized = (rawLang || '').toLowerCase().trim().replace(/_/g, '-');
        var primary = normalized.split('-')[0];

        if (normalizeLangCode(rawLang) === lang.code) return true;
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
                name: PLUGIN_ID + '_ai_enable',
                type: 'button'
            },
            field: {
                name: aiAccountSettingsName(),
                description: accountStatusText()
            },
            onRender: function (item) {
                accountSettingsItem = item;
                refreshAccountSettingsItem();
                refreshAccountState(function () {
                    refreshAccountSettingsItem();
                });
            },
            onChange: function () {
                if (isAccountLinked()) {
                    unlinkAccount();
                    notify('Аккаунт отвязан');
                    refreshAccountSettingsItem();
                    return;
                }

                Lampa.Storage.set(PLUGIN_ID + '_translate_enabled', true);
                refreshAccountState(function (account) {
                    if (account && account.linked) {
                        notify('ИИ перевод включен. ' + accountStatusText());
                        refreshAccountSettingsItem();
                    }
                    else {
                        showServiceConnectModal();
                    }
                }, function () {
                    showServiceConnectModal();
                });
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                name: PLUGIN_ID + '_clear_cache',
                type: 'button'
            },
            field: {
                name: 'Очистить кеш переводов',
                description: translationCacheStatusText()
            },
            onRender: function (item) {
                updateCacheStatusText(item);
            },
            onChange: function () {
                var removed = clearTranslationCache();
                if (removed) notify('Локальный кеш очищен: удалено ' + removed + '. Серверные переводы остаются доступны мгновенно');
                else notify('Кеш и так пуст');
                refreshAllCacheStatusTexts();
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

    var cacheStatusElements = [];

    function updateCacheStatusText(item) {
        if (!item || !item.find) return;
        try {
            var description = item.find('.settings-param__descr, .settings-param__description, .settings-param__info, .settings--descr').first();
            var text = translationCacheStatusText();

            if (description.length) {
                description.text(text);
                if (cacheStatusElements.indexOf(description[0]) === -1) cacheStatusElements.push(description[0]);
            }
            else {
                item.append('<div class="settings-param__descr opensub-cache-state">' + escapeHtml(text) + '</div>');
            }
        }
        catch (e) {}
    }

    function refreshAllCacheStatusTexts() {
        var text = translationCacheStatusText();
        for (var i = cacheStatusElements.length - 1; i >= 0; i--) {
            try {
                if (!cacheStatusElements[i] || !cacheStatusElements[i].isConnected) {
                    cacheStatusElements.splice(i, 1);
                    continue;
                }
                cacheStatusElements[i].textContent = text;
            }
            catch (e) {}
        }
    }

    function decodeError(xhr) {
        try {
            if (xhr && xhr.responseText) {
                var json = JSON.parse(xhr.responseText);
                return json.message || (json.error && (json.error.message || json.error)) || 'ошибка запроса';
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

    function translationEnabled() {
        return storageBool(PLUGIN_ID + '_translate_enabled', true);
    }

    function serviceBaseUrl() {
        return (SERVICE_API_BASE || '').trim().replace(/\/+$/, '');
    }

    function telegramBotUrl() {
        return (TELEGRAM_BOT_URL || '').trim().replace(/\/+$/, '');
    }

    function deviceToken() {
        return (persistentStorage(PLUGIN_ID + '_device_token', '') || '').trim();
    }

    function saveDeviceToken(token) {
        if (token) setPersistentStorage(PLUGIN_ID + '_device_token', token);
    }

    function isAccountLinked() {
        return persistentStorage(PLUGIN_ID + '_account_linked', 'false') === 'true';
    }

    function aiAccountSettingsName() {
        return isAccountLinked() ? 'Отвязать устройство' : 'Включить ИИ перевод субтитров';
    }

    var accountSettingsItem = null;

    function updateAccountSettingsName(item) {
        var target = item || accountSettingsItem;
        if (!target || !target.find) return;
        try {
            var nameEl = target.find('.settings-param__name').first();
            if (nameEl.length) nameEl.text(aiAccountSettingsName());
        }
        catch (e) {}
    }

    function refreshAccountSettingsItem() {
        if (!accountSettingsItem) return;
        updateAccountSettingsName(accountSettingsItem);
        updateAccountSettingsText(accountSettingsItem);
    }

    function unlinkAccount() {
        clearDeviceToken();
        setPersistentStorage(PLUGIN_ID + '_account_linked', 'false');
        setPersistentStorage(PLUGIN_ID + '_account_unlimited', 'false');
        clearPersistentStorage(PLUGIN_ID + '_account_balance');
        clearPersistentStorage(PLUGIN_ID + '_free_used');
        clearPersistentStorage(PLUGIN_ID + '_free_limit');
    }

    function clearDeviceToken() {
        clearPersistentStorage(PLUGIN_ID + '_device_token');
    }

    function accountStatusText() {
        var linked = persistentStorage(PLUGIN_ID + '_account_linked', 'false') === 'true';
        var unlimited = persistentStorage(PLUGIN_ID + '_account_unlimited', 'false') === 'true';
        var balance = persistentStorage(PLUGIN_ID + '_account_balance', '');
        var freeUsed = parseInt(persistentStorage(PLUGIN_ID + '_free_used', '0'), 10) || 0;
        var freeLimit = parseInt(persistentStorage(PLUGIN_ID + '_free_limit', '3'), 10) || 3;
        var freeLeft = Math.max(0, freeLimit - freeUsed);

        if (linked && unlimited) return 'Баланс: безлимит';
        if (linked && balance !== '') return 'Баланс: ' + balance + ' кредитов';

        return 'Без привязки: доступно ' + freeLeft + ' из ' + freeLimit + ' бесплатных ИИ-переводов';
    }

    function saveAccountState(account) {
        if (!account) return;

        setPersistentStorage(PLUGIN_ID + '_account_linked', account.linked ? 'true' : 'false');

        if (account.linked) {
            setPersistentStorage(PLUGIN_ID + '_account_unlimited', account.unlimited ? 'true' : 'false');
            if (typeof account.balance !== 'undefined') setPersistentStorage(PLUGIN_ID + '_account_balance', String(account.balance));
        }

        if (account.free_trial) {
            setPersistentStorage(PLUGIN_ID + '_free_used', String(account.free_trial.used || 0));
            setPersistentStorage(PLUGIN_ID + '_free_limit', String(account.free_trial.limit || 3));
        }

        try { refreshAccountSettingsItem(); }
        catch (e) {}
    }

    function updateAccountSettingsText(item) {
        if (!item || !item.find) return;

        try {
            var description = item.find('.settings-param__descr, .settings-param__description, .settings-param__info, .settings--descr').first();
            var text = accountStatusText();

            if (description.length) description.text(text);
            else item.append('<div class="settings-param__descr opensub-account-state">' + escapeHtml(text) + '</div>');
        }
        catch (e) {}
    }

    function refreshAccountState(done, fail) {
        serviceRequest('/v1/account?device_id=' + encodeURIComponent(deviceId()), false, function (account) {
            saveAccountState(account);
            if (done) done(account);
        }, function (xhr) {
            if (xhr && xhr.status === 401) {
                clearDeviceToken();
                setPersistentStorage(PLUGIN_ID + '_account_linked', 'false');
            }
            if (fail) fail(xhr);
        }, {
            timeout: 15000
        });
    }

    function deviceId() {
        var key = PLUGIN_ID + '_device_id';
        var id = persistentStorage(key, '');

        if (!id) {
            id = 'lmp-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
        }

        setPersistentStorage(key, id);
        return id;
    }

    function platformName() {
        var names = ['android', 'webos', 'tizen', 'apple_tv', 'browser', 'msx'];

        if (!Lampa.Platform || !Lampa.Platform.is) return 'unknown';

        for (var i = 0; i < names.length; i++) {
            try {
                if (Lampa.Platform.is(names[i])) return names[i];
            }
            catch (e) {}
        }

        return 'unknown';
    }

    function serviceUrl(path) {
        return serviceBaseUrl() + path;
    }

    function serviceRequest(path, body, done, fail, options) {
        var params = {
            dataType: 'json',
            headers: {
                'Content-Type': 'application/json'
            }
        };
        var token = options && options.token !== false ? deviceToken() : '';
        var postData = body ? JSON.stringify(body) : false;
        var net = new Lampa.Reguest();

        if (token) params.headers.Authorization = 'Bearer ' + token;
        if (body) params.type = 'POST';

        net.timeout(options && options.timeout || 45000);
        net.silent(serviceUrl(path), done, fail, postData, params);

        return net;
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

    function subtitleDownloadUrl(url) {
        var value = (url || '').trim();
        var query = '';
        var hash = '';
        var hashIndex;
        var queryIndex;

        if (!value || /\.srt(?:[?#]|$)/i.test(value)) return value;
        if (!/subs\d*\.strem\.io\/.*\/file\/[^/?#]+/i.test(value)) return value;

        hashIndex = value.indexOf('#');
        if (hashIndex >= 0) {
            hash = value.substring(hashIndex);
            value = value.substring(0, hashIndex);
        }

        queryIndex = value.indexOf('?');
        if (queryIndex >= 0) {
            query = value.substring(queryIndex);
            value = value.substring(0, queryIndex);
        }

        return value + '.srt' + query + hash;
    }

    function mapRestItems(items) {
        if (!items || !items.length) return [];
        var mapped = [];
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (!item || !item.IDSubtitleFile) continue;
            mapped.push({
                id: item.IDSubtitle || item.IDSubtitleFile,
                url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/' + item.IDSubtitleFile + '.srt',
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
        translatedSubs = [];
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
                translatedSubs = mapTranslationCandidates(rawList, card);

                logDebug('merged', rawList.length, '→ filtered', stremioSubs.length, 'for', selectedLanguage().code, 'translate candidates', translatedSubs.length);

                if (!anySuccess) searchState = 'error';
                else searchState = stremioSubs.length || translatedSubs.length ? 'ready' : 'empty';

                installToPanel();

                if (manualOverride) {
                    if (stremioSubs.length) notify('Найдено ' + stremioSubs.length + ' субтитров');
                    else if (translatedSubs.length) notify(selectedLanguage().name + ' не найдены, доступен автоперевод с ' + languageName(translatedSubs[0].sourceLang));
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
            var url = subtitleDownloadUrl(item && item.url);

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

    function itemLanguage(item) {
        return normalizeLangCode(item && (item.lang || item.language || item.srclang || item.SubLanguageID || item.iso639 || item.langCode || item.label || item.name || item.title));
    }

    function itemScore(item) {
        return parseInt(item && (item.g || item.score || item.SubDownloadsCnt || item.downloads) || '0', 10) || 0;
    }

    function originalLanguageCode(card) {
        var raw = card && (card.original_language || card.original_lang || card.originalLanguage);

        if (!raw && card && card.spoken_languages && card.spoken_languages.length) {
            var spoken = card.spoken_languages[0] || {};
            raw = spoken.iso_639_1 || spoken.iso_639_2 || spoken.name;
        }

        return normalizeLangCode(raw);
    }

    function effectiveSourceLanguage(original) {
        var code = String(original || '').toLowerCase();
        if (!code) return 'eng';
        if (code === 'jpn') return 'eng';
        return code;
    }

    function translationSourceRank(code, original, target) {
        var order = ['fre', 'spa', 'ger', 'ita', 'por', 'kor', 'chi', 'pol', 'ukr', 'tur', 'dut', 'swe', 'nor', 'dan', 'fin', 'jpn'];
        var index;

        if (!code || code === target) return 999;

        var effective = effectiveSourceLanguage(original);
        if (code === effective) return 0;
        if (code === 'eng') return 1;

        index = order.indexOf(code);
        return index >= 0 ? index + 2 : 100;
    }

    function mapTranslationCandidates(results, card) {
        if (!translationEnabled()) return [];

        var target = selectedLanguage();
        var original = originalLanguageCode(card);
        var seen = {};
        var mapped = [];

        results.forEach(function (item) {
            var sourceLang = itemLanguage(item);
            var url = subtitleDownloadUrl(item && item.url);
            var rank = translationSourceRank(sourceLang, original, target.code);

            if (!url || !sourceLang || sourceLang === target.code || seen[url] || rank >= 999) return;

            seen[url] = true;
            mapped.push({
                stremio: true,
                translated: true,
                source: 'stremio-opensubtitles-translated',
                id: item.id || url,
                url: url,
                sourceUrl: url,
                sourceLang: sourceLang,
                targetLang: target.code,
                lang: target.code,
                langCode: target.code,
                encoding: item.SubEncoding || item.subEncoding || '',
                match: item.m || '',
                score: itemScore(item),
                rank: rank
            });
        });

        mapped.sort(function (a, b) {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return b.score - a.score;
        });

        return mapped.slice(0, 1);
    }

    function cueTimeValue(value, fromSeconds) {
        var parsed;

        if (typeof value === 'string') {
            if (value.indexOf(':') >= 0) return timeToMs(value);
            parsed = parseFloat(value.replace(',', '.'));
            if (!Number.isFinite(parsed)) return 0;
            return fromSeconds ? Math.round(parsed * 1000) : Math.round(parsed);
        }

        parsed = Number(value || 0);
        if (!Number.isFinite(parsed)) return 0;

        return fromSeconds ? Math.round(parsed * 1000) : Math.round(parsed);
    }

    function normalizeCueArray(cues) {
        var result = [];

        if (!cues || typeof cues.length === 'undefined') return result;

        Array.prototype.slice.call(cues || []).forEach(function (cue) {
            var hasMs = typeof cue.start_ms !== 'undefined' || typeof cue.end_ms !== 'undefined' || typeof cue.startMs !== 'undefined' || typeof cue.endMs !== 'undefined';
            var hasSeconds = typeof cue.startTime !== 'undefined' || typeof cue.endTime !== 'undefined';
            var start = hasMs ? cueTimeValue(cue.start_ms || cue.startMs, false) : cueTimeValue(hasSeconds ? cue.startTime : cue.start, hasSeconds);
            var end = hasMs ? cueTimeValue(cue.end_ms || cue.endMs, false) : cueTimeValue(hasSeconds ? cue.endTime : cue.end, hasSeconds);
            var text = cue.text || cue.value || cue.content || cue.label || '';

            if (!text && cue.getCueAsHTML) {
                try { text = cue.getCueAsHTML().textContent || ''; }
                catch (e) {}
            }

            text = cleanSubtitleText(text);

            if (end > start && text) {
                result.push({
                    start: start,
                    end: end,
                    text: text
                });
            }
        });

        return result;
    }

    function textTrackCues(track) {
        var cues = [];
        var previousMode;

        if (!track) return cues;

        try {
            previousMode = track.mode;
            if (track.mode === 'disabled') track.mode = 'hidden';
        }
        catch (e) {}

        try {
            cues = normalizeCueArray(track.cues || track.activeCues || []);
        }
        catch (e2) {
            cues = [];
        }

        try {
            if (previousMode === 'disabled' && track.mode === 'hidden') track.mode = 'disabled';
        }
        catch (e3) {}

        return cues;
    }

    function nativeItemCues(item) {
        var cues = [];
        var track = item && (item.track || item.textTrack || item.sourceTrack);

        if (!item) return cues;

        if (item.cues || item.items || item.subtitles) {
            cues = normalizeCueArray(item.cues || item.items || item.subtitles);
            if (cues.length) return cues;
        }

        if (track) {
            cues = textTrackCues(track);
            if (cues.length) return cues;
        }

        if (typeof item.cues !== 'undefined' || typeof item.activeCues !== 'undefined') {
            cues = textTrackCues(item);
            if (cues.length) return cues;
        }

        return cues;
    }

    function nativeItemText(item) {
        return item && (item.subtitle_text || item.raw || item.body || item.content || '');
    }

    function nativeItemUrl(item) {
        var url = item && (item.url || item.src || item.file || item.path);

        if (!url || /^native:\/\//i.test(url)) return '';

        return url;
    }

    function currentVideoTextTracks() {
        var video = Lampa.PlayerVideo && Lampa.PlayerVideo.video ? Lampa.PlayerVideo.video() : null;
        var tracks = video && video.textTracks;

        return tracks && tracks.length ? Array.prototype.slice.call(tracks) : [];
    }

    var COMMON_FRAMERATES = [23.976, 24, 25, 29.97, 30, 50, 60];
    var ASSUMED_SUBTITLE_FPS = 23.976;

    function detectVideoFps(video) {
        if (!video) return null;
        var elapsed = video.currentTime;
        if (!elapsed || elapsed < 10) return null;

        var frames = null;
        try {
            if (typeof video.getVideoPlaybackQuality === 'function') {
                var q = video.getVideoPlaybackQuality();
                if (q && q.totalVideoFrames) frames = q.totalVideoFrames;
            }
        }
        catch (e) {}
        if (!frames && typeof video.webkitDecodedFrameCount === 'number') frames = video.webkitDecodedFrameCount;
        if (!frames && typeof video.mozDecodedFrames === 'number') frames = video.mozDecodedFrames;

        if (!frames || frames < 100) return null;

        var measuredFps = frames / elapsed;
        var bestFps = null;
        var bestDiff = 0.1;
        for (var i = 0; i < COMMON_FRAMERATES.length; i++) {
            var diff = Math.abs(measuredFps - COMMON_FRAMERATES[i]);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestFps = COMMON_FRAMERATES[i];
            }
        }
        return bestFps;
    }

    function detectFramerateInfo(cues) {
        if (!cues || !cues.length) return null;

        var video = Lampa.PlayerVideo && Lampa.PlayerVideo.video ? Lampa.PlayerVideo.video() : null;
        if (!video) return null;

        var videoFps = detectVideoFps(video);
        if (!videoFps) return null;

        var ratio = ASSUMED_SUBTITLE_FPS / videoFps;
        if (Math.abs(ratio - 1) < 0.005) return { videoFps: videoFps, ratio: 1, shouldRescale: false };

        var duration = video.duration;
        if (duration && isFinite(duration) && duration > 60) {
            var lastEndSec = cues[cues.length - 1].end / 1000;
            var rescaledEnd = lastEndSec * ratio;
            if (rescaledEnd < duration * 0.5 || rescaledEnd > duration * 1.05) {
                return { videoFps: videoFps, ratio: 1, shouldRescale: false };
            }
        }

        return { videoFps: videoFps, ratio: ratio, shouldRescale: true };
    }

    function rescaleCues(cues, ratio) {
        if (!cues || !cues.length || ratio === 1) return cues;
        return cues.map(function (cue) {
            return {
                start: Math.round(cue.start * ratio),
                end: Math.round(cue.end * ratio),
                text: cue.text
            };
        });
    }

    var SUBS_OFF_BODY_CLASS = 'opensubtitles-ru-subs-off';
    var subsHideObserver = null;

    function ensureSubsOffStyles() {
        if (typeof document === 'undefined' || !document.head) return;
        if (document.getElementById('opensubtitles-ru-subs-off-styles')) return;

        var hideRule = 'display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;';
        var prefix = 'body.' + SUBS_OFF_BODY_CLASS + ' ';

        var style = document.createElement('style');
        style.id = 'opensubtitles-ru-subs-off-styles';
        style.textContent =
            prefix + '.subtitles,' +
            prefix + '.player-subtitles,' +
            prefix + '.player .subtitles,' +
            prefix + '.player-video .subtitles,' +
            prefix + '.player-position .subtitles,' +
            prefix + '[class*="subtitle"]:not([class*="settings"]):not([class*="opensubtitles"]):not([class*="opensub-"]),' +
            prefix + '[class*="caption"]:not([class*="settings"]):not([class*="opensubtitles"]):not([class*="opensub-"]),' +
            prefix + 'video::cue,' +
            prefix + 'video::-webkit-media-text-track-container,' +
            prefix + 'video::-webkit-media-text-track-display,' +
            prefix + 'video::-webkit-media-text-track-display-backdrop {' +
                hideRule +
            '}';
        document.head.appendChild(style);
    }

    function isOurDomElement(el) {
        if (!el || !el.className) return false;
        var cls = typeof el.className === 'string' ? el.className : (el.className.baseVal || '');
        return cls.indexOf('opensubtitles') >= 0 || cls.indexOf('opensub-') >= 0;
    }

    function looksLikeSubtitleNode(el) {
        if (!el || el.nodeType !== 1) return false;
        if (isOurDomElement(el)) return false;
        var cls = (typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal || '')).toLowerCase();
        if (!cls) return false;
        if (cls.indexOf('settings') >= 0) return false;
        return cls.indexOf('subtitle') >= 0 || cls.indexOf('caption') >= 0;
    }

    function forceHideSubtitleNodes() {
        if (typeof document === 'undefined') return;
        var nodes;
        try {
            nodes = document.querySelectorAll('[class*="subtitle"],[class*="caption"]');
        }
        catch (e) { return; }
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            if (!looksLikeSubtitleNode(el)) continue;
            try {
                el.style.setProperty('display', 'none', 'important');
                el.style.setProperty('visibility', 'hidden', 'important');
            }
            catch (e) {}
        }
    }

    function restoreSubtitleNodes() {
        if (typeof document === 'undefined') return;
        var nodes;
        try {
            nodes = document.querySelectorAll('[class*="subtitle"],[class*="caption"]');
        }
        catch (e) { return; }
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            if (!looksLikeSubtitleNode(el)) continue;
            try {
                el.style.removeProperty('display');
                el.style.removeProperty('visibility');
            }
            catch (e) {}
        }
    }

    function startSubsHideObserver() {
        if (subsHideObserver || typeof MutationObserver === 'undefined' || !document.body) return;
        subsHideObserver = new MutationObserver(function () {
            if (!document.body.classList.contains(SUBS_OFF_BODY_CLASS)) return;
            forceHideSubtitleNodes();
        });
        try { subsHideObserver.observe(document.body, { childList: true, subtree: true }); }
        catch (e) { subsHideObserver = null; }
    }

    function stopSubsHideObserver() {
        if (!subsHideObserver) return;
        try { subsHideObserver.disconnect(); }
        catch (e) {}
        subsHideObserver = null;
    }

    function setSubsContainerHidden(hidden) {
        if (typeof document === 'undefined' || !document.body) return;
        ensureSubsOffStyles();
        try {
            if (hidden) {
                document.body.classList.add(SUBS_OFF_BODY_CLASS);
                forceHideSubtitleNodes();
                startSubsHideObserver();
            }
            else {
                stopSubsHideObserver();
                document.body.classList.remove(SUBS_OFF_BODY_CLASS);
                restoreSubtitleNodes();
            }
        }
        catch (e) {}
    }

    function silenceNativeTextTracks() {
        var tracks = currentVideoTextTracks();
        for (var i = 0; i < tracks.length; i++) {
            var track = tracks[i];
            if (!track) continue;
            try {
                if (track.mode === 'showing') track.mode = 'disabled';
            }
            catch (e) {}
        }

        var lists = [latestPanelSubs, lastKnownSubs];
        for (var p = 0; p < lists.length; p++) {
            var list = lists[p] || [];
            for (var j = 0; j < list.length; j++) {
                var item = list[j];
                if (!item || isOurSub(item)) continue;
                try { if (item.mode === 'showing') item.mode = 'disabled'; }
                catch (e) {}
                try { if (item.selected === true) item.selected = false; }
                catch (e) {}
            }
        }

        if (Lampa.PlayerVideo && typeof Lampa.PlayerVideo.customSubs === 'function') {
            try { Lampa.PlayerVideo.customSubs([]); }
            catch (e) {}
        }
    }

    function watchNativeTextTracksForUserPicks() {
        var video = Lampa.PlayerVideo && Lampa.PlayerVideo.video ? Lampa.PlayerVideo.video() : null;
        if (!video) return;
        var tracks = video.textTracks;
        if (!tracks || typeof tracks.addEventListener !== 'function') return;
        if (tracks._opensub_change_hook === PLUGIN_VERSION) return;

        tracks.addEventListener('change', function () {
            for (var i = 0; i < tracks.length; i++) {
                if (tracks[i] && tracks[i].mode === 'showing') {
                    setSubsContainerHidden(false);
                    if (renderer.current) {
                        logDebug('native textTrack went showing, yielding our renderer');
                        renderer.disable();
                    }
                    return;
                }
            }
        });

        tracks._opensub_change_hook = PLUGIN_VERSION;
    }

    function nativeMediaKey() {
        var data = lastPlayerData || {};
        var card = activeCard(data);
        var episode = parseEpisode(data);

        return [
            card && (card.imdb_id || card.id || card.title || card.name) || '',
            data.url || data.path || data.fname || data.title || '',
            episode.season || '',
            episode.episode || ''
        ].join('|');
    }

    function nativeCueFingerprint(cues) {
        if (!cues || !cues.length) return 'no-cues';

        return [
            cues.length,
            cues[0].start,
            cues[0].end,
            cues[cues.length - 1].start,
            cues[cues.length - 1].end,
            cueTextToPlain(cues[0].text).substring(0, 24),
            cueTextToPlain(cues[cues.length - 1].text).substring(0, 24)
        ].join('|');
    }

    function nativeItemIdentity(item, index, cues) {
        return [
            nativeMediaKey(),
            item && (item.id || item.index || item.label || item.name || item.language || item.lang || item.srclang) || index,
            nativeCueFingerprint(cues)
        ].join('|');
    }

    function readableNativeSource(item) {
        var cues = nativeItemCues(item);
        var text = nativeItemText(item);
        var url = nativeItemUrl(item);

        if (cues.length || text || url) {
            return {
                cues: cues,
                text: text,
                url: url
            };
        }

        return null;
    }

    function nativeTranslationCandidates(base, card) {
        if (!translationEnabled()) return [];

        var target = selectedLanguage();
        var original = originalLanguageCode(card);
        var sourceItems = Array.prototype.slice.call(base || []).concat(currentVideoTextTracks());
        var seen = {};
        var mapped = [];

        sourceItems.forEach(function (item, index) {
            var sourceLang = itemLanguage(item);
            var rank = translationSourceRank(sourceLang, original, target.code);
            var readable;
            var identity;

            if (!item || isOurSub(item) || !sourceLang || sourceLang === target.code || rank >= 999) return;

            readable = readableNativeSource(item);
            if (!readable) return;

            identity = nativeItemIdentity(item, index, readable.cues);
            if (seen[identity]) return;

            seen[identity] = true;
            mapped.push({
                stremio: true,
                translated: true,
                native: true,
                source: 'native-subtitles-translated',
                id: 'native-' + index,
                url: 'native://subtitles/' + index + '/' + encodeURIComponent(sourceLang),
                sourceKey: 'native|' + identity,
                sourceUrl: readable.url,
                sourceText: readable.text,
                sourceCues: readable.cues,
                sourceChars: cuesCharCount(readable.cues) || (readable.text ? readable.text.length : 0),
                sourceItem: item,
                sourceLang: sourceLang,
                targetLang: target.code,
                lang: target.code,
                langCode: target.code,
                rank: rank,
                score: 100000 - index
            });
        });

        mapped.sort(function (a, b) {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return b.score - a.score;
        });

        return mapped.slice(0, 1);
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
                if (value !== 'showing') return;
                if (renderer.current) {
                    logDebug('disabled picked: stopping renderer');
                    renderer.disable();
                }
                silenceNativeTextTracks();
                if (Lampa.PlayerVideo && typeof Lampa.PlayerVideo.subsview === 'function') {
                    try { Lampa.PlayerVideo.subsview(false); }
                    catch (e) {}
                }
                setSubsContainerHidden(true);
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
                return Boolean(renderer.current && renderer.current.url === sub.url && !renderer.current.translated);
            }
        });

        Object.defineProperty(sub, 'mode', {
            configurable: true,
            set: function (value) {
                if (value === 'showing') renderer.select(sub);
            },
            get: function () {
                return renderer.current && renderer.current.url === sub.url && !renderer.current.translated ? 'showing' : 'disabled';
            }
        });

        return sub;
    }

    function isRendererPanelItem(item) {
        if (!renderer.current || !item || !item.url) return false;

        return item.url === renderer.current.url &&
            Boolean(item.translated) === Boolean(renderer.current.translated);
    }

    function selectedPanelItem() {
        var first = null;

        for (var i = 0; i < latestPanelSubs.length; i++) {
            try {
                if (latestPanelSubs[i] && latestPanelSubs[i].selected === true) {
                    if (isRendererPanelItem(latestPanelSubs[i])) return latestPanelSubs[i];
                    if (!first) first = latestPanelSubs[i];
                }
            }
            catch (e) {}
        }

        return first;
    }

    function createTranslatedSubtitleItem(item, index) {
        var sourceName = languageName(item.sourceLang);
        var target = selectedLanguage();
        var baseTitle = item.native ? 'ИИ перевод встроенных с ' + sourceName : 'ИИ перевод с ' + sourceName;
        var label = baseTitle + translatedItemTitleSuffix(item);
        var sub = {
            stremio: true,
            translated: true,
            native: item.native,
            source: item.source || 'stremio-opensubtitles-translated',
            index: index,
            language: target.code,
            label: label,
            title: label,
            url: item.url,
            sourceKey: item.sourceKey,
            sourceUrl: item.sourceUrl || (item.native ? '' : item.url),
            sourceText: item.sourceText,
            sourceCues: item.sourceCues,
            sourceChars: item.sourceChars,
            sourceItem: item.sourceItem,
            sourceLang: item.sourceLang,
            targetLang: target.code,
            onSelect: function () {
                renderer.selectTranslated(sub);
            }
        };

        Object.defineProperty(sub, 'selected', {
            configurable: true,
            set: function () {},
            get: function () {
                return Boolean(renderer.current && renderer.current.url === sub.url && renderer.current.translated);
            }
        });

        Object.defineProperty(sub, 'mode', {
            configurable: true,
            set: function (value) {
                if (value === 'showing') renderer.selectTranslated(sub);
            },
            get: function () {
                return renderer.current && renderer.current.url === sub.url && renderer.current.translated ? 'showing' : 'disabled';
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
            var picked;
            logDebug('Lampa.PlayerVideo.subsview status=' + status + ' actionPicked=' + actionWasPicked + ' rendererActive=' + (!!renderer.current));

            if (status === false && renderer.current && !actionWasPicked) {
                picked = selectedPanelItem();

                if (picked && !picked.isDisabled && isRendererPanelItem(picked)) {
                    logDebug('Lampa.PlayerVideo.subsview: overriding to true (our sub active)');
                    status = true;
                }
                else if (picked && !picked.isDisabled && picked.url && !isRendererPanelItem(picked)) {
                    logDebug('Lampa.PlayerVideo.subsview: different sub picked, disabling our renderer');
                    renderer.disable();
                }
                else if (!picked || picked.isDisabled) {
                    logDebug('Lampa.PlayerVideo.subsview: nothing or disabled picked, disabling our renderer');
                    renderer.disable();
                }
            }

            if (status === true) setSubsContainerHidden(false);

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
            var status = event && event.status;

            logDebug('subsview event fired status=' + status + ' actionPicked=' + actionWasPicked);

            if (actionWasPicked) return;

            setTimeout(function () {
                if (!renderer.current) {
                    logDebug('subsview check: no renderer.current');
                    return;
                }

                var picked = selectedPanelItem();

                if (!picked || picked.isDisabled) {
                    if (status === false) {
                        logDebug('subsview disable: nothing selected or disabled item picked');
                        renderer.disable();
                    }
                    else {
                        logDebug('subsview keep: no selected panel item while enabling');
                    }
                }
                else if (isRendererPanelItem(picked)) {
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

    function currentSubtitleShift() {
        return parseFloat(storage('player_subs_shift_time', '0')) || 0;
    }

    function formatShiftLabel(sec) {
        if (!sec) return '0 sec.';
        var sign = sec > 0 ? '+' : '−';
        var abs = Math.abs(sec);
        var fixed = abs % 1 === 0 ? String(abs) : abs.toFixed(1);
        return sign + fixed + ' sec.';
    }

    function buildSubtitleDelaySteps() {
        var steps = [-120, -90, -60, -30, -15];
        for (var i = -20; i <= 20; i++) steps.push(Math.round(i * 5) / 10);
        var positiveWide = [15, 30, 60, 90, 120];
        for (var j = 0; j < positiveWide.length; j++) steps.push(positiveWide[j]);
        return steps;
    }

    function looksLikeLampaSubtitleDelayMenu(params) {
        if (!params || !Array.isArray(params.items) || params.items.length < 5) return false;

        var values = [];
        for (var i = 0; i < params.items.length; i++) {
            var raw = params.items[i] && params.items[i].value;
            if (typeof raw !== 'number') return false;
            values.push(raw);
        }

        if (values[0] !== -120 || values[values.length - 1] !== 120) return false;
        if (values.indexOf(0) === -1) return false;

        return true;
    }

    function patchSubtitleDelayMenu(params) {
        if (!looksLikeLampaSubtitleDelayMenu(params)) return params;

        var current = currentSubtitleShift();
        params.items = buildSubtitleDelaySteps().map(function (sec) {
            return {
                title: formatShiftLabel(sec),
                value: sec,
                selected: Math.abs(sec - current) < 0.01
            };
        });

        logDebug('hookSubtitleDelayPicker: replaced ' + params.items.length + ' delay options, current=' + current);
        return params;
    }

    function hookSubtitleDelayPicker() {
        if (!Lampa.Select || typeof Lampa.Select.show !== 'function') return;
        if (Lampa.Select.show._opensub_delay_hook === PLUGIN_VERSION) return;

        var original = Lampa.Select.show._opensub_delay_original || Lampa.Select.show;

        var wrapper = function (params) {
            try { params = patchSubtitleDelayMenu(params); }
            catch (e) { logDebug('hookSubtitleDelayPicker error', e && e.message); }
            return original.call(this, params);
        };

        wrapper._opensub_delay_hook = PLUGIN_VERSION;
        wrapper._opensub_delay_original = original;
        Lampa.Select.show = wrapper;

        logDebug('hookSubtitleDelayPicker: installed');
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
        var nativeTranslated = [];
        var externalTranslated = [];

        base.forEach(function (item, pos) {
            if (typeof item.index === 'undefined') item.index = pos;
            nextIndex = Math.max(nextIndex, parseInt(item.index, 10) + 1 || pos + 1);
        });

        var hasResults = stremioSubs.length > 0;

        nativeTranslated = nativeTranslationCandidates(base, activeCard(lastPlayerData));

        externalTranslated = translatedSubs;

        var hasTranslated = nativeTranslated.length > 0 || externalTranslated.length > 0;

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

        nativeTranslated.forEach(function (item) {
            mixed.push(createTranslatedSubtitleItem(item, nextIndex++));
            checkServerTranslationCache(item);
        });

        externalTranslated.forEach(function (item) {
            mixed.push(createTranslatedSubtitleItem(item, nextIndex++));
            prefetchTranslationSource(item);
            checkServerTranslationCache(item);
        });

        if (!hasResults && !hasTranslated) {
            var status = statusSubtitle(nextIndex++);
            if (status) mixed.push(status);
        }

        if (isSeries(activeCard(lastPlayerData), lastPlayerData)) {
            mixed.push(separatorItem(PLUGIN_TITLE));
            mixed.push(searchItem());
        }

        logDebug('install panel: native=' + base.length + ' stremio=' + stremioSubs.length + ' nativeTranslated=' + nativeTranslated.length + ' translated=' + translatedSubs.length + ' state=' + searchState);

        if (mixed.length) dispatchSubs(mixed);
    }

    function cueTextToPlain(text) {
        return unescapeHtml((text || '').replace(/<br\s*\/?>/gi, '\n'));
    }

    function unescapeHtml(text) {
        var textarea;

        if (!text) return '';

        if (typeof document !== 'undefined' && document.createElement) {
            textarea = document.createElement('textarea');
            textarea.innerHTML = text;
            return textarea.value;
        }

        return text
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&amp;/g, '&');
    }

    function ensureTranslationStatusStyles() {
        if (typeof document === 'undefined' || !document.createElement || !document.head) return;
        if (document.getElementById('opensubtitles-translation-status-styles')) return;

        var style = document.createElement('style');
        style.id = 'opensubtitles-translation-status-styles';
        style.textContent =
            '@keyframes opensubtitles-spin{to{transform:rotate(360deg)}}' +
            '@keyframes opensubtitles-status-fade{from{opacity:0;transform:translate(-50%,-50%) scale(0.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}' +
            '@keyframes opensubtitles-pulse{0%,100%{opacity:0.55}50%{opacity:1}}' +
            '.opensubtitles-translation-status{' +
                'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
                'z-index:2147483647;min-width:18em;max-width:84vw;' +
                'padding:1.6em 1.8em;border-radius:0.7em;' +
                'background:rgba(13,16,22,0.94);color:#fff;' +
                'font-size:1.05em;line-height:1.35;text-align:center;' +
                'box-shadow:0 1em 2.6em rgba(0,0,0,0.55);' +
                'pointer-events:none;' +
                'animation:opensubtitles-status-fade 0.18s ease-out;' +
            '}' +
            '.opensubtitles-translation-status__spinner{' +
                'display:block;margin:0 auto 0.85em;width:2.2em;height:2.2em;' +
                'border-radius:50%;' +
                'border:0.22em solid rgba(255,255,255,0.18);' +
                'border-top-color:#7cc4ff;' +
                'animation:opensubtitles-spin 0.85s linear infinite;' +
            '}' +
            '.opensubtitles-translation-status__text{display:block;animation:opensubtitles-pulse 2.2s ease-in-out infinite}';
        document.head.appendChild(style);
    }

    function showTranslationStatus(text) {
        if (typeof document === 'undefined' || !document.createElement || !document.body) return;

        ensureTranslationStatusStyles();

        if (!translationStatusNode) {
            translationStatusNode = document.createElement('div');
            translationStatusNode.className = 'opensubtitles-translation-status';

            var spinner = document.createElement('div');
            spinner.className = 'opensubtitles-translation-status__spinner';
            translationStatusNode.appendChild(spinner);

            translationStatusTextNode = document.createElement('span');
            translationStatusTextNode.className = 'opensubtitles-translation-status__text';
            translationStatusNode.appendChild(translationStatusTextNode);
            document.body.appendChild(translationStatusNode);
        }

        if (translationStatusTextNode) translationStatusTextNode.textContent = text || '';
    }

    function updateTranslationStatus(text) {
        showTranslationStatus(text);
    }

    function hideTranslationStatus() {
        if (!translationStatusNode) return;

        try {
            if (translationStatusNode.parentNode) translationStatusNode.parentNode.removeChild(translationStatusNode);
        }
        catch (e) {}

        translationStatusNode = null;
        translationStatusTextNode = null;
    }

    function translationCacheKey(item, targetLang) {
        return [
            serviceBaseUrl(),
            deviceId(),
            item && (item.sourceKey || item.sourceUrl || item.url),
            item && item.sourceLang,
            targetLang || selectedLanguage().code
        ].join('|');
    }

    function cloneCues(cues) {
        return (cues || []).map(function (cue) {
            return {
                start: cue.start,
                end: cue.end,
                text: cue.text
            };
        });
    }

    var TRANSLATION_CACHE_PREFIX = PLUGIN_ID + '_tr_cache:';

    function cacheStorageKey(key) {
        return TRANSLATION_CACHE_PREFIX + key;
    }

    function listTranslationCacheKeys() {
        var keys = [];
        try {
            if (!window.localStorage) return keys;
            for (var i = 0; i < window.localStorage.length; i++) {
                var k = window.localStorage.key(i);
                if (k && k.indexOf(TRANSLATION_CACHE_PREFIX) === 0) keys.push(k);
            }
        }
        catch (e) {}
        return keys;
    }

    function loadTranslationCacheFromStorage() {
        var keys = listTranslationCacheKeys();
        var loaded = 0;
        for (var i = 0; i < keys.length; i++) {
            try {
                var raw = window.localStorage.getItem(keys[i]);
                if (!raw) continue;
                var cues = JSON.parse(raw);
                if (Array.isArray(cues) && cues.length) {
                    translationMemory[keys[i].slice(TRANSLATION_CACHE_PREFIX.length)] = cues;
                    loaded++;
                }
            }
            catch (e) {}
        }
        if (loaded) logDebug('translation cache: loaded', loaded, 'entries from storage');
    }

    function persistTranslation(key, cues) {
        if (!key || !cues || !cues.length) return;
        try {
            if (!window.localStorage) return;
            window.localStorage.setItem(cacheStorageKey(key), JSON.stringify(cues));
        }
        catch (e) {
            logDebug('persistTranslation failed', e && e.message);
        }
    }

    function translationCacheStats() {
        var keys = listTranslationCacheKeys();
        var bytes = 0;
        for (var i = 0; i < keys.length; i++) {
            try {
                var v = window.localStorage.getItem(keys[i]);
                if (v) bytes += v.length;
            }
            catch (e) {}
        }
        return { count: keys.length, bytes: bytes };
    }

    function formatCacheSize(bytes) {
        if (!bytes) return '0 КБ';
        if (bytes < 1024) return bytes + ' Б';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
        return (bytes / 1024 / 1024).toFixed(2) + ' МБ';
    }

    function translationCacheStatusText() {
        var stats = translationCacheStats();
        if (!stats.count) return 'Кеш пуст';
        return stats.count + ' переводов · ' + formatCacheSize(stats.bytes);
    }

    function clearTranslationCache() {
        var keys = listTranslationCacheKeys();
        for (var i = 0; i < keys.length; i++) {
            try { window.localStorage.removeItem(keys[i]); }
            catch (e) {}
        }
        translationMemory = {};
        translationCheckResults = {};
        translationCheckInflight = {};
        logDebug('translation cache: cleared', keys.length, 'entries');
        return keys.length;
    }

    function cachedTranslation(key) {
        if (translationMemory[key] && translationMemory[key].length) return cloneCues(translationMemory[key]);
        return null;
    }

    function rememberTranslation(key, cues) {
        translationMemory[key] = cloneCues(cues);
        persistTranslation(key, translationMemory[key]);
        try { refreshAllCacheStatusTexts(); }
        catch (e) {}
    }

    function isAccountUnlimited() {
        return persistentStorage(PLUGIN_ID + '_account_unlimited', 'false') === 'true';
    }

    function cuesCharCount(cues) {
        if (!cues || !cues.length) return 0;
        var total = 0;
        for (var i = 0; i < cues.length; i++) {
            total += cueTextToPlain(cues[i] && cues[i].text || '').length;
        }
        return total;
    }

    function estimateCreditsForChars(chars) {
        if (!chars) return 0;
        return Math.max(1, Math.ceil(chars / SERVICE_CREDIT_CHARS));
    }

    function prefetchTranslationSource(item) {
        if (!item || !item.translated) return;
        if (item.sourceChars > 0 || (item.sourceCues && item.sourceCues.length)) return;

        var url = item.sourceUrl || item.url;
        if (!url || /^native:\/\//i.test(url)) return;
        if (translationPrefetched[url] === 'pending' || translationPrefetched[url] === 'failed') return;

        if (translationPrefetched[url] && typeof translationPrefetched[url] === 'object') {
            var prev = translationPrefetched[url];
            item.sourceText = prev.text;
            item.sourceCues = prev.cues;
            item.sourceChars = prev.chars;
            return;
        }

        translationPrefetched[url] = 'pending';

        subtitleNetwork.timeout(20000);
        subtitleNetwork.silent(url, function (text) {
            var parsed = parseSubtitles(text || '');
            var chars = cuesCharCount(parsed) || (text || '').length;

            translationPrefetched[url] = {
                text: text || '',
                cues: parsed,
                chars: chars
            };

            item.sourceText = text || '';
            item.sourceCues = parsed;
            item.sourceChars = chars;

            try { installToPanel(); }
            catch (e) {}
        }, function () {
            translationPrefetched[url] = 'failed';
        }, false, {
            dataType: 'text'
        });
    }

    function checkServerTranslationCache(item) {
        if (!item || !item.translated) return;

        var cues = item.sourceCues && item.sourceCues.length ? item.sourceCues : null;
        if (!cues) return;

        var targetLang = item.targetLang || selectedLanguage().code;
        var key = translationCacheKey(item, targetLang);

        if (translationCheckResults[key] || translationCheckInflight[key]) return;
        if (translationMemory[key] && translationMemory[key].length) return;

        translationCheckInflight[key] = true;

        var body = {
            device_id: deviceId(),
            plugin_version: PLUGIN_VERSION,
            source_language: item.sourceLang,
            target_language: targetLang,
            subtitle: {
                text: item.sourceText || '',
                cues: sourceCuePayload(cues),
                cues_count: cues.length
            }
        };

        function send(skipToken) {
            serviceRequest('/v1/translations/check', body, function (result) {
                delete translationCheckInflight[key];

                translationCheckResults[key] = {
                    cached: Boolean(result && result.cached),
                    credits: Number(result && result.credits) || 0,
                    chars: Number(result && result.source_chars) || 0
                };

                try { installToPanel(); }
                catch (e) {}
            }, function (xhr) {
                if (!skipToken && xhr && xhr.status === 401) {
                    clearDeviceToken();
                    send(true);
                    return;
                }
                delete translationCheckInflight[key];
            }, {
                timeout: 15000,
                token: skipToken ? false : undefined
            });
        }

        send(false);
    }

    function translationCompletionText(result) {
        var parts = ['Автоперевод готов'];
        if (!result) return parts.join('');

        var unlimited = isAccountUnlimited() || result.unlimited === true;
        var anonymous = result.anonymous === true;
        var spent = Number(result.credits_spent) || 0;

        if (spent > 0) {
            parts.push('Списано ' + spent + ' кр.');
        }
        else if (!unlimited && !anonymous) {
            parts.push('Бесплатно');
        }

        if (unlimited) {
            parts.push('Безлимит');
        }
        else if (anonymous && result.free_trial) {
            var remaining = Math.max(0, (result.free_trial.limit || 0) - (result.free_trial.used || 0));
            parts.push('Осталось бесплатных: ' + remaining + ' из ' + (result.free_trial.limit || 0));
        }
        else if (typeof result.balance !== 'undefined' && result.balance !== null) {
            parts.push('Баланс: ' + result.balance + ' кр.');
        }

        return parts.join(' · ');
    }

    function translatedItemTitleSuffix(item) {
        if (!item || !item.translated) return '';

        var targetLang = item.targetLang || selectedLanguage().code;
        var key = translationCacheKey(item, targetLang);

        if (translationMemory[key] && translationMemory[key].length) return ' · ✓ в кеше';

        var serverCheck = translationCheckResults[key];
        if (serverCheck && serverCheck.cached) return ' · ✓ в кеше';

        if (serverCheck && serverCheck.credits) return ' · ≈' + serverCheck.credits + ' кр.';

        var chars = item.sourceChars;
        if (!chars) {
            if (item.sourceCues && item.sourceCues.length) chars = cuesCharCount(item.sourceCues);
            else if (item.sourceText) chars = item.sourceText.length;
        }

        if (!chars) return '';

        var credits = estimateCreditsForChars(chars);
        return ' · ≈' + credits + ' кр.';
    }

    function serviceBotLink(code) {
        var base = telegramBotUrl();
        var joiner = base.indexOf('?') >= 0 ? '&' : '?';

        return base + joiner + 'start=' + encodeURIComponent(code || '');
    }

    function telegramBotName() {
        var match = telegramBotUrl().match(/t\.me\/([^/?#]+)/i);
        return match ? '@' + match[1] : 'Telegram-бот';
    }

    function pausePlayback() {
        var video = Lampa.PlayerVideo && Lampa.PlayerVideo.video ? Lampa.PlayerVideo.video() : null;

        try {
            if (video && typeof video.pause === 'function' && !video.paused) video.pause();
        }
        catch (e) {}

        try {
            if (Lampa.Player && typeof Lampa.Player.pause === 'function') Lampa.Player.pause();
        }
        catch (e2) {}
    }

    function showServiceConnectModal(onLinked) {
        var base = serviceBaseUrl();
        var prevController = captureController();

        if (!base || /example\.com/i.test(base)) {
            notify('Укажите адрес сервера перевода в настройках ' + PLUGIN_TITLE);
            return;
        }

        pausePlayback();
        notify('Создаю код подключения...');

        serviceRequest('/v1/devices/session', {
            device_id: deviceId(),
            plugin_version: PLUGIN_VERSION,
            platform: platformName(),
            target_language: selectedLanguage().code
        }, function (session) {
            var code = session && (session.code || session.link_code);
            var sessionId = session && (session.session_id || session.id);
            var qrLink = session && session.bot_url || serviceBotLink(code);
            var visibleLink = telegramBotUrl() || qrLink;
            var botName = telegramBotName();
            var html;
            var timer = 0;
            var started = Date.now();

            if (!code || !sessionId) {
                notify(PLUGIN_TITLE + ': сервер не вернул код подключения');
                return;
            }

            html = $('<div class="account-modal-split opensub-service-connect">' +
                '<div class="account-modal-split__qr">' +
                    '<div class="account-modal-split__qr-code"></div>' +
                    '<div class="account-modal-split__qr-text">Сканируйте QR-код: код привязки уже внутри</div>' +
                '</div>' +
                '<div class="account-modal-split__info">' +
                    '<div class="account-modal-split__title">ИИ перевод субтитров</div>' +
                    '<div class="account-modal-split__text">' +
                        '<div style="font-size:2.2em;font-weight:700;letter-spacing:.12em;margin:.6em 0">' + escapeHtml(code) + '</div>' +
                        '<p><b>Баланс:</b> <span class="opensub-service-balance-value">' + escapeHtml(accountStatusText()) + '</span></p>' +
                        '<p>Бот ' + escapeHtml(botName) + ' привязывает Lampa к вашему балансу, показывает кредиты и помогает купить переводы после бесплатного лимита.</p>' +
                        '<p>Без привязки доступны 3 бесплатных ИИ-перевода на этом устройстве. После привязки переводы списываются с баланса кредитов.</p>' +
                        '<p>Откройте бота и отправьте код выше или просто отсканируйте QR-код.</p>' +
                        '<p style="word-break:break-all">' + escapeHtml(visibleLink) + '</p>' +
                    '</div>' +
                '</div>' +
            '</div>');

            function updateBalanceLine(account) {
                if (account) saveAccountState(account);
                html.find('.opensub-service-balance-value').text(accountStatusText());
            }

            if (Lampa.Utils && Lampa.Utils.qrcode) {
                Lampa.Utils.qrcode(qrLink, html.find('.account-modal-split__qr-code'), function () {
                    html.find('.account-modal-split__qr-code').text(code);
                });
            }

            function closeModal() {
                clearInterval(timer);
                if (Lampa.Modal && Lampa.Modal.close) Lampa.Modal.close();
                returnToController(prevController);
            }

            function checkSession() {
                if (Date.now() - started > SERVICE_POLL_TIMEOUT) {
                    clearInterval(timer);
                    notify('Код подключения устарел. Создайте новый код.');
                    return;
                }

                serviceRequest('/v1/devices/session/' + encodeURIComponent(sessionId), false, function (status) {
                    var token = status && (status.device_token || status.token);
                    var balance = status && (typeof status.balance !== 'undefined' ? status.balance : status.credits);

                    if (status && (status.status === 'linked' || token)) {
                        saveDeviceToken(token);
                        saveAccountState({
                            linked: true,
                            balance: balance,
                            unlimited: status.unlimited
                        });
                        updateBalanceLine();
                        clearInterval(timer);
                        notify('Telegram подключен' + (status.unlimited ? '. Баланс: безлимит' : (typeof balance !== 'undefined' ? '. Баланс: ' + balance + ' кредитов' : '')));
                        closeModal();
                        if (onLinked) onLinked(status);
                    }
                }, function (xhr) {
                    logDebug('device session check error', xhr && xhr.status);
                }, {
                    token: false,
                    timeout: 15000
                });
            }

            if (Lampa.Modal && Lampa.Modal.open) {
                Lampa.Modal.open({
                    title: '',
                    html: html,
                    size: 'full',
                    scroll: {
                        nopadding: true
                    },
                    onBack: closeModal
                });
            }
            else notify('Откройте Telegram: ' + visibleLink + ' и отправьте код ' + code);

            timer = setInterval(checkSession, SERVICE_POLL_INTERVAL);
            refreshAccountState(updateBalanceLine, function () {
                updateBalanceLine();
            });
            checkSession();
        }, function (xhr) {
            notify(PLUGIN_TITLE + ': ' + decodeError(xhr));
        }, {
            token: false
        });
    }

    function mediaYear(card) {
        var raw = card && (card.release_date || card.first_air_date || card.year) || '';
        var match = String(raw).match(/(\d{4})/);
        return match ? match[1] : '';
    }

    function mediaGenres(card) {
        if (!card || !card.genres || !card.genres.length) return [];
        return card.genres.map(function (genre) {
            return genre && (genre.name || genre.title || '') || '';
        }).filter(Boolean).slice(0, 5);
    }

    function serviceMediaInfo() {
        var card = activeCard(lastPlayerData);
        var series = isSeries(card, lastPlayerData);
        var episode = series ? parseEpisode(lastPlayerData || {}) : { season: 0, episode: 0 };

        return {
            imdb_id: card && card.imdb_id || '',
            tmdb_id: card && card.id || '',
            type: series ? 'series' : 'movie',
            title: card && (card.title || card.name) || lastPlayerData && lastPlayerData.title || '',
            original_title: card && (card.original_title || card.original_name) || '',
            original_language: originalLanguageCode(card),
            year: mediaYear(card),
            genres: mediaGenres(card),
            season: episode.season,
            episode: episode.episode
        };
    }

    function sourceCuePayload(cues) {
        return cues.map(function (cue) {
            return {
                start: cue.start,
                end: cue.end,
                text: cueTextToPlain(cue.text)
            };
        });
    }

    function serviceCues(result) {
        var cues = result && (result.cues || result.items || result.subtitles);

        if (!cues && result && result.translation) cues = result.translation.cues || result.translation.items;
        if (!cues && result && result.subtitle_text) return parseSubtitles(result.subtitle_text);
        if (!Array.isArray(cues)) return [];

        return cues.map(function (cue) {
            var start = Number(cue.start_ms || cue.start || 0);
            var end = Number(cue.end_ms || cue.end || 0);
            var text = cue.text || cue.value || '';

            return {
                start: start,
                end: end,
                text: cleanSubtitleText(text)
            };
        }).filter(function (cue) {
            return cue.end > cue.start && cue.text;
        });
    }

    function saveTranslationAccountState(result) {
        if (!result) return;

        saveAccountState({
            linked: !result.anonymous && (typeof result.balance !== 'undefined' || result.unlimited),
            balance: result.balance,
            unlimited: result.unlimited,
            free_trial: result.free_trial
        });
    }

    function announceFreeTranslation(result) {
        if (!result || !result.anonymous || !result.free_trial_activated || !result.free_trial || !result.free_trial.used) return;

        notify(result.free_trial.used + ' из ' + result.free_trial.limit + ' бесплатных переводов активировано');
    }

    function isServiceAuthError(xhr) {
        var message = xhr && xhr.message ? xhr.message : decodeError(xhr);
        var status = xhr && xhr.status;

        return status === 401 ||
            status === 402 ||
            /device token|кредит|бесплатн|привяж|telegram/i.test(message || '');
    }

    function handleServiceAccessError(xhr, retry) {
        if (!isServiceAuthError(xhr)) return false;

        if (xhr && xhr.status === 401) clearDeviceToken();

        pausePlayback();
        showServiceConnectModal(retry);
        return true;
    }

    function resolvePendingTranslation(cacheKey, cues, result) {
        var pending = translationPending[cacheKey];

        delete translationPending[cacheKey];

        if (!pending) return;

        rememberTranslation(cacheKey, cues);

        pending.done.forEach(function (callback) {
            callback(cloneCues(cues), result, false);
        });

        try { installToPanel(); }
        catch (e) {}
    }

    function rejectPendingTranslation(cacheKey, xhr) {
        var pending = translationPending[cacheKey];

        delete translationPending[cacheKey];

        if (!pending) return;

        pending.fail.forEach(function (callback) {
            callback(xhr);
        });
    }

    function emitPendingProgress(cacheKey, state) {
        var pending = translationPending[cacheKey];

        if (!pending) return;

        pending.progress.forEach(function (callback) {
            callback(state);
        });
    }

    function startServiceTranslation(cacheKey, item, rawText, cues, progress, done, fail) {
        var cached = cachedTranslation(cacheKey);
        var body = {
            device_id: deviceId(),
            plugin_version: PLUGIN_VERSION,
            source_url: item.sourceUrl || item.sourceKey || item.url,
            source_language: item.sourceLang,
            target_language: item.targetLang || selectedLanguage().code,
            media: serviceMediaInfo(),
            subtitle: {
                text: rawText || '',
                cues: sourceCuePayload(cues),
                cues_count: cues.length
            }
        };

        if (cached) {
            done(cached, { cached: true }, true);
            return;
        }

        if (translationPending[cacheKey]) {
            translationPending[cacheKey].done.push(done);
            translationPending[cacheKey].fail.push(fail);
            if (progress) translationPending[cacheKey].progress.push(progress);
            return;
        }

        translationPending[cacheKey] = {
            done: [done],
            fail: [fail],
            progress: progress ? [progress] : []
        };

        function submit(skipToken) {
            serviceRequest('/v1/translations', body, function (result) {
            var jobId = result && (result.job_id || result.id);
            var translatedCues;

            saveTranslationAccountState(result);
            announceFreeTranslation(result);

            if (result && (result.status === 'completed' || result.cues || result.subtitle_text || result.translation)) {
                translatedCues = serviceCues(result);
                if (!translatedCues.length) {
                    rejectPendingTranslation(cacheKey, { message: 'сервер вернул пустой перевод' });
                    return;
                }

                resolvePendingTranslation(cacheKey, translatedCues, result);
                return;
            }

            if (!jobId) {
                rejectPendingTranslation(cacheKey, { message: 'сервер не вернул задачу перевода' });
                return;
            }

            pollServiceTranslation(jobId, function (state) {
                emitPendingProgress(cacheKey, state);
            }, function (translatedCues, pollResult) {
                saveTranslationAccountState(pollResult);

                if (!translatedCues.length) {
                    rejectPendingTranslation(cacheKey, { message: 'сервер вернул пустой перевод' });
                    return;
                }

                resolvePendingTranslation(cacheKey, translatedCues, pollResult);
            }, function (xhr) {
                rejectPendingTranslation(cacheKey, xhr);
            });
        }, function (xhr) {
            if (!skipToken && xhr && xhr.status === 401) {
                clearDeviceToken();
                submit(true);
                return;
            }

            rejectPendingTranslation(cacheKey, xhr);
        }, {
            timeout: 60000,
            token: skipToken ? false : undefined
        });
        }

        submit(false);
    }

    function pollServiceTranslation(jobId, progress, done, fail) {
        var started = Date.now();

        function tick() {
            if (Date.now() - started > SERVICE_POLL_TIMEOUT) {
                fail({ message: 'перевод ещё идёт на сервере. Откройте «ИИ перевод» повторно через минуту — результат должен подхватиться из кеша.' });
                return;
            }

            serviceRequest('/v1/translations/' + encodeURIComponent(jobId) + '?device_id=' + encodeURIComponent(deviceId()), false, function (result) {
                var status = result && result.status;
                var message = result && (result.message || result.error);

                if (status === 'completed' || result.cues || result.subtitle_text || result.translation) {
                    done(serviceCues(result), result);
                    return;
                }

                if (status === 'failed' || status === 'error') {
                    fail({ message: message || 'ошибка перевода' });
                    return;
                }

                if (progress) progress(result && (result.progress || result.stage || status || 'processing'));

                setTimeout(tick, SERVICE_POLL_INTERVAL);
            }, fail, {
                timeout: 30000
            });
        }

        tick();
    }

    function loadTranslationSource(item, done, fail) {
        var cues = item && item.sourceCues && item.sourceCues.length ? cloneCues(item.sourceCues) : [];
        var rawText = item && item.sourceText || '';
        var sourceUrl = item && item.sourceUrl || '';

        if (!cues.length && item && item.sourceItem) cues = nativeItemCues(item.sourceItem);

        if (!cues.length && rawText) cues = parseSubtitles(rawText);

        if (cues.length) {
            done({
                rawText: rawText,
                cues: cues
            });
            return;
        }

        if (!sourceUrl || /^native:\/\//i.test(sourceUrl)) {
            fail({ message: 'не удалось прочитать встроенные субтитры' });
            return;
        }

        subtitleNetwork.timeout(20000);
        subtitleNetwork.silent(sourceUrl, function (text) {
            var parsed = parseSubtitles(text || '');

            if (!parsed.length) {
                fail({ message: 'файл субтитров пустой или не распознан' });
                return;
            }

            done({
                rawText: text || '',
                cues: parsed
            });
        }, fail, false, {
            dataType: 'text'
        });
    }

    var renderer = {
        current: null,
        cues: [],
        timer: 0,
        loading: false,
        lastText: null,
        requestId: 0,
        select: function (item) {
            var self = this;

            logDebug('renderer.select', item && item.url);

            if (self.current === item && (self.loading || self.cues.length)) {
                logDebug('renderer.select skipped: already current');
                silenceNativeTextTracks();
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
        selectTranslated: function (item) {
            var self = this;
            var targetLang = item.targetLang || selectedLanguage().code;
            var cacheKey = translationCacheKey(item, targetLang);
            var cached = cachedTranslation(cacheKey);
            var requestId;

            logDebug('renderer.selectTranslated', item && item.url, item && item.sourceLang, '→', targetLang);

            if (cached) {
                self.disable(false);
                self.current = item;
                self.cues = cached;
                self.loading = false;
                self.lastText = null;
                item.selected = true;
                showSubtitleText('');
                logDebug('renderer.selectTranslated: loaded from cache', cached.length, 'cues');
                self.start();
                return;
            }

            if (self.current === item && (self.loading || self.cues.length)) {
                logDebug('renderer.selectTranslated skipped: already current');
                silenceNativeTextTracks();
                return;
            }

            self.disable(false);
            self.requestId++;
            requestId = self.requestId;
            self.current = item;
            self.loading = true;
            self.lastText = null;
            item.selected = true;

            showSubtitleText('');
            showTranslationStatus('Перевожу субтитры целиком. Субтитры появятся после полной готовности.');

            if (translationPending[cacheKey]) {
                logDebug('renderer.selectTranslated: joining pending translation');
                updateTranslationStatus('Перевод уже идет. Субтитры появятся после полной готовности.');

                translationPending[cacheKey].done.push(function (translatedCues, result, fromCache) {
                    if (self.requestId !== requestId || self.current !== item) return;

                    hideTranslationStatus();
                    self.cues = cloneCues(translatedCues);
                    self.loading = false;

                    if (!self.cues.length) {
                        notify(PLUGIN_TITLE + ': сервер вернул пустой перевод');
                        self.disable();
                        return;
                    }

                    if (!fromCache) notify(translationCompletionText(result));
                    self.start();
                });
                translationPending[cacheKey].fail.push(function (xhr) {
                    if (self.requestId !== requestId || self.current !== item) return;

                    hideTranslationStatus();
                    logDebug('renderer.selectTranslated pending error', xhr && (xhr.status || xhr.message));
                    if (handleServiceAccessError(xhr, function () {
                        renderer.selectTranslated(item);
                    })) {
                        self.disable();
                        return;
                    }
                    notify(PLUGIN_TITLE + ': ' + (xhr && xhr.message ? xhr.message : decodeError(xhr)));
                    self.disable();
                });
                translationPending[cacheKey].progress.push(function (state) {
                    if (self.requestId !== requestId || self.current !== item) return;

                    updateTranslationStatus('Перевожу субтитры целиком: ' + state + '. Субтитры появятся после полной готовности.');
                });
                return;
            }

            notify('Отправляю субтитры на перевод...');

            loadTranslationSource(item, function (source) {
                if (self.requestId !== requestId || self.current !== item) {
                    logDebug('renderer.selectTranslated source ignored: current changed');
                    return;
                }

                logDebug('renderer.selectTranslated source parsed', source.cues.length, 'cues', item.native ? 'from native track' : 'from external file');

                if (!source.cues.length) {
                    hideTranslationStatus();
                    notify(PLUGIN_TITLE + ': файл субтитров пустой или не распознан');
                    self.disable();
                    return;
                }

                startServiceTranslation(cacheKey, item, source.rawText || '', source.cues, function (state) {
                    if (self.requestId === requestId && self.current === item) updateTranslationStatus('Перевожу субтитры целиком: ' + state + '. Субтитры появятся после полной готовности.');
                }, function (translatedCues, result, fromCache) {
                    if (self.requestId !== requestId || self.current !== item) return;

                    hideTranslationStatus();
                    self.cues = cloneCues(translatedCues);
                    self.loading = false;

                    if (!self.cues.length) {
                        notify(PLUGIN_TITLE + ': сервер вернул пустой перевод');
                        self.disable();
                        return;
                    }

                    if (!fromCache) notify(translationCompletionText(result));
                    self.start();
                }, function (xhr) {
                    if (self.requestId !== requestId || self.current !== item) return;

                    hideTranslationStatus();
                    logDebug('renderer.selectTranslated error', xhr && (xhr.status || xhr.message));
                    if (handleServiceAccessError(xhr, function () {
                        renderer.selectTranslated(item);
                    })) {
                        self.disable();
                        return;
                    }
                    notify(PLUGIN_TITLE + ': ' + (xhr && xhr.message ? xhr.message : decodeError(xhr)));
                    self.disable();
                });
            }, function (xhr) {
                if (self.requestId !== requestId || self.current !== item) return;

                hideTranslationStatus();
                logDebug('renderer.selectTranslated source error', xhr && (xhr.status || xhr.message));
                notify(PLUGIN_TITLE + ': ' + (xhr && xhr.message ? xhr.message : decodeError(xhr)));
                self.disable();
            });
        },
        start: function () {
            var self = this;

            logDebug('renderer.start: timer fires every 50ms');

            try { installToPanel(); }
            catch (e) { logDebug('renderer.start install panel error', e && e.message); }

            if (Lampa.PlayerVideo && typeof Lampa.PlayerVideo.subsview === 'function') {
                try { Lampa.PlayerVideo.subsview(true); } catch (e) {}
            }

            silenceNativeTextTracks();
            setSubsContainerHidden(false);
            watchNativeTextTracksForUserPicks();

            self.calibrated = false;
            self.tryCalibrate();

            clearInterval(self.timer);
            self.timer = setInterval(function () {
                self.update();
            }, 50);

            self.update();
        },
        tryCalibrate: function () {
            if (this.calibrated || !this.cues.length) return;

            this.calibrationAttempts = (this.calibrationAttempts || 0) + 1;
            if (this.calibrationAttempts > 1200) {
                this.calibrated = true;
                logDebug('framerate auto-calibration: gave up, FPS unmeasurable');
                return;
            }

            var info = detectFramerateInfo(this.cues);
            if (!info) return;

            this.calibrated = true;
            if (info.shouldRescale) {
                this.cues = rescaleCues(this.cues, info.ratio);
                logDebug('framerate calibrated: video=' + info.videoFps + 'fps, ratio=' + info.ratio.toFixed(5) + ', ' + this.cues.length + ' cues');
                notify('Тайминги выровнены под ' + info.videoFps + 'fps');
            }
            else {
                logDebug('framerate calibrated: video=' + info.videoFps + 'fps, no rescale needed');
            }
        },
        update: function () {
            if (Lampa.Player && typeof Lampa.Player.opened === 'function' && !Lampa.Player.opened()) {
                this.disable();
                return;
            }

            var video = Lampa.PlayerVideo && Lampa.PlayerVideo.video ? Lampa.PlayerVideo.video() : null;
            if (!video) {
                this.disable();
                return;
            }

            var shift = currentSubtitleShift();
            var time = typeof video.currentTime === 'number' ? (video.currentTime - shift) * 1000 : 0;
            var text = '';

            if (!this.current || !this.cues.length) return;

            if (!this.calibrated) this.tryCalibrate();

            for (var i = 0; i < this.cues.length; i++) {
                if (time >= this.cues[i].start && time <= this.cues[i].end) {
                    text = this.cues[i].text;
                    break;
                }
            }

            if (this.lastText === text) return;

            logDebug('cue change at ' + Math.round(time) + 'ms: "' + (text ? text.substring(0, 40) : '<empty>') + '"');

            this.lastText = text;
            showSubtitleText(text);
        },
        disable: function (clearText) {
            if (this.current || this.cues.length || this.loading) {
                logDebug('renderer.disable', this.current && this.current.url);
            }

            this.requestId++;
            clearInterval(this.timer);
            subtitleNetwork.clear();
            serviceNetwork.clear();
            hideTranslationStatus();

            this.timer = 0;
            this.cues = [];
            this.loading = false;
            this.calibrated = false;
            this.calibrationAttempts = 0;

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
        translatedSubs = [];
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
        translatedSubs = [];
        searchState = 'idle';
        nativeSubsSeen = false;
        manualOverride = null;
        renderer.destroy();
        network.clear();
        serviceNetwork.clear();
    }

    function injectOriginalTitle(body, movie) {
        if (!body || !body.find || !movie) return;

        var displayTitle = (movie.title || movie.name || '').trim();
        var origTitle = (movie.original_title || movie.original_name || '').trim();

        if (!origTitle || origTitle === displayTitle) return;

        body.find('.opensub-original-title-row').remove();

        var head = body.find('.full-start-new__head').first();
        if (!head.length) return;

        var span = $('<span class="opensub-original-title-row"></span>').text(origTitle + ', ');
        head.prepend(span);
        head.removeClass('hide');
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

    loadTranslationCacheFromStorage();
    addSettings();
    hookPanelSetSubs();
    hookSubsviewSignal();
    hookVideoSubsview();
    hookAndroidOpenPlayer();
    hookSubtitleDelayPicker();

    Lampa.Player.listener.follow('ready', function (data) {
        hookPanelSetSubs();
        hookSubsviewSignal();
        hookVideoSubsview();
        hookAndroidOpenPlayer();
        hookSubtitleDelayPicker();
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
