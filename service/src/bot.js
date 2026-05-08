import https from 'node:https';
import { sleep } from './utils.js';

function mainKeyboard() {
  return {
    keyboard: [
      [{ text: 'Баланс' }, { text: 'Купить кредиты' }],
      [{ text: 'Мои устройства' }, { text: 'Помощь' }]
    ],
    resize_keyboard: true
  };
}

function userTitle(user) {
  if (user.username) return `@${user.username}`;
  return user.first_name || user.telegram_id;
}

function isAdmin(config, telegramId) {
  return config.telegram.admins.includes(String(telegramId));
}

function createForcedLookup(ip) {
  return (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const lookupOptions = typeof options === 'function' ? {} : options;

    if (lookupOptions?.all) {
      done(null, [{ address: ip, family: 4 }]);
      return;
    }

    done(null, ip, 4);
  };
}

function postJson(options, payload) {
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const request = https.request({
      method: 'POST',
      timeout: options.timeoutMs,
      hostname: options.hostname,
      port: options.port || 443,
      path: options.path,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      lookup: options.lookup
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        responseBody += chunk;
      });
      response.on('end', () => {
        let json = null;
        try {
          json = responseBody ? JSON.parse(responseBody) : null;
        }
        catch (error) {
          reject(error);
          return;
        }
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, json });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`Telegram request timed out after ${options.timeoutMs}ms`));
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function directTelegramRequest(config, method, payload) {
  const host = config.telegram.apiHost || 'api.telegram.org';
  const forcedIp = config.telegram.apiIp;
  const lookup = forcedIp ? createForcedLookup(forcedIp) : undefined;

  return postJson({
    timeoutMs: config.telegram.apiTimeoutMs,
    hostname: host,
    path: `/bot${config.telegram.token}/${method}`,
    lookup
  }, payload);
}

async function proxyTelegramRequest(config, method, payload) {
  const url = new URL(config.telegram.proxyUrl);
  return postJson({
    timeoutMs: config.telegram.apiTimeoutMs,
    hostname: url.hostname,
    port: url.port || 443,
    path: `${url.pathname || '/'}${url.search || ''}`
  }, { method, ...payload });
}

export class TelegramBot {
  constructor(config, service, store) {
    this.config = config;
    this.service = service;
    this.store = store;
    this.offset = 0;
    this.running = false;
  }

  get enabled() {
    return Boolean(this.config.telegram.token);
  }

  async api(method, payload) {
    if (!this.enabled) return null;

    const response = this.config.telegram.proxyUrl
      ? await proxyTelegramRequest(this.config, method, payload)
      : await directTelegramRequest(this.config, method, payload);

    if (!response.ok || !response.json?.ok) throw new Error(response.json?.description || `Telegram ${method} failed`);
    return response.json.result;
  }

