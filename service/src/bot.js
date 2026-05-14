import https from 'node:https';
import { sleep } from './utils.js';

function mainKeyboard() {
  return {
    keyboard: [
      [{ text: 'Ввести код' }],
      [{ text: 'Баланс' }, { text: 'Купить кредиты' }],
      [{ text: 'История' }],
      [{ text: 'Мои устройства' }, { text: 'Помощь' }]
    ],
    resize_keyboard: true
  };
}

const LANGUAGE_NAMES_RU = {
  eng: 'Английский',
  rus: 'Русский',
  spa: 'Испанский',
  fre: 'Французский',
  fra: 'Французский',
  ger: 'Немецкий',
  deu: 'Немецкий',
  ita: 'Итальянский',
  por: 'Португальский',
  pol: 'Польский',
  ukr: 'Украинский',
  tur: 'Турецкий',
  jpn: 'Японский',
  chi: 'Китайский',
  zho: 'Китайский',
  kor: 'Корейский',
  ara: 'Арабский',
  hin: 'Хинди',
  dut: 'Нидерландский',
  nld: 'Нидерландский',
  swe: 'Шведский',
  nor: 'Норвежский',
  dan: 'Датский',
  fin: 'Финский',
  rum: 'Румынский',
  ron: 'Румынский',
  cze: 'Чешский',
  ces: 'Чешский',
  hun: 'Венгерский',
  gre: 'Греческий',
  ell: 'Греческий',
  heb: 'Иврит',
  vie: 'Вьетнамский',
  tha: 'Тайский',
  ind: 'Индонезийский',
  may: 'Малайский',
  msa: 'Малайский'
};

const RU_MONTHS_GENITIVE = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function languageNameRu(code) {
  return LANGUAGE_NAMES_RU[String(code || '').toLowerCase()] || String(code || '?').toUpperCase();
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeParseMedia(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; }
  catch (_) { return {}; }
}

function filenameFromUrl(url) {
  if (!url) return '';
  const clean = String(url).split('?')[0].split('#')[0];
  const parts = clean.split('/');
  let last = parts[parts.length - 1] || '';
  try { last = decodeURIComponent(last); }
  catch (_) {}
  last = last.replace(/\.(srt|ass|ssa|vtt|gz|zip)$/i, '').trim();
  if (/^\d{4,}$/.test(last)) return '';
  return last;
}

function resolveDisplayTitle(media, sourceUrl) {
  const title = String(media.title || '').trim();
  if (title) return title;
  const originalTitle = String(media.original_title || '').trim();
  if (originalTitle) return originalTitle;
  const subFilename = String(media.subtitle_filename || '').trim();
  if (subFilename) return subFilename;
  const urlName = filenameFromUrl(sourceUrl);
  if (urlName) return urlName;
  if (media.imdb_id) return `imdb:${media.imdb_id}`;
  if (media.tmdb_id) return `tmdb:${media.tmdb_id}`;
  return 'Без названия';
}

function formatHistoryDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const day = date.getDate();
  const month = RU_MONTHS_GENITIVE[date.getMonth()] || '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${day} ${month}, ${hours}:${minutes}`;
}

function pluralRu(n, [one, few, many]) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

