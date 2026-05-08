# Lampa OpenSubtitles Translate Service

Один процесс для платного автоперевода:

- HTTP API для сервисного плагина Lampa;
- Telegram bot для привязки устройств, баланса и покупки кредитов;
- Robokassa ResultURL/SuccessURL/FailURL;
- SQLite база;
- очередь переводов через OpenRouter;
- кэш готовых переводов;
- кэш успешно переведенных чанков для продолжения после частичной ошибки без повторной оплаты уже готовых кусков;
- админский безлимит через `UNLIMITED_TELEGRAM_IDS`.

## Быстрый запуск

```bash
cd service
cp .env.example .env
nano .env
node src/index.js
```

Проверка:

```bash
curl http://127.0.0.1:8090/health
```

## Что указать в `.env`

Минимум для теста:

```env
PUBLIC_BASE_URL=http://SERVER_IP:8090
TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=...
ADMIN_TELEGRAM_IDS=ваш_telegram_id
UNLIMITED_TELEGRAM_IDS=ваш_telegram_id
OPENROUTER_API_KEY=...
TRANSLATION_MODEL=google/gemini-2.5-flash
TRANSLATION_FALLBACK_MODEL=google/gemini-2.5-pro
```

Для оплат:

```env
ROBOKASSA_MERCHANT_LOGIN=...
ROBOKASSA_PASSWORD1=...
ROBOKASSA_PASSWORD2=...
ROBOKASSA_TEST=false
```

В Robokassa:

- `ResultURL`: `https://SERVER/payments/robokassa/result`
- `SuccessURL`: `https://SERVER/payments/robokassa/success`
- `FailURL`: `https://SERVER/payments/robokassa/fail`

## API для плагина

Плагин уже ожидает эти endpoint-ы:

- `POST /v1/devices/session`
- `GET /v1/devices/session/:session_id`
- `POST /v1/translations`
- `GET /v1/translations/:job_id`

## Telegram команды

Пользовательские:

- `/start CODE`
- `Баланс`
- `Купить кредиты`
- `Мои устройства`
- `Помощь`

Админские:

- `/stats`
- `/grant TELEGRAM_ID CREDITS`
- `/unlimited TELEGRAM_ID on|off`
- `/block TELEGRAM_ID on|off`
- `/balance TELEGRAM_ID`

## Systemd

Пример юнита лежит в `systemd/lampa-opensubtitles-service.service`.

```bash
sudo useradd --system --home /opt/lampa-opensubtitles --shell /usr/sbin/nologin lampa
sudo mkdir -p /opt/lampa-opensubtitles
sudo cp -r service /opt/lampa-opensubtitles/service
sudo chown -R lampa:lampa /opt/lampa-opensubtitles
sudo cp service/systemd/lampa-opensubtitles-service.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lampa-opensubtitles-service
```