  async sendMessage(chatId, text, extra = {}) {
    return this.api('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra
    });
  }

  async answerCallbackQuery(callbackQueryId, text = '') {
    return this.api('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
      show_alert: false
    });
  }

  start() {
    if (!this.enabled) {
      console.warn('[bot] TELEGRAM_BOT_TOKEN is not set, bot is disabled');
      return;
    }

    this.running = true;
    this.loop().catch((error) => console.error('[bot] loop crashed', error));
  }

  stop() {
    this.running = false;
  }

  async loop() {
    while (this.running) {
      try {
        const updates = await this.api('getUpdates', {
          offset: this.offset,
          timeout: 30,
          allowed_updates: ['message', 'callback_query']
        });

        for (const update of updates || []) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      }
      catch (error) {
        console.error('[bot] polling error', error.message);
        await sleep(3000);
      }
    }
  }

  async handleUpdate(update) {
    if (update.message) return this.handleMessage(update.message);
    if (update.callback_query) return this.handleCallback(update.callback_query);
  }

  async handleMessage(message) {
    const text = (message.text || '').trim();
    const user = message.from;
    const chatId = message.chat.id;

    if (!user) return;

    if (text.startsWith('/start')) {
      const code = text.split(/\s+/)[1];
      if (code) return this.linkDevice(chatId, user, code);

      this.store.ensureUser(user);
      return this.sendMessage(chatId, 'Привет. Я подключаю автоперевод субтитров для Lampa и показываю баланс кредитов.', {
        reply_markup: mainKeyboard()
      });
    }

    if (text.startsWith('/')) return this.handleCommand(chatId, user, text);

    if (/баланс/i.test(text)) return this.showBalance(chatId, user);
    if (/купить/i.test(text)) return this.showPackages(chatId, user);
    if (/устройств/i.test(text)) return this.showDevices(chatId, user);
    if (/помощ/i.test(text)) return this.showHelp(chatId);

    return this.sendMessage(chatId, 'Выберите действие на клавиатуре ниже.', { reply_markup: mainKeyboard() });
  }

  async handleCommand(chatId, telegramUser, text) {
    const [command, arg1, arg2, arg3] = text.split(/\s+/);

    if (!isAdmin(this.config, telegramUser.id)) {
      return this.sendMessage(chatId, 'Команда не найдена.', { reply_markup: mainKeyboard() });
    }

    if (command === '/stats') {
      const stats = this.store.stats();
      return this.sendMessage(chatId, [
        `Пользователей: ${stats.users}`,
        `Оплачено: ${stats.paid.count} платежей / ${Number(stats.paid.amount).toFixed(2)} ₽`,
        `Кэш: ${stats.cache.count} переводов / ${stats.cache.hits} попаданий`,
        'Задачи:',
        ...stats.jobs.map((row) => `${row.status}: ${row.count}`)
      ].join('\n'));
    }

    if (command === '/grant') {
      const target = this.store.getUserByTelegramId(arg1);
      const credits = Number.parseInt(arg2, 10);
      if (!target || !credits) return this.sendMessage(chatId, 'Использование: /grant TELEGRAM_ID CREDITS');
      this.store.tx(() => {
        this.store.updateUserBalance(target.id, target.balance + credits);
        this.store.addLedger(target.id, credits, 'admin_grant', 'admin', String(telegramUser.id));
      });
      return this.sendMessage(chatId, `Начислено ${credits} кредитов пользователю ${arg1}.`);
    }

    if (command === '/unlimited' || command === '/block') {
      const target = this.store.getUserByTelegramId(arg1);
      if (!target || !['on', 'off'].includes(arg2)) return this.sendMessage(chatId, `Использование: ${command} TELEGRAM_ID on|off`);
      this.store.setUserFlag(target.id, command === '/unlimited' ? 'unlimited' : 'blocked', arg2 === 'on');
      return this.sendMessage(chatId, `${command.slice(1)} для ${arg1}: ${arg2}`);
    }

    if (command === '/balance') {
      const target = this.store.getUserByTelegramId(arg1 || telegramUser.id);
      if (!target) return this.sendMessage(chatId, 'Пользователь не найден.');
      return this.sendMessage(chatId, `${userTitle(target)}: ${target.unlimited ? 'безлимит' : `${target.balance} кредитов`}`);
    }

    if (command === '/revoke') {
      const target = this.store.getUserByTelegramId(arg1);
      if (!target || !arg2) return this.sendMessage(chatId, 'Использование: /revoke TELEGRAM_ID DEVICE_ID');
      const ok = this.store.revokeDevice(target.id, arg2);
      return this.sendMessage(chatId, ok ? 'Устройство отвязано.' : 'Устройство не найдено.');
    }

    if (command === '/help') return this.showHelp(chatId);

    return this.sendMessage(chatId, [
      'Админ-команды:',
      '/stats',
      '/grant TELEGRAM_ID CREDITS',
      '/unlimited TELEGRAM_ID on|off',
      '/block TELEGRAM_ID on|off',
      '/balance TELEGRAM_ID'
    ].join('\n'));
  }

  async handleCallback(callback) {
    const data = callback.data || '';
    const user = callback.from;
    const chatId = callback.message?.chat?.id || user.id;

    await this.answerCallbackQuery(callback.id);

    if (data === 'balance') return this.showBalance(chatId, user);
    if (data === 'buy') return this.showPackages(chatId, user);
    if (data === 'devices') return this.showDevices(chatId, user);
    if (data === 'help') return this.showHelp(chatId);

    if (data.startsWith('buy:')) {
      const packageId = data.slice(4);
      try {
        const payment = this.service.createPaymentForUser(user, packageId);
        return this.sendMessage(chatId, `Счёт #${payment.inv_id} создан. После оплаты кредиты начислятся автоматически.`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Оплатить в Robokassa', url: payment.payment_url }],
              [{ text: 'Баланс', callback_data: 'balance' }]
            ]
          }
        });
      }
      catch (error) {
        return this.sendMessage(chatId, error.message || 'Не удалось создать счёт.');
      }
    }

    if (data.startsWith('revoke:')) {
      const deviceId = data.slice(7);
      const dbUser = this.store.ensureUser(user);
      const ok = this.store.revokeDevice(dbUser.id, deviceId);
      return this.sendMessage(chatId, ok ? 'Устройство отвязано.' : 'Устройство уже отвязано или не найдено.');
    }
  }

  async linkDevice(chatId, telegramUser, code) {
    try {
      const result = this.service.linkDeviceByCode(code, telegramUser);
      const balance = result.user.unlimited ? 'безлимит' : `${result.user.balance} кредитов`;
      return this.sendMessage(chatId, `Готово, Lampa подключена.\nБаланс: ${balance}`, {
        reply_markup: mainKeyboard()
      });
    }
    catch (error) {
      return this.sendMessage(chatId, error.message || 'Не удалось привязать устройство.', {
        reply_markup: mainKeyboard()
      });
    }
  }

  async showBalance(chatId, telegramUser) {
    const user = this.store.ensureUser(telegramUser);
    const text = user.unlimited
      ? 'Баланс: безлимитный доступ.'
      : `Баланс: ${user.balance} кредитов.`;
    return this.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Купить кредиты', callback_data: 'buy' }],
          [{ text: 'Мои устройства', callback_data: 'devices' }]
        ]
      }
    });
  }

  async showPackages(chatId, telegramUser) {
    this.store.ensureUser(telegramUser);
    const keyboard = this.config.product.packages.map((pkg) => ([{
      text: `${pkg.title} - ${Number(pkg.price).toFixed(0)} ₽`,
      callback_data: `buy:${pkg.id}`
    }]));

    return this.sendMessage(chatId, 'Выберите пакет кредитов:', {
      reply_markup: { inline_keyboard: keyboard }
    });
  }

  async showDevices(chatId, telegramUser) {
    const user = this.store.ensureUser(telegramUser);
    const devices = this.store.listUserDevices(user.id).filter((device) => !device.revoked_at);

    if (!devices.length) return this.sendMessage(chatId, 'Устройства пока не подключены. Откройте сервисный плагин в Lampa и отсканируйте QR-код.');

    const lines = devices.map((device, index) => {
      const name = device.platform || 'unknown';
      return `${index + 1}. ${name}, ${device.target_language || 'lang'}, последняя активность: ${device.last_seen_at}`;
    });
    const keyboard = devices.map((device, index) => ([{
      text: `Отвязать #${index + 1}`,
      callback_data: `revoke:${device.id}`
    }]));

    return this.sendMessage(chatId, lines.join('\n'), {
      reply_markup: { inline_keyboard: keyboard }
    });
  }

  async showHelp(chatId) {
    return this.sendMessage(chatId, [
      'Как подключить:',
      '1. Откройте Lampa -> настройки OpenSubtitles.',
      '2. Выберите AI-субтитры в плеере.',
      '3. Если плагин попросит Telegram, отсканируйте QR-код или откройте ссылку.',
      '',
      'Кредиты списываются только когда перевод успешно готов. Если перевод упал, резерв возвращается.'
    ].join('\n'), { reply_markup: mainKeyboard() });
  }

  async notifyPayment(user, payment) {
    if (!user?.telegram_id) return;
    const fresh = this.store.getUserById(user.id);
    await this.sendMessage(user.telegram_id, `Оплата прошла. Начислено ${payment.credits} кредитов.\nБаланс: ${fresh.balance} кредитов.`);
  }
}
