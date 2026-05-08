# Платный сервис автоперевода

Этот документ фиксирует продуктовую схему для отдельного платного плагина `opensubtitles_ru_service.js`.

## Ссылки плагинов

- Платный сервисный вариант на старой ссылке: `https://m3dfatboi.github.io/lampa-opensubtitles-ru/opensubtitles_ru.js`
- Платный сервисный вариант на отдельной новой ссылке: `https://m3dfatboi.github.io/lampa-opensubtitles-ru/opensubtitles_ru_service.js`
- Личный вариант с прямым OpenRouter ключом: `https://m3dfatboi.github.io/lampa-opensubtitles-ru/opensubtitles_ru_personal.js`

## Модель

Пользователь не выбирает модель. Модель выбирается на backend через env-переменные.

Рекомендуемая production-настройка:

```env
TRANSLATION_MODEL=openai/gpt-5.1
TRANSLATION_FALLBACK_MODEL=openai/gpt-5.2
TRANSLATION_TEMPERATURE=0.1
```

Причина: `openai/gpt-5.1` находится в топовом классе качества, но заметно дешевле `openai/gpt-5.2` на output-токенах. `openai/gpt-5.2` лучше оставить fallback-моделью для повторной попытки, если основной ответ пришел в плохом формате или перевод не прошел валидацию.

Если нужен максимально премиальный режим любой ценой:

```env
TRANSLATION_MODEL=openai/gpt-5.2
TRANSLATION_FALLBACK_MODEL=anthropic/claude-sonnet-4.5
```

Тарифы ниже рассчитаны так, чтобы выдержать и дорогой режим `gpt-5.2`.

## Экономика кредитов

Текущие цены OpenRouter на момент расчета:

| Модель | Input | Output |
| --- | ---: | ---: |
| `openai/gpt-5.2` | $1.75 / 1M tokens | $14.00 / 1M tokens |
| `openai/gpt-5.1` | $1.25 / 1M tokens | $10.00 / 1M tokens |
| `google/gemini-2.5-pro` | $1.25 / 1M tokens | $10.00 / 1M tokens |
| `anthropic/claude-sonnet-4.5` | $3.00 / 1M tokens | $15.00 / 1M tokens |

Единица списания:

```text
1 кредит = до 10 000 символов исходных субтитров
minimum_charge = 1 кредит
credits = ceil(source_characters / 10000)
```

Консервативная себестоимость 1 кредита на `gpt-5.2`:

- 10 000 символов исходника примерно 2 500-3 000 input tokens.
- Перевод на русский примерно 3 000-3 800 output tokens.
- С учетом overhead batch-промптов: около $0.045-$0.060.
- При курсе с запасом 100 ₽/$: около 4.5-6 ₽ за кредит.

В расчет тарифа заложить:

- себестоимость OpenRouter: до 6 ₽ / кредит;
- Robokassa + платежные потери: 5-7%;
- налог/учет/возвраты/резерв: 6-10%;
- желаемая валовая маржа: не ниже 35-45%.

Рекомендуемые пакеты:

| Пакет | Цена | Цена кредита до комиссий | Примерно хватает |
| --- | ---: | ---: | --- |
| 30 кредитов | 299 ₽ | 9.97 ₽ | 6-10 серий или 4-6 фильмов |
| 100 кредитов | 899 ₽ | 8.99 ₽ | 25-35 серий или 15-20 фильмов |
| 300 кредитов | 2390 ₽ | 7.97 ₽ | 80-110 серий или 45-60 фильмов |
| 1000 кредитов | 6990 ₽ | 6.99 ₽ | heavy users |

Пробный баланс:

```text
new_user_trial_credits = 3
```

Важно: не продавать безлимит. Даже при хорошем кэше безлимит ломает экономику на длинных сериалах.

## Backend API contract

Плагин ожидает API base URL в настройке `Сервер перевода`. По умолчанию там placeholder, его нужно заменить на реальный URL перед публичным запуском.

### Создание сессии привязки

`POST /v1/devices/session`

Request:

```json
{
  "device_id": "lmp-...",
  "plugin_version": "v1-service-credits",
  "platform": "android",
  "target_language": "rus"
}
```

Response:

```json
{
  "session_id": "sess_...",
  "code": "A7K2Q9",
  "bot_url": "https://t.me/bot?start=A7K2Q9",
  "expires_in": 600
}
```

### Проверка привязки

`GET /v1/devices/session/:session_id`

Response pending:

```json
{
  "status": "pending"
}
```

Response linked:

```json
{
  "status": "linked",
  "device_token": "dev_...",
  "balance": 30
}
```

### Старт перевода

`POST /v1/translations`

Headers:

```http
Authorization: Bearer dev_...
Content-Type: application/json
```

Request:

```json
{
  "device_id": "lmp-...",
  "plugin_version": "v1-service-credits",
  "source_url": "https://subs5.strem.io/...",
  "source_language": "eng",
  "target_language": "rus",
  "media": {
    "imdb_id": "tt1234567",
    "tmdb_id": 123,
    "type": "series",
    "title": "Title",
    "original_title": "Original Title",
    "original_language": "eng",
    "season": 1,
    "episode": 3
  },
  "subtitle": {
    "text": "raw SRT/VTT",
    "cues": [
      { "start": 1000, "end": 2500, "text": "Hello" }
    ],
    "cues_count": 1
  }
}
```

Response queued:

```json
{
  "status": "queued",
  "job_id": "job_...",
  "reserved_credits": 3
}
```

Response from cache/completed:

```json
{
  "status": "completed",
  "credits_spent": 3,
  "balance": 27,
  "cues": [
    { "start": 1000, "end": 2500, "text": "Привет" }
  ]
}
```

### Проверка задачи

`GET /v1/translations/:job_id`

Response processing:

```json
{
  "status": "processing",
  "progress": "2/8"
}
```

Response completed:

```json
{
  "status": "completed",
  "credits_spent": 3,
  "balance": 27,
  "cues": [
    { "start": 1000, "end": 2500, "text": "Привет" }
  ]
}
```

## Telegram bot

Команды:

- `/start CODE` - привязка устройства.
- `Баланс` - показать кредиты.
- `Купить кредиты` - показать пакеты Robokassa.
- `Мои устройства` - список и отвязка устройств.
- `Помощь` - короткая инструкция.

## Robokassa

Покупки кредитов идут пакетами, не рекуррентной подпиской на первом этапе. Рекуррентные платежи у Robokassa доступны только по предварительному согласованию, поэтому продукт не должен зависеть от них.

Обязательные требования:

- каждый invoice имеет уникальный `InvId`;
- `ResultURL` проверяет подпись;
- начисление кредитов идемпотентное;
- успешный `ResultURL` отвечает `OK{InvId}`;
- `Receipt` передается, если подключена фискализация.

## Защита от абьюза

- Не хранить OpenRouter key в плагине.
- Device token хранится только в Lampa Storage.
- Один перевод = reserve credits -> translate -> commit credits.
- При ошибке перевода reserved credits возвращаются.
- Кэшировать по `subtitle_hash + source_lang + target_lang + model_version`.
- Ограничить `subtitle.text` по размеру, например 250 000 символов.
- Ограничить число активных jobs на пользователя.
- Админ-команды бота: баланс, начисление, блокировка, возврат кредитов.
