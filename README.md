# OpenSubtitles RU для Lampa

Плагин добавляет русские субтитры OpenSubtitles в нативное меню субтитров Lampa. Найденные варианты появляются рядом со встроенными дорожками в панели плеера.

Версия без API key: поиск идет через публичный Stremio addon `OpenSubtitles v3`, который отдает готовые ссылки на `subs5.strem.io`.

## Что умеет

- Ищет русские субтитры для фильмов и серий.
- Использует IMDb ID. Если у карточки Lampa есть только TMDB ID, плагин сам просит у Lampa IMDb ID через TMDB.
- Для сериалов использует формат Stremio `{imdb}:{season}:{episode}`.
- Файл субтитров загружается только после выбора пункта в меню субтитров.
- Не требует OpenSubtitles API key, логин или пароль.

## Установка

1. Разместите `opensubtitles_ru.js` на HTTPS-хостинге, GitHub Pages или локальном сервере, доступном устройству с Lampa.
2. В Lampa откройте `Настройки -> Расширения -> Добавить плагин`.
3. Укажите URL до `opensubtitles_ru.js`, например `https://m3dfatboi.github.io/lampa-opensubtitles-ru/opensubtitles_ru.js`.
4. Откройте `Настройки -> OpenSubtitles RU`.
5. Нажмите `Проверить Stremio addon`, чтобы убедиться, что endpoint доступен с устройства.

## Важное

По умолчанию используется endpoint `https://opensubtitles-v3.strem.io`. Его можно заменить в настройках на совместимый Stremio subtitle addon.

Плагин рассчитан на внутренний плеер Lampa и его нативную панель субтитров. Внешние Android/iOS-плееры управляют субтитрами уже своим интерфейсом.