function formatRelativeTime(value, now = new Date()) {
  if (!value) return 'неизвестно';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'неизвестно';

  const diffSec = Math.round((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 0) return 'только что';
  if (diffSec < 45) return 'только что';

  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} ${pluralRu(diffMin, ['минуту', 'минуты', 'минут'])} назад`;

  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} ${pluralRu(diffHour, ['час', 'часа', 'часов'])} назад`;

  const diffDay = Math.round(diffHour / 24);
  if (diffDay === 1) return `вчера в ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (diffDay < 7) return `${diffDay} ${pluralRu(diffDay, ['день', 'дня', 'дней'])} назад`;

  return formatHistoryDate(value);
}

function estimateCredits(chars, creditChars) {
  if (!chars) return 0;
  return Math.max(1, Math.ceil(Number(chars) / Math.max(1, Number(creditChars) || 10000)));
}

function formatHistoryCredits(row, creditChars) {
  const spent = Number(row.credits_spent) || 0;
  if (spent > 0) return `${spent} кр.`;

  const estimate = estimateCredits(row.source_chars, creditChars);
  if (!estimate) return 'безлимит';
  return `${estimate} кр. (безлимит)`;
}

function formatHistoryEntry(row, index, creditChars) {
  const media = safeParseMedia(row.media_json);
  const title = resolveDisplayTitle(media, row.source_url);
  const originalTitle = String(media.original_title || '').trim();

  const meta = [];
  if (media.type === 'series' && Number(media.season) && Number(media.episode)) {
    meta.push(`S${String(media.season).padStart(2, '0')}E${String(media.episode).padStart(2, '0')}`);
  }
  if (media.year) meta.push(escapeHtml(String(media.year)));

  const headTail = meta.length ? ` · ${meta.join(' · ')}` : '';
  const originalTail = originalTitle && originalTitle !== title
    ? ` <i>(${escapeHtml(originalTitle)})</i>`
    : '';
  const headLine = `${index}. <b>${escapeHtml(title)}</b>${headTail}${originalTail}`;

  const langs = `${languageNameRu(row.source_language)} → ${languageNameRu(row.target_language)}`;
  const credits = formatHistoryCredits(row, creditChars);
  const date = formatHistoryDate(row.completed_at || row.created_at);

  const second = [langs, credits, date].filter(Boolean).join(' · ');
  const subFilename = String(media.subtitle_filename || '').trim();
  const subLine = subFilename && subFilename !== title ? `\n   <i>${escapeHtml(subFilename)}</i>` : '';

  return `${headLine}${subLine}\n   ${second}`;
}

function startText() {
  return [
    'Привет. Я бот ИИ-перевода субтитров для Lampa.',
    '',
    'Я привязываю Lampa к вашему балансу, показываю кредиты и помогаю купить переводы после бесплатного лимита.',
    '',
    'Чтобы подключить устройство, откройте окно привязки в плагине OpenSubtitles и отправьте сюда код из 6 символов. Например: ABC123.',
    '',
    'Если вы сканировали QR-код, код обычно передается автоматически.'
  ].join('\n');
}

function codePromptText() {
  return 'Отправьте код из окна привязки Lampa одним сообщением. Код состоит из 6 символов, например ABC123.';
}

function extractLinkCode(text) {
  const normalized = String(text || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(normalized)) return normalized;
  return '';
}

function userTitle(user) {
  if (user.username) return `@${user.username}`;
  return user.first_name || user.telegram_id;
}

function formatUserMention(user) {
  if (!user) return 'неизвестный пользователь';
  const id = String(user.telegram_id || '').trim();
  if (id.startsWith('anon:')) return 'Анонимное устройство';

  const firstName = String(user.first_name || '').trim() || 'Без имени';
  const username = String(user.username || '').trim();
  const link = id ? `<a href="tg://user?id=${escapeHtml(id)}">${escapeHtml(firstName)}</a>` : escapeHtml(firstName);
  return username ? `${link} @${escapeHtml(username)}` : link;
}

function formatUserForStats(user, index) {
  const id = String(user.telegram_id || '').trim();
  const username = String(user.username || '').trim();
  const firstName = String(user.first_name || '').trim() || 'Без имени';
  const nameLink = `<a href="tg://user?id=${escapeHtml(id)}">${escapeHtml(firstName)}</a>`;
  const handle = username ? ` @${escapeHtml(username)}` : '';

  const tags = [];
  if (user.unlimited) tags.push('безлимит');
  else tags.push(`${user.balance} кр.`);
  if (user.blocked) tags.push('blocked');
  if (Number(user.translations_done) > 0) {
    tags.push(`${user.translations_done} перев.`);
  }
  if (!user.unlimited && Number(user.credits_spent) > 0) {
    tags.push(`-${user.credits_spent} кр.`);
  }

  return `${index}. ${nameLink}${handle} · <code>${escapeHtml(id)}</code> · ${tags.join(' · ')}`;
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
      return this.sendMessage(chatId, startText(), {
        reply_markup: mainKeyboard()
      });
    }

    if (text.startsWith('/')) return this.handleCommand(chatId, user, text);

    if (/ввести\s+код/i.test(text)) return this.sendMessage(chatId, codePromptText(), { reply_markup: mainKeyboard() });

    const linkCode = extractLinkCode(text);
    if (linkCode) return this.linkDevice(chatId, user, linkCode);

    if (/баланс/i.test(text)) return this.showBalance(chatId, user);
    if (/купить/i.test(text)) return this.showPackages(chatId, user);
    if (/истори/i.test(text)) return this.showHistory(chatId, user);
    if (/устройств/i.test(text)) return this.showDevices(chatId, user);
    if (/помощ/i.test(text)) return this.showHelp(chatId);

    return this.sendMessage(chatId, 'Если хотите подключить Lampa, отправьте код из окна привязки. Или выберите действие на клавиатуре ниже.', { reply_markup: mainKeyboard() });
  }

  async handleCommand(chatId, telegramUser, text) {
    const [commandRaw, arg1, arg2, arg3] = text.split(/\s+/);
    const command = String(commandRaw || '').toLowerCase();

    if (command === '/help') return this.showHelp(chatId);
    if (command === '/code' || command === '/connect' || command === '/link') {
      return this.sendMessage(chatId, codePromptText(), { reply_markup: mainKeyboard() });
    }
    if (command === '/history') return this.showHistory(chatId, telegramUser);
    if (command === '/balance' && !arg1) return this.showBalance(chatId, telegramUser);

    if (!isAdmin(this.config, telegramUser.id)) {
      return this.sendMessage(chatId, 'Команда не найдена.', { reply_markup: mainKeyboard() });
    }

    if (command === '/stats') {
      const stats = this.store.stats();
      const userLimit = Math.max(1, Math.min(100, Number.parseInt(arg1, 10) || 30));
      const linkedUsers = this.store.listLinkedUsers ? this.store.listLinkedUsers(userLimit) : [];

      const u = stats.users;
      const p = stats.payments;
      const t = stats.translations;
      const totalTranslations = t.completed + t.failed;
      const successRate = totalTranslations > 0 ? Math.round((t.completed / totalTranslations) * 100) : 0;
      const charsM = (Number(t.chars_translated) / 1_000_000).toFixed(2);

      const lines = [
        '<b>Пользователи</b>',
        `· С Telegram: ${u.linked}${u.unlimited ? ` (${u.unlimited} безлимит)` : ''}`,
        `· Анонимные устройства: ${u.anonymous}`
      ];
      if (u.blocked) lines.push(`· Заблокированных: ${u.blocked}`);

      lines.push('');
      lines.push('<b>Деньги</b>');
      lines.push(`· Платежей: ${p.count} на ${Number(p.amount).toFixed(0)} ₽`);
      lines.push(`· Куплено кредитов: ${p.credits_sold}`);
      lines.push(`· Не потрачено пользователями: ${stats.credits_outstanding} кр.`);

      lines.push('');
      lines.push('<b>Переводы</b>');
      lines.push(`· Успешно: ${t.completed} · Ошибок: ${t.failed}` + (t.in_flight ? ` · В работе: ${t.in_flight}` : ''));
      if (totalTranslations) lines.push(`· Успешность: ${successRate}%`);
      lines.push(`· За сутки: ${t.last_24h.count} (${t.last_24h.credits} кр.)`);
      lines.push(`· За неделю: ${t.last_7d.count} (${t.last_7d.credits} кр.)`);
      lines.push(`· Всего списано: ${t.credits_spent} кр. · переведено ${charsM} млн символов`);

      if (linkedUsers.length) {
        lines.push('');
        lines.push(`<b>Активные пользователи</b> (последние ${linkedUsers.length}${u.linked > linkedUsers.length ? ` из ${u.linked}` : ''})`);
        linkedUsers.forEach((user, index) => {
          lines.push(formatUserForStats(user, index + 1));
        });
        if (u.linked > linkedUsers.length) {
          lines.push('');
          lines.push(`Больше: <code>/stats N</code> (до 100)`);
        }
      }

      return this.sendMessage(chatId, lines.join('\n'));
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

    return this.sendMessage(chatId, [
      'Админ-команды:',
      '/stats [N] — статистика и список из N последних активных пользователей (1..100, по умолчанию 30)',
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
    if (data === 'history') return this.showHistory(chatId, user);
    if (data === 'help') return this.showHelp(chatId);

    if (data.startsWith('buy:')) {
      const packageId = data.slice(4);

      if (!this.service.robokassa || !this.service.robokassa.isConfigured()) {
        return this.sendMessage(chatId, this.manualPaymentText(), {
          reply_markup: this.manualPaymentKeyboard()
        });
      }

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
      const result = this.service.linkDeviceByCode(extractLinkCode(code) || code, telegramUser);
      const balance = result.user.unlimited ? 'безлимит' : `${result.user.balance} кредитов`;
      return this.sendMessage(chatId, `Готово, Lampa подключена.\nБаланс: ${balance}`, {
        reply_markup: mainKeyboard()
      });
    }
    catch (error) {
      return this.sendMessage(chatId, `${error.message || 'Не удалось привязать устройство.'}\n\n${codePromptText()}`, {
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
          [{ text: 'История', callback_data: 'history' }],
          [{ text: 'Мои устройства', callback_data: 'devices' }]
        ]
      }
    });
  }

  async showHistory(chatId, telegramUser) {
    const user = this.store.ensureUser(telegramUser);
    const rows = this.store.listUserTranslations(user.id, 10);

    if (!rows.length) {
      return this.sendMessage(chatId, 'История переводов пуста. Запустите ИИ-перевод субтитров в Lampa, и переводы появятся здесь.', {
        reply_markup: mainKeyboard()
      });
    }

    const creditChars = this.config.product.creditChars;
    const totalCredits = rows.reduce((sum, row) => sum + (Number(row.credits_spent) || 0), 0);
    const lines = rows.map((row, index) => formatHistoryEntry(row, index + 1, creditChars));

    const header = `Последние переводы: ${rows.length}` +
      (totalCredits > 0 ? ` · Списано кредитов: ${totalCredits}` : '');

    return this.sendMessage(chatId, [header, '', lines.join('\n\n')].join('\n'), {
      reply_markup: mainKeyboard()
    });
  }

  manualPaymentText() {
    const contact = String(this.config.product.manualPaymentContact || '@m3dv3d3v').trim();
    const handle = contact.replace(/^@/, '');
    const link = `<a href="https://t.me/${encodeURIComponent(handle)}">@${escapeHtml(handle)}</a>`;
    return [
      'Онлайн-оплата пока не подключена.',
      '',
      `Чтобы пополнить баланс, напишите ${link} напрямую — договоримся о количестве кредитов и удобном способе оплаты.`
    ].join('\n');
  }

  manualPaymentKeyboard() {
    const contact = String(this.config.product.manualPaymentContact || '@m3dv3d3v').trim();
    const handle = contact.replace(/^@/, '');
    return {
      inline_keyboard: [
        [{ text: `Написать @${handle}`, url: `https://t.me/${encodeURIComponent(handle)}` }],
        [{ text: 'Баланс', callback_data: 'balance' }]
      ]
    };
  }

  async showPackages(chatId, telegramUser) {
    this.store.ensureUser(telegramUser);

    if (!this.service.robokassa || !this.service.robokassa.isConfigured()) {
      return this.sendMessage(chatId, this.manualPaymentText(), {
        reply_markup: this.manualPaymentKeyboard()
      });
    }

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

    if (!devices.length) return this.sendMessage(chatId, 'Устройства пока не подключены. Откройте окно привязки в плагине OpenSubtitles и отправьте сюда код из Lampa.');

    const lines = devices.map((device, index) => {
      const name = device.platform || 'unknown';
      return `${index + 1}. ${name}, ${device.target_language || 'lang'}, активность: ${formatRelativeTime(device.last_seen_at)}`;
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
      '2. Выберите ИИ-субтитры в плеере.',
      '3. Если плагин попросит Telegram, отправьте сюда код из окна привязки или отсканируйте QR-код.',
      '',
      'Кредиты списываются только когда перевод успешно готов. Если перевод упал, резерв возвращается.'
    ].join('\n'), { reply_markup: mainKeyboard() });
  }

  async notifyPayment(user, payment) {
    if (!user?.telegram_id) return;
    const fresh = this.store.getUserById(user.id);
    await this.sendMessage(user.telegram_id, `Оплата прошла. Начислено ${payment.credits} кредитов.\nБаланс: ${fresh.balance} кредитов.`);
  }

  async notifyAdmins(text, options = {}) {
    if (!this.enabled) return;
    const admins = this.config.telegram.admins || [];
    const skip = options.skipTelegramId ? String(options.skipTelegramId) : '';

    for (const adminId of admins) {
      if (skip && String(adminId) === skip) continue;
      try {
        await this.sendMessage(adminId, text);
      }
      catch (error) {
        console.error('[bot] admin notify failed', error.message);
      }
    }
  }

  async notifyAdminsOfTranslation(job) {
    if (!job) return;
    const user = this.store.getUserById(job.user_id);
    if (!user) return;

    const isAnonymous = String(user.telegram_id || '').startsWith('anon:');
    const media = safeParseMedia(job.media_json);
    const title = resolveDisplayTitle(media, job.source_url);
    const meta = [];
    if (media.type === 'series' && Number(media.season) && Number(media.episode)) {
      meta.push(`S${String(media.season).padStart(2, '0')}E${String(media.episode).padStart(2, '0')}`);
    }
    if (media.year) meta.push(escapeHtml(String(media.year)));

    const langs = `${languageNameRu(job.source_language)} → ${languageNameRu(job.target_language)}`;
    let costLabel;
    if (Number(job.credits_spent) > 0) costLabel = `${job.credits_spent} кр.`;
    else if (isAnonymous) costLabel = 'из бесплатного лимита';
    else if (user.unlimited) costLabel = 'безлимит';
    else costLabel = 'бесплатно';

    let userTail;
    if (isAnonymous) userTail = ' · бесплатные демо';
    else if (user.unlimited) userTail = ' · безлимит';
    else userTail = ` · баланс ${user.balance} кр.`;

    const tail = meta.length ? ` · ${meta.join(' · ')}` : '';
    const subFilename = String(media.subtitle_filename || '').trim();
    const showSubFilename = subFilename && subFilename !== title;

    const lines = [
      '<b>Новый перевод</b>',
      formatUserMention(user) + userTail,
      `<b>${escapeHtml(title)}</b>${tail}`,
      ...(showSubFilename ? [`<i>${escapeHtml(subFilename)}</i>`] : []),
      `${langs} · ${costLabel} · ${Number(job.source_chars) || 0} симв.`
    ];

    await this.notifyAdmins(lines.join('\n'), { skipTelegramId: user.telegram_id });
  }

  async notifyAdminsOfPayment(user, payment) {
    if (!user || !payment) return;
    const fresh = this.store.getUserById(user.id) || user;

    const lines = [
      '<b>Новая оплата</b>',
      formatUserMention(fresh),
      `${payment.credits} кредитов · ${Number(payment.amount).toFixed(2)} ₽`,
      `Баланс: ${fresh.unlimited ? 'безлимит' : `${fresh.balance} кр.`}`
    ];

    await this.notifyAdmins(lines.join('\n'), { skipTelegramId: fresh.telegram_id });
  }
}
