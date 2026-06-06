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

    var PLUGIN_VERSION = 'v22-proxy-subtitle-downloads';
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
    var titleSearchInProgress = false;
    var actionWasPicked = false;
    var ourLastPickAt = 0;
    var playerClosing = false;
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
        // Явные признаки фильма (TMDB / Lampa.Activity / URL ?media=movie). Они должны выигрывать
        // у эвристики "у card.name значит сериал", иначе мы насильно тащим фильм через серийную
        // ветку и шлём в SubDL фиктивные season=1/episode=1.
        if (card) {
            if (card.media_type === 'movie') return false;
            if (card.media_type === 'tv') return true;
            if (card.first_air_date && !card.release_date) return true;
            if (card.release_date && !card.first_air_date && !card.number_of_seasons) return false;
            if (card.number_of_seasons) return true;
        }
        if (data) {
            if (data.media === 'movie' || data.movie_type === 'movie') return false;
            if (data.media === 'tv' || data.movie_type === 'tv') return true;
        }
        try {
            var activity = Lampa.Activity && Lampa.Activity.active ? Lampa.Activity.active() : null;
            if (activity) {
                if (activity.media === 'movie' || activity.movie_type === 'movie') return false;
                if (activity.media === 'tv' || activity.movie_type === 'tv') return true;
            }
        }
        catch (e) {}

        return Boolean(
            (card && (card.name || card.original_name || card.number_of_seasons)) ||
            (data && (data.season || data.episode || data.season_number || data.episode_number))
        );
    }

    function parseEpisode(data) {
        var dataSeason = parseInt((data && (data.season || data.season_number)) || 0, 10) || 0;
        var dataEpisode = parseInt((data && (data.episode || data.episode_number)) || 0, 10) || 0;
        var titleText = String((data && data.title) || '');
        // Берём ВСЕ доступные пути одновременно — для многосерийных торрентов сезон
        // обычно сидит в названии родительского каталога, а fname это просто "01.mkv".
        var fileSources = [data && data.fname, data && data.path, data && data.url].filter(Boolean);
        var fileText = fileSources.map(function (s) {
            try { return decodeURIComponent(String(s)); } catch (e) { return String(s); }
        }).join(' ');
        try { titleText = decodeURIComponent(titleText); } catch (e) {}
        // Не дай резрешению вроде "1920x1080" или "1280x720" попасть в матч N×N.
        var resolutionStripped = (titleText + ' ' + fileText)
            .replace(/\b\d{3,4}x\d{3,4}\b/gi, ' ');
        var match;
        var fileSeason = 0;
        var fileEpisode = 0;

        match = resolutionStripped.match(/[Ss](\d{1,2})[ ._-]*[Ee](\d{1,3})/);
        if (match) {
            fileSeason = parseInt(match[1], 10);
            fileEpisode = parseInt(match[2], 10);
        }

        if (!fileSeason || !fileEpisode) {
            match = resolutionStripped.match(/(?:^|[^\d])(\d{1,2})x(\d{1,3})(?!\d)/i);
            if (match) {
                fileSeason = fileSeason || parseInt(match[1], 10);
                fileEpisode = fileEpisode || parseInt(match[2], 10);
            }
        }

        // Сезон из текста: "Season 3", "3rd Season", "Сезон 3", "S03". И title, и весь путь.
        if (!fileSeason) {
            var seasonText = titleText + ' ' + fileText;
            match = seasonText.match(/(?:season|сезон)\s*(\d{1,2})\b/i)
                || seasonText.match(/\b(\d{1,2})(?:st|nd|rd|th)\s*season\b/i)
                || seasonText.match(/(?:^|[^A-Za-z\d])S(\d{1,2})(?:[^A-Za-z\d]|$)/);
            if (match) {
                var maybeSeason = parseInt(match[1], 10);
                if (maybeSeason > 0 && maybeSeason < 30) fileSeason = maybeSeason;
            }
        }

        // Эпизод из имени файла: "01.mkv", "[Group] 01 [tag].mkv", "Title - 01.mkv", "Title 01v2.mkv".
        if (!fileEpisode) {
            var basename = fileText.replace(/^.*[\/\\]/, '').replace(/\.[a-z0-9]{2,4}$/i, '');
            var stripped = basename.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');
            match = stripped.match(/(?:^|[\s_\-.])(\d{1,3})(?:v\d)?(?=[\s_\-.]|$)/);
            if (match) {
                var maybeEpisode = parseInt(match[1], 10);
                if (maybeEpisode > 0 && maybeEpisode < 1000) fileEpisode = maybeEpisode;
            }
        }

        // Эпизод нашли, а сезон нет — почти всегда сезон 1 (типично для аниме первого сезона).
        if (fileEpisode && !fileSeason) fileSeason = 1;

        // Приоритет: если из имени файла достали что-то осмысленное — используем именно его.
        // Lampa для movie-карточек прокидывает data.season=1, data.episode=1 как дефолты,
        // и они полностью перекрывают реальные значения из торрента-сериала. Поэтому
        // file-extracted данные имеют приоритет.
        if (fileSeason || fileEpisode) {
            return {
                season: fileSeason || dataSeason || 0,
                episode: fileEpisode || dataEpisode || 0
            };
        }

        return { season: dataSeason, episode: dataEpisode };
    }

    function cleanShowName(text) {
        var base = String(text || '');
        base = base.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');
        base = base.replace(/\b(?:season|сезон)\s*\d+.*/i, '');
        base = base.replace(/\b\d{1,2}(?:st|nd|rd|th)\s*season.*/i, '');
        base = base.replace(/\bs\d{1,2}(?:\s*e\d{1,3})?\b.*/i, '');
        base = base.replace(/\b\d{1,2}x\d{1,3}\b.*/i, '');
        base = base.replace(/\bpart\s*\d+\b.*/i, '');
        base = base.replace(/\s+-\s+\d{1,3}(?:v\d)?(\s.*)?$/i, '');
        base = base.replace(/\b(720p|1080p|2160p|4k|bdrip|bluray|webrip|webdl|hdtv|hevc|h264|h265|x264|x265|10bit|flac|aac|ac3|dts|multi|dual|dub|sub|raw|ova|oad|movie|complete)\b.*/gi, '');
        base = base.replace(/\b\d{3,4}x\d{3,4}\b.*/i, '');
        base = base.replace(/\b(?:19|20)\d{2}\b/g, '');
        // Хвостовой "3rd" / "2nd" / "1st" / "4th" без "Season" — обычно остаток от
        // обрезанного "3rd Season". Срезаем, если оно последнее слово.
        base = base.replace(/\s+\d{1,2}(?:st|nd|rd|th)\s*$/i, '');
        base = base.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
        base = base.replace(/^[-:\s]+|[-:\s]+$/g, '');
        if (base.length < 3 || /^\d+$/.test(base)) return '';
        return base;
    }

    // Достаём очищенное имя шоу из имени файла / торрента / папки. Помогает в кейсах,
    // когда Lampa сматчила контент с не той карточкой TMDB (типичная история для аниме):
    // имя файла либо родительский каталог торрента содержит правильное имя шоу.
    function extractShowFromFilename(data) {
        if (!data) return '';
        // Порядок: файл/путь/url раньше title.
        var sources = [data.fname, data.path, data.url, data.title].filter(Boolean);
        for (var i = 0; i < sources.length; i++) {
            var raw = String(sources[i] || '');
            try { raw = decodeURIComponent(raw); } catch (e) {}
            // Разбиваем на сегменты пути и идём от файла к корню — обычно имя шоу в
            // родительском каталоге, а файл это просто "01.mkv".
            var segments = raw.split(/[\/\\]/).filter(Boolean);
            for (var j = segments.length - 1; j >= 0; j--) {
                var seg = segments[j];
                // На последнем сегменте отрезаем расширение.
                if (j === segments.length - 1) seg = seg.replace(/\.[a-z0-9]{2,4}$/i, '');
                var cleaned = cleanShowName(seg);
                if (cleaned) return cleaned;
            }
        }
        return '';
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

    // REST OpenSubtitles по IMDb БЕЗ season/episode — отдаёт ВСЕ субтитры показа сразу.
    function buildRestUrlByImdb(imdb, langCode) {
        var digits = String(imdb || '').replace(/^tt/i, '').replace(/\D/g, '');
        if (!digits) return '';
        return 'https://rest.opensubtitles.org/search/imdbid-' + digits + '/sublanguageid-' + langCode;
    }

    function subtitleDirectDownloadUrl(url) {
        var value = (url || '').trim();
        var query = '';
        var hash = '';
        var hashIndex;
        var queryIndex;

        if (!value) return value;

        if (!/\.srt(?:[?#]|$)/i.test(value) && /subs\d*\.strem\.io\/.*\/file\/[^/?#]+/i.test(value)) {
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

            value = value + '.srt' + query + hash;
        }

        return value;
    }

    function subtitleDownloadUrl(url) {
        var value = subtitleDirectDownloadUrl(url);

        if (/^https?:\/\//i.test(value) && serviceBaseUrl() && value.indexOf(serviceBaseUrl() + '/') !== 0) {
            return serviceUrl('/v1/external/subtitles/proxy?url=' + encodeURIComponent(value));
        }

        return value;
    }

    function mapRestItems(items) {
        if (!items || !items.length) return [];
        var mapped = [];
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (!item || !item.IDSubtitleFile) continue;
            var source = item._source || 'opensubtitles';
            var url;
            if (source === 'subdl') {
                url = item.SubDownloadLink || '';
            }
            else {
                // rest.opensubtitles.org отдаёт .gz, который Lampa.Reguest читает как мусор и
                // парсер выдаёт "Файл субтитров пустой или не распознан". Поэтому всегда тянем
                // через Stremio CDN — там тот же файл, распакованный и нормализованный в UTF-8.
                url = 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/' + item.IDSubtitleFile + '.srt';
            }
            if (!url) continue;
            mapped.push({
                id: item.IDSubtitle || item.IDSubtitleFile,
                url: url,
                lang: item.SubLanguageID || '',
                SubEncoding: 'utf-8',
                m: 'i',
                g: String(parseInt(item.SubDownloadsCnt, 10) || 0),
                _source: source,
                // Имя файла и release-метка из SubDL — чтобы пикер мог их показать.
                release: String(item.MovieReleaseName || '').trim(),
                filename: String(item.MovieName || '').trim(),
                // IMDb который сервер достал через title-резолв (у SubDL результатов).
                resolvedImdb: String(item._resolved_imdb || '').trim()
            });
        }
        return mapped;
    }

    // Stremio-аддон и REST OpenSubtitles возвращают один и тот же саб с разными URL
    // (например `subs5.strem.io/.../file/123456.srt` vs `subs7.strem.io/.../file/123456.srt`).
    // Чтобы дедуп их склеил, ключ берём по числовому IDSubtitleFile из URL/id.
    function subtitleDedupeKey(item, url) {
        if (item && item._source === 'subdl') return 'subdl|' + url;
        var fromUrl = String(url || '').match(/\/(?:file|sub|subtitles)\/(\d{3,})/i);
        if (fromUrl) return 'os|' + fromUrl[1];
        var rawId = String(item && item.id || '');
        if (/^\d{3,}$/.test(rawId)) return 'os|' + rawId;
        return 'url|' + (url || rawId);
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
                // Без IMDb Stremio-аддоны и REST OpenSubtitles не работают, но SubDL умеет
                // искать по tmdb_id/названию. Дёрнем его напрямую, если есть что искать.
                var hasFallbackId = card && (card.id || card.name || card.original_name || card.title || card.original_title);
                var auto = parseEpisode(data || {});
                var hasEpisode = (manualOverride && manualOverride.season && manualOverride.episode) || (auto.season && auto.episode);

                if (hasFallbackId && (hasEpisode || !isSeries(card, data))) {
                    logDebug('search without IMDb, trying SubDL only');
                    fetchFromSubdl(card, null, function (extra) {
                        if (playerId !== activePlayerId) return;
                        stremioSubs = mapStremioResults(extra || []);
                        translatedSubs = mapTranslationCandidates(extra || [], card);
                        searchState = stremioSubs.length || translatedSubs.length ? 'ready' : 'empty';
                        installToPanel();
                        if (manualOverride) {
                            if (stremioSubs.length) notify('Найдено ' + stremioSubs.length + ' субтитров');
                            else if (translatedSubs.length) notify(selectedLanguage().name + ' не найдены, доступен автоперевод с ' + languageName(translatedSubs[0].sourceLang));
                            else notify(selectedLanguage().name + ' не найдены для S' + manualOverride.season + 'E' + manualOverride.episode);
                        }
                    });
                    return;
                }

                searchState = isSeries(card, data) ? 'no-episode' : 'no-imdb';
                installToPanel();
                if (manualOverride) {
                    notify(PLUGIN_TITLE + ': не удалось определить шоу для поиска');
                }
                return;
            }

            var bases = addonBases();
            var lang = selectedLanguage();
            // REST OS принимает один язык за раз. Дёргаем И целевой, И исходный,
            // чтобы у OS было откуда давать ИИ-кандидатов, когда Stremio-аддон
            // молчит/недоступен. Иначе единственный источник на перевод — SubDL.
            var sourceLang = effectiveSourceLanguage(originalLanguageCode(card));
            var restLangs = [lang.code];
            if (sourceLang && sourceLang !== lang.code) restLangs.push(sourceLang);
            var pending = bases.length + restLangs.length;
            var rawList = [];
            var anySuccess = false;
            var lastError = null;
            var subdlAttempted = false;

            logDebug('search', request.type, request.id, 'across', bases.length, 'addons + rest.opensubtitles.org for langs', restLangs.join(','));

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

            restLangs.forEach(function (langCode) {
                var url = buildRestUrl(request.type, request.id, langCode);
                var net = new Lampa.Reguest();

                net.timeout(15000);
                net.silent(url, function (items) {
                    if (playerId !== activePlayerId) return;

                    anySuccess = true;
                    var mapped = mapRestItems(items);
                    rawList = rawList.concat(mapped);

                    logDebug('rest.opensubtitles.org returned', mapped.length, 'items for', langCode);

                    if (--pending === 0) finalize();
                }, function (xhr) {
                    if (playerId !== activePlayerId) return;

                    lastError = lastError || xhr;
                    logDebug('rest.opensubtitles.org error', langCode, xhr && xhr.status);

                    if (--pending === 0) finalize();
                });
            });

            function finalize() {
                stremioSubs = mapStremioResults(rawList);
                translatedSubs = mapTranslationCandidates(rawList, card);

                logDebug('merged', rawList.length, '→ filtered', stremioSubs.length, 'for', selectedLanguage().code, 'translate candidates', translatedSubs.length);

                if (!stremioSubs.length && !translatedSubs.length && !subdlAttempted) {
                    subdlAttempted = true;
                    fetchFromSubdl(card, request, function (extra) {
                        if (playerId !== activePlayerId) return;
                        if (extra && extra.length) {
                            anySuccess = true;
                            rawList = rawList.concat(extra);
                            logDebug('subdl fallback added', extra.length, 'items');
                        }
                        finalize();
                    });
                    return;
                }

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

    function fetchFromSubdl(card, request, done) {
        var titleSearch = manualOverride && manualOverride.type === 'titleSearch';
        var parts = String(request && request.id || '').split(':');
        var imdbId = parts[0] || '';
        var season = parts[1] || '';
        var episode = parts[2] || '';

        if (titleSearch) {
            // Title-search режим: показываем ВСЕ сабы по названию, без фильтра по сезону/серии.
            season = '';
            episode = '';
        }
        else if (!season || !episode) {
            // Обычный режим: подтягиваем season/episode из override или имени файла.
            if (manualOverride) {
                season = season || manualOverride.season || '';
                episode = episode || manualOverride.episode || '';
            }
            if (!season || !episode) {
                var auto = parseEpisode(lastPlayerData || {});
                season = season || (auto.season || '');
                episode = episode || (auto.episode || '');
            }
        }

        var tmdbId = (card && card.id) || '';
        var filenameShow = extractShowFromFilename(lastPlayerData);
        var cardTitle = (card && (card.name || card.original_name || card.title || card.original_title)) || '';
        var queryTitle = (titleSearch && manualOverride.query) || filenameShow || cardTitle;

        if (!imdbId && !tmdbId && !queryTitle) {
            logDebug('subdl fallback skipped — no imdb/tmdb/title');
            done([]);
            return;
        }

        var target = selectedLanguage();
        var sourceLang = effectiveSourceLanguage(originalLanguageCode(card));
        var seen = {};
        var langs = [target.code, sourceLang].filter(function (code) {
            if (!code || seen[code]) return false;
            seen[code] = true;
            return true;
        });

        // Передаём все идентификаторы, которые есть. Сервер выберет imdb_id → tmdb_id → query
        // в этом порядке, и сам автоматически попробует tmdb_id если imdb_id ничего не вернул.
        var qs = 'languages=' + encodeURIComponent(langs.join(','));
        if (imdbId && !titleSearch) qs += '&imdb_id=' + encodeURIComponent(imdbId);
        if (tmdbId && !titleSearch) qs += '&tmdb_id=' + encodeURIComponent(tmdbId);
        if (queryTitle) qs += '&query=' + encodeURIComponent(queryTitle);
        if (season) qs += '&season=' + encodeURIComponent(season);
        if (episode) qs += '&episode=' + encodeURIComponent(episode);
        if (titleSearch && manualOverride.year) qs += '&year=' + encodeURIComponent(manualOverride.year);

        logDebug('subdl' + (titleSearch ? ' title-search' : ' fallback') + ' request', qs);

        serviceRequest('/v1/external/subtitles/search?' + qs, false, function (items) {
            logDebug('subdl returned', Array.isArray(items) ? items.length : 0, 'items');
            if (!Array.isArray(items) || !items.length) return done([]);
            done(mapRestItems(items));
        }, function (xhr) {
            logDebug('subdl request failed', xhr && xhr.status);
            done([]);
        }, { token: false });
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
        // В title-search режиме показываем все результаты, не режем limit'ом.
        var limit = titleSearchInProgress ? 1000 : (parseInt(storage(PLUGIN_ID + '_limit', '15'), 10) || 15);
        var lang = selectedLanguage();
        var seen = {};
        var mapped = [];

        results.forEach(function (item) {
            var rawLang = (item && (item.lang || item.language || item.SubLanguageID || item.iso639)) || '';
            var directUrl = subtitleDirectDownloadUrl(item && item.url);
            var url = subtitleDownloadUrl(item && item.url);

            if (!url || !matchesLanguage(rawLang, lang)) return;

            var key = subtitleDedupeKey(item, url);
            if (seen[key]) return;

            seen[key] = true;

            mapped.push({
                stremio: true,
                source: 'stremio-opensubtitles',
                origin: item && item._source === 'subdl' ? 'subdl' : 'opensubtitles',
                id: item.id || url,
                url: url,
                directUrl: directUrl,
                lang: lang.code,
                langCode: lang.code,
                encoding: item.SubEncoding || item.subEncoding || '',
                match: item.m || '',
                score: item.g || '',
                release: item.release || '',
                filename: item.filename || ''
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
            var directUrl = subtitleDirectDownloadUrl(item && item.url);
            var url = subtitleDownloadUrl(item && item.url);
            var rank = translationSourceRank(sourceLang, original, target.code);

            if (!url || !sourceLang || sourceLang === target.code || rank >= 999) return;

            var key = subtitleDedupeKey(item, url);
            if (seen[key]) return;

            seen[key] = true;
            mapped.push({
                stremio: true,
                translated: true,
                source: 'stremio-opensubtitles-translated',
                origin: item && item._source === 'subdl' ? 'subdl' : 'opensubtitles',
                id: item.id || url,
                url: url,
                directUrl: directUrl,
                sourceUrl: url,
                directSourceUrl: directUrl,
                sourceLang: sourceLang,
                targetLang: target.code,
                lang: target.code,
                langCode: target.code,
                encoding: item.SubEncoding || item.subEncoding || '',
                match: item.m || '',
                score: itemScore(item),
                rank: rank,
                release: item.release || '',
                filename: item.filename || ''
            });
        });

        mapped.sort(function (a, b) {
            if (a.rank !== b.rank) return a.rank - b.rank;
            // При равном языковом ранге предпочитаем OpenSubtitles над SubDL: пользователь
            // явно просил OS как основной источник, SubDL только когда у OS нечего взять.
            if (a.origin !== b.origin) return a.origin === 'subdl' ? 1 : -1;
            return b.score - a.score;
        });

        // В title-search режиме показываем все кандидаты, в обычном — только лучший.
        var keepAll = titleSearchInProgress;
        return keepAll ? mapped : mapped.slice(0, 1);
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

    function setSubsContainerHidden(hidden) {
        if (typeof document === 'undefined' || !document.body) return;
        ensureSubsOffStyles();
        try {
            if (hidden) {
                document.body.classList.add(SUBS_OFF_BODY_CLASS);
                forceHideSubtitleNodes();
            }
            else {
                document.body.classList.remove(SUBS_OFF_BODY_CLASS);
                restoreSubtitleNodes();
            }
        }
        catch (e) {}
    }

    function disableWebosNativeSubtitles() {
        if (!Lampa.Platform || typeof Lampa.Platform.is !== 'function' || !Lampa.Platform.is('webos')) return;

        var video = Lampa.PlayerVideo && Lampa.PlayerVideo.video ? Lampa.PlayerVideo.video() : null;
        if (!video) return;

        try {
            var subs = video.webos_subs;
            if (subs && subs.length) {
                for (var i = 0; i < subs.length; i++) {
                    try { subs[i].selected = false; }
                    catch (e) {}
                }
                for (var j = 0; j < subs.length; j++) {
                    if (subs[j] && subs[j].index === -1) {
                        try { subs[j].mode = 'showing'; }
                        catch (e) {}
                        try { subs[j].selected = true; }
                        catch (e) {}
                        break;
                    }
                }
            }
        }
        catch (e) {}

        try {
            if (typeof window !== 'undefined' && window.webOS && window.webOS.service && video.mediaId) {
                window.webOS.service.request('luna://com.webos.media', {
                    method: 'setSubtitleEnable',
                    parameters: { mediaId: video.mediaId, enable: false },
                    onSuccess: function () {},
                    onFailure: function () {}
                });
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
                playerClosing = false;
                if (renderer.current) {
                    logDebug('disabled picked: stopping renderer');
                    renderer.disable();
                }
                silenceNativeTextTracks();
                disableWebosNativeSubtitles();
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
            title: 'Поиск по названию',
            index: -1,
            stremio: true,
            source: 'stremio-opensubtitles',
            isPicker: true,
            onSelect: function () {
                if (renderer.current && Lampa.PlayerVideo && Lampa.PlayerVideo.subsview) {
                    Lampa.PlayerVideo.subsview(true);
                }
                runTitleSearch();
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

    // Строим запрос для title-search: ОРИГИНАЛЬНОЕ название (без года, год отдельно).
    // Приоритет:
    //  1. Имя шоу из имени файла/торрента (часто Latin romaji, идеально для SubDL/OS).
    //  2. card.original_title / card.original_name из TMDB.
    //  3. card.title / card.name (локализованное — последний фоллбек).
    // Среди всех кандидатов предпочитаем тот, что содержит латиницу (SubDL/OS их индексируют
    // лучше, чем кириллицу/иероглифы).
    function buildTitleSearchQuery(card, data) {
        var candidates = [
            extractShowFromFilename(data),
            card && card.original_title,
            card && card.original_name,
            card && card.title,
            card && card.name
        ].map(function (s) { return String(s || '').trim(); }).filter(Boolean);

        if (!candidates.length) return '';

        for (var i = 0; i < candidates.length; i++) {
            if (/[A-Za-z]/.test(candidates[i])) return candidates[i];
        }
        return candidates[0];
    }

    // Год для title-search передаём отдельным параметром. SubDL принимает `year` как
    // подсказку (не строгий фильтр), это улучшает релевантность без риска отбить
    // правильный результат при mismatched-карточке.
    function buildTitleSearchYear(card, data) {
        var fileText = String((data && (data.fname || data.path || data.url || data.title)) || '');
        try { fileText = decodeURIComponent(fileText); } catch (e) {}
        var m = fileText.match(/\b(?:19|20)\d{2}\b/);
        if (m) return m[0];

        if (card) {
            var date = card.release_date || card.first_air_date || '';
            if (/^\d{4}/.test(date)) return date.slice(0, 4);
        }
        return '';
    }

    function runTitleSearch() {
        var card = activeCard(lastPlayerData);
        var query = buildTitleSearchQuery(card, lastPlayerData);
        var year = buildTitleSearchYear(card, lastPlayerData);

        if (!query) {
            notify(PLUGIN_TITLE + ': не удалось определить название для поиска');
            return;
        }

        notify('Поиск: ' + query + (year ? ' (' + year + ')' : ''));
        logDebug('runTitleSearch query=', query, 'year=', year);

        var lang = selectedLanguage();
        var raw = [];

        titleSearchInProgress = true;
        manualOverride = { type: 'titleSearch', query: query, year: year };

        function finalize() {
            var stremioMapped = mapStremioResults(raw);
            var translatedMapped = mapTranslationCandidates(raw, card);

            titleSearchInProgress = false;
            manualOverride = null;

            var combined = stremioMapped.concat(translatedMapped);
            if (!combined.length) {
                notify('Ничего не найдено по "' + query + '"');
                return;
            }

            openTitleResultsSelect(query, combined, card);
        }

        // Шаг 1: SubDL по названию — заодно зарезолвит правильный IMDb шоу.
        fetchFromSubdl(card, null, function (subdlItems) {
            if (subdlItems && subdlItems.length) raw = raw.concat(subdlItems);
            logDebug('title-search SubDL returned', (subdlItems || []).length, 'items');

            // Шаг 2: REST OpenSubtitles по IMDb (от SubDL или из карточки) — без season/episode.
            var imdb = '';
            for (var i = 0; i < (subdlItems || []).length; i++) {
                if (subdlItems[i] && subdlItems[i].resolvedImdb) { imdb = subdlItems[i].resolvedImdb; break; }
            }
            if (!imdb && card && card.imdb_id) imdb = card.imdb_id;

            if (!imdb) { finalize(); return; }

            // Stremio-аддон OS использует современный API OpenSubtitles и для свежих
            // сериалов (Invincible S04 и т.п.) почти всегда имеет сабы, в отличие от
            // legacy rest.opensubtitles.org. Без него title-search не получает ИИ-кандидатов
            // от OS на новом контенте и юзер видит только SubDL.
            // manualOverride сейчас type='titleSearch', stremioRequestId это спутает, поэтому
            // временно скрываем его, чтобы получить нормальный series/imdb:S:E request.
            var savedOverride = manualOverride;
            manualOverride = null;
            var stremioReq;
            try { stremioReq = stremioRequestId(card, lastPlayerData, imdb); }
            finally { manualOverride = savedOverride; }

            var bases = addonBases();
            var sourceLang = effectiveSourceLanguage(originalLanguageCode(card));
            var langsToFetch = [lang.code];
            if (sourceLang && sourceLang !== lang.code) langsToFetch.push(sourceLang);

            var pending = langsToFetch.length + (stremioReq ? bases.length : 0);
            if (!pending) { finalize(); return; }

            if (stremioReq) {
                bases.forEach(function (base) {
                    var url = buildAddonUrl(base, stremioReq.type, stremioReq.id);
                    logDebug('title-search Stremio addon', base, stremioReq.type, stremioReq.id);

                    var net = new Lampa.Reguest();
                    net.timeout(15000);
                    net.silent(url, function (json) {
                        var items = json && json.subtitles ? json.subtitles : [];
                        items.forEach(function (item) { item._addon = base; });
                        raw = raw.concat(items);
                        logDebug('title-search Stremio addon returned', items.length, 'items');
                        if (--pending === 0) finalize();
                    }, function (xhr) {
                        logDebug('title-search Stremio addon error', base, xhr && xhr.status);
                        if (--pending === 0) finalize();
                    });
                });
            }

            // REST OS как fallback — может пригодиться для старого контента, где Stremio-аддон
            // молчит.
            langsToFetch.forEach(function (langCode) {
                var url = buildRestUrlByImdb(imdb, langCode);
                if (!url) { if (--pending === 0) finalize(); return; }
                logDebug('title-search REST OS by imdb', imdb, langCode);

                var net = new Lampa.Reguest();
                net.timeout(15000);
                net.silent(url, function (items) {
                    var mapped = mapRestItems(items);
                    raw = raw.concat(mapped);
                    logDebug('title-search REST OS returned', mapped.length, 'items for', langCode);
                    if (--pending === 0) finalize();
                }, function (xhr) {
                    logDebug('title-search REST OS error', langCode, xhr && xhr.status);
                    if (--pending === 0) finalize();
                });
            });
        });
    }

    // Lampa.Select с результатами title-search: пользователь видит все варианты с
    // именами файлов и сам выбирает подходящий. Выбранный саб попадает в основной
    // пикер и активируется тем же путём, что обычный пункт.
    function openTitleResultsSelect(query, results, card) {
        if (!Lampa.Select || !Lampa.Select.show) return;

        var prevController = captureController();
        var nextIndex = 1000;

        var items = results.map(function (rawItem) {
            var panelItem = rawItem.translated
                ? createTranslatedSubtitleItem(rawItem, nextIndex++)
                : createSubtitleItem(rawItem, nextIndex++);
            return {
                title: panelItem.label || panelItem.title || 'Без названия',
                _panelItem: panelItem,
                _raw: rawItem
            };
        });

        Lampa.Select.show({
            title: 'Субтитры: ' + query,
            items: items,
            onBack: function () { returnToController(prevController); },
            onSelect: function (selected) {
                returnToController(prevController);
                if (!selected) return;

                // Поместим выбранный саб в основной пикер, чтобы он отображался как активный.
                if (selected._raw && selected._raw.translated) {
                    translatedSubs = [selected._raw];
                }
                else if (selected._raw) {
                    stremioSubs = [selected._raw];
                }
                installToPanel();

                if (selected._panelItem && selected._panelItem.onSelect) {
                    selected._panelItem.onSelect();
                }
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

    function providerName(item) {
        return item && item.origin === 'subdl' ? 'SubDL' : PLUGIN_TITLE;
    }

    // Имя саб-файла из release/filename — то, что пользователь видит на сайте SubDL/OS.
    // Помогает выбрать правильный саб когда title-search возвращает много вариантов.
    function subFileLabel(item) {
        if (!item) return '';
        var release = String(item.release || '').trim();
        var filename = String(item.filename || '').trim();
        // Предпочитаем имя файла, если оно содержит SxxExx или похожий маркер.
        if (filename && /s\d{1,2}\s*e\d{1,3}/i.test(filename)) return filename;
        if (release) return release;
        if (filename) return filename;
        return '';
    }

    function createSubtitleItem(item, index) {
        var fileLabel = subFileLabel(item);
        var label = providerName(item) + (fileLabel ? ' · ' + fileLabel : '');
        var sub = {
            stremio: true,
            source: 'stremio-opensubtitles',
            index: index,
            language: item.lang || selectedLanguage().code,
            label: label,
            title: label,
            url: item.url,
            directUrl: item.directUrl,
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
                if (value === 'showing') {
                    playerClosing = false;
                    ourLastPickAt = Date.now();
                    renderer.select(sub);
                }
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
        var fileLabel = subFileLabel(item);
        var baseTitle = item.native
            ? 'ИИ перевод встроенных с ' + sourceName
            : 'ИИ перевод с ' + sourceName + ' (' + providerName(item) + ')' + (fileLabel ? ' · ' + fileLabel : '');
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
            directUrl: item.directUrl,
            sourceKey: item.sourceKey,
            sourceUrl: item.sourceUrl || (item.native ? '' : item.url),
            directSourceUrl: item.directSourceUrl || item.directUrl,
            sourceText: item.sourceText,
            sourceCues: item.sourceCues,
            sourceChars: item.sourceChars,
            sourceItem: item.sourceItem,
            subFilename: fileLabel,
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
                if (value === 'showing') {
                    playerClosing = false;
                    ourLastPickAt = Date.now();
                    renderer.selectTranslated(sub);
                }
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

            var playerOpened = Lampa.Player && typeof Lampa.Player.opened === 'function' ? Lampa.Player.opened() : true;

            if (!playerOpened) {
                return original.call(this, status);
            }

            if (status === false && renderer.current && !actionWasPicked && playerOpened) {
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

            if (status === true && playerOpened) {
                setSubsContainerHidden(false);
                if (!renderer.internalSubsviewCall && renderer.current && Date.now() - ourLastPickAt > 500 && !actionWasPicked) {
                    logDebug('subsview enabled but our pick is stale → other sub picked, disabling renderer');
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

    function beginPlayerClose() {
        if (playerClosing) return;
        playerClosing = true;
        logDebug('player closing — eager cleanup before Lampa teardown');

        try { renderer.disable(); }
        catch (e) {}

        try { setSubsContainerHidden(false); }
        catch (e) {}

        try {
            latestPanelSubs = [];
            lastKnownSubs = [];
            stremioSubs = [];
            translatedSubs = [];
        }
        catch (e) {}
    }

    function hookPlayerClose() {
        if (!Lampa.Player || typeof Lampa.Player.close !== 'function') return;
        if (Lampa.Player.close._opensub_close_hook === PLUGIN_VERSION) return;

        var original = Lampa.Player.close._opensub_close_original || Lampa.Player.close;

        var wrapper = function () {
            try { beginPlayerClose(); }
            catch (e) { logDebug('beginPlayerClose error', e && e.message); }
            return original.apply(this, arguments);
        };

        wrapper._opensub_close_hook = PLUGIN_VERSION;
        wrapper._opensub_close_original = original;
        Lampa.Player.close = wrapper;

        logDebug('hookPlayerClose: installed');
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

        base.forEach(function (item, pos) {
            if (typeof item.index === 'undefined') item.index = pos;
            nextIndex = Math.max(nextIndex, parseInt(item.index, 10) + 1 || pos + 1);
        });

        var hasResults = stremioSubs.length > 0;
        var externalTranslated = translatedSubs;
        var hasTranslated = externalTranslated.length > 0;

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

        externalTranslated.forEach(function (item) {
            mixed.push(createTranslatedSubtitleItem(item, nextIndex++));
            prefetchTranslationSource(item);
            checkServerTranslationCache(item);
        });

        if (!hasResults && !hasTranslated) {
            var status = statusSubtitle(nextIndex++);
            if (status) mixed.push(status);
        }

        // Кнопка "Поиск по названию" — нужна и для фильмов, и для сериалов.
        mixed.push(searchItem());

        logDebug('install panel: native=' + base.length + ' stremio=' + stremioSubs.length + ' translated=' + translatedSubs.length + ' state=' + searchState);

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

        // Карточка может быть «голой» (торрент без TMDB, прямое открытие файла) — там нет ни
        // title/name, ни original_title. Подставляем имя файла, чтобы бот не показывал
        // «Без названия» в уведомлении админов.
        var title = (card && (card.title || card.name))
            || (lastPlayerData && lastPlayerData.title)
            || (card && (card.original_title || card.original_name))
            || extractShowFromFilename(lastPlayerData)
            || '';

        return {
            imdb_id: card && card.imdb_id || '',
            tmdb_id: card && card.id || '',
            type: series ? 'series' : 'movie',
            title: title,
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
        var media = serviceMediaInfo();
        var subFilename = String(item && item.subFilename || '').trim() || subFileLabel(item);
        if (subFilename) media.subtitle_filename = subFilename;
        var body = {
            device_id: deviceId(),
            plugin_version: PLUGIN_VERSION,
            source_url: item.sourceUrl || item.sourceKey || item.url,
            source_language: item.sourceLang,
            target_language: item.targetLang || selectedLanguage().code,
            media: media,
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

    function fetchSubtitleText(url, fallbackUrl, done, fail, timeoutMs) {
        function request(requestUrl, allowFallback) {
            subtitleNetwork.timeout(timeoutMs || 20000);
            subtitleNetwork.silent(requestUrl, done, function (xhr) {
                if (allowFallback && fallbackUrl && fallbackUrl !== requestUrl) {
                    logDebug('subtitle proxy failed, trying direct url', xhr && xhr.status);
                    request(fallbackUrl, false);
                    return;
                }
                fail(xhr);
            }, false, {
                dataType: 'text'
            });
        }

        request(url, true);
    }

    function loadTranslationSource(item, done, fail) {
        var cues = item && item.sourceCues && item.sourceCues.length ? cloneCues(item.sourceCues) : [];
        var rawText = item && item.sourceText || '';
        var sourceUrl = item && item.sourceUrl || '';

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

        fetchSubtitleText(sourceUrl, item && item.directSourceUrl, function (text) {
            var parsed = parseSubtitles(text || '');

            if (!parsed.length) {
                fail({ message: 'файл субтитров пустой или не распознан' });
                return;
            }

            done({
                rawText: text || '',
                cues: parsed
            });
        }, fail, 20000);
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

            fetchSubtitleText(item.url, item.directUrl, function (text) {
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
            }, 20000);
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

            if (Lampa.PlayerVideo && typeof Lampa.PlayerVideo.subsview === 'function') {
                self.internalSubsviewCall = true;
                try { Lampa.PlayerVideo.subsview(true); } catch (e) {}
                self.internalSubsviewCall = false;
            }

            setTimeout(function () {
                try { installToPanel(); }
                catch (e) { logDebug('renderer.start install panel error', e && e.message); }
            }, 200);

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

        if (/^\s*\[Script Info\]/i.test(raw) || /^\s*\[V4\+? Styles\]/im.test(raw) || /^Dialogue:/m.test(raw)) {
            return parseAssBlocks(raw);
        }

        return parseByBlocks(raw, /^\s*WEBVTT/i.test(raw));
    }

    function parseAssBlocks(raw) {
        var lines = raw.split('\n');
        var cues = [];
        var startIdx = 1, endIdx = 2, textIdx = 9;
        var formatSeen = false;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (!formatSeen && /^Format:/i.test(line) && /\b(start|end|text)\b/i.test(line)) {
                var fields = line.substring(7).split(',').map(function (s) { return s.trim().toLowerCase(); });
                var fs = fields.indexOf('start');
                var fe = fields.indexOf('end');
                var ft = fields.indexOf('text');
                if (fs >= 0) startIdx = fs;
                if (fe >= 0) endIdx = fe;
                if (ft >= 0) textIdx = ft;
                formatSeen = true;
                continue;
            }
            if (!/^Dialogue:/i.test(line)) continue;
            var parts = line.substring(9).split(',');
            if (parts.length < Math.max(startIdx, endIdx, textIdx) + 1) continue;
            var text = parts.slice(textIdx).join(',').trim();
            text = text
                .replace(/\{[^}]*\}/g, '')
                .replace(/\\N/g, '\n')
                .replace(/\\n/gi, '\n')
                .replace(/\\h/g, ' ')
                .trim();
            if (!text) continue;
            cues.push({
                start: assTimeMs(parts[startIdx]),
                end: assTimeMs(parts[endIdx]),
                text: cleanSubtitleText(text)
            });
        }

        cues.sort(function (a, b) { return a.start - b.start; });
        return cues.filter(function (cue) { return cue.end > cue.start && cue.text; });
    }

    function assTimeMs(t) {
        var match = String(t || '').trim().match(/^(\d+):(\d{1,2}):(\d{1,2})\.(\d{1,3})$/);
        if (!match) return 0;
        return (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000 + Number((match[4] + '00').slice(0, 3));
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
        playerClosing = false;
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
    hookPlayerClose();

    Lampa.Player.listener.follow('ready', function (data) {
        playerClosing = false;
        hookPanelSetSubs();
        hookSubsviewSignal();
        hookVideoSubsview();
        hookAndroidOpenPlayer();
        hookSubtitleDelayPicker();
        hookPlayerClose();
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
