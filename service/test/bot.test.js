import assert from 'node:assert/strict';
import test from 'node:test';
import { TelegramBot } from '../src/bot.js';

function createBot(overrides = {}) {
  const sent = [];
  const linked = [];
  const bot = new TelegramBot({
    telegram: {
      token: 'test-token',
      admins: overrides.admins || [],
      unlimitedUsers: [],
      apiHost: 'api.telegram.org',
      apiIp: '',
      apiTimeoutMs: 1000,
      proxyUrl: ''
    },
    product: {
      packages: overrides.packages || [],
      creditChars: 10000,
      manualPaymentContact: '@m3dv3d3v'
    }
  }, {
    linkDeviceByCode: (code) => {
      linked.push(code);
      if (code !== 'ABC123') throw new Error('Код не найден.');
      return {
        user: {
          balance: 3,
          unlimited: false
        }
      };
    },
    robokassa: {
      isConfigured: () => Boolean(overrides.robokassaConfigured)
    },
    ...overrides.service
  }, {
    ensureUser: (user) => ({ id: user.id, ...user }),
    listUserTranslations: () => [],
    listUserDevices: () => [],
    stats: () => ({
      users: { linked: 0, anonymous: 0, unlimited: 0, blocked: 0 },
      payments: { count: 0, amount: 0, credits_sold: 0 },
      credits_outstanding: 0,
      translations: {
        completed: 0,
        failed: 0,
        in_flight: 0,
        credits_spent: 0,
        chars_translated: 0,
        last_24h: { count: 0, credits: 0 },
        last_7d: { count: 0, credits: 0 }
      }
    }),
    countLinkedUsers: () => 0,
    listLinkedUsers: () => [],
    getUserById: (id) => ({ id, telegram_id: '999', first_name: 'User', balance: 0, unlimited: 0 }),
    ...overrides.store
  });

  bot.sendMessage = async (chatId, text, extra = {}) => {
    sent.push({ chatId, text, extra });
    return {};
  };

  return { bot, sent, linked };
}

test('bot asks for a Lampa code on first start', async () => {
  const { bot, sent } = createBot();

  await bot.handleMessage({
    text: '/start',
    from: { id: 42, username: 'viewer' },
    chat: { id: 100 }
  });

  assert.match(sent[0].text, /отправьте сюда код/i);
  assert.equal(sent[0].extra.reply_markup.keyboard[0][0].text, 'Ввести код');
});

test('bot links device when user sends plain code', async () => {
  const { bot, sent, linked } = createBot();

  await bot.handleMessage({
    text: 'abc-123',
    from: { id: 42, username: 'viewer' },
    chat: { id: 100 }
  });

  assert.deepEqual(linked, ['ABC123']);
  assert.match(sent[0].text, /Lampa подключена/);
});

test('bot exposes code prompt through command and keyboard text', async () => {
  const { bot, sent } = createBot();

  await bot.handleMessage({
    text: '/connect',
    from: { id: 42, username: 'viewer' },
    chat: { id: 100 }
  });
  await bot.handleMessage({
    text: 'Ввести код',
    from: { id: 42, username: 'viewer' },
    chat: { id: 100 }
  });

  assert.match(sent[0].text, /Отправьте код/i);
  assert.match(sent[1].text, /Отправьте код/i);
});

test('bot reports empty history when user has no translations', async () => {
  const { bot, sent } = createBot();

  await bot.handleMessage({
    text: '/history',
    from: { id: 42, username: 'viewer' },
    chat: { id: 100 }
  });

  assert.match(sent[0].text, /История переводов пуста/);
});

test('payment menu suggests manual contact when robokassa is offline', async () => {
  const { bot, sent } = createBot({
    robokassaConfigured: false,
    packages: [{ id: 'credits_30', title: '30', credits: 30, price: '299.00' }]
  });

  await bot.handleMessage({
    text: 'Купить кредиты',
    from: { id: 42, username: 'viewer' },
    chat: { id: 100 }
  });

  const text = sent[0].text;
  assert.match(text, /Онлайн-оплата пока не подключена/);
  assert.match(text, /@m3dv3d3v/);
  assert.match(text, /https:\/\/t\.me\/m3dv3d3v/);
  assert.match(sent[0].extra.reply_markup.inline_keyboard[0][0].url, /t\.me\/m3dv3d3v/);
});

test('admin notifications skip the acting user and reach other admins', async () => {
  const { bot, sent } = createBot({ admins: ['100', '200', '300'] });
  bot.store.getUserById = () => ({
    id: 1,
    telegram_id: '200',
    username: 'buyer',
    first_name: 'Pavel',
    balance: 30,
    unlimited: 0
  });

  await bot.notifyAdminsOfTranslation({
    user_id: 1,
    source_language: 'eng',
    target_language: 'rus',
    credits_spent: 3,
    source_chars: 25000,
    media_json: JSON.stringify({ title: 'Inception', year: '2010', type: 'movie' })
  });

  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((m) => String(m.chatId)).sort(), ['100', '300']);
  assert.match(sent[0].text, /Новый перевод/);
  assert.match(sent[0].text, /Pavel/);
  assert.match(sent[0].text, /Inception/);
  assert.match(sent[0].text, /Английский → Русский/);
  assert.match(sent[0].text, /3 кр\./);
});

test('admin notifications fire for paid orders too', async () => {
  const { bot, sent } = createBot({ admins: ['100'] });
  bot.store.getUserById = () => ({
    id: 7,
    telegram_id: '777',
    username: 'kate',
    first_name: 'Kate',
    balance: 130,
    unlimited: 0
  });

  await bot.notifyAdminsOfPayment({ id: 7, telegram_id: '777' }, {
    credits: 100,
    amount: '899.00'
  });

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Новая оплата/);
  assert.match(sent[0].text, /Kate/);
  assert.match(sent[0].text, /100 кредитов/);
  assert.match(sent[0].text, /899\.00 ₽/);
});

test('history hides season\\/episode for movies even when stored', async () => {
  const rows = [{
    id: 'job-movie',
    source_language: 'eng',
    target_language: 'rus',
    source_chars: 50000,
    credits_spent: 5,
    media_json: JSON.stringify({
      title: 'The Matrix',
      year: '1999',
      type: 'movie',
      season: 20,
      episode: 108
    }),
    completed_at: '2026-05-08T14:32:00.000Z',
    created_at: '2026-05-08T14:30:00.000Z'
  }];

  const { bot, sent } = createBot({
    store: { listUserTranslations: () => rows }
  });

  await bot.handleMessage({
    text: '/history',
    from: { id: 42, username: 'viewer' },
    chat: { id: 100 }
  });

  const text = sent[0].text;
  assert.match(text, /The Matrix/);
  assert.match(text, /1999/);
  assert.doesNotMatch(text, /S20/);
  assert.doesNotMatch(text, /E108/);
});

test('devices list shows relative last-seen time, not raw ISO', async () => {
  const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();

  const { bot, sent } = createBot({
    store: {
      listUserDevices: () => [
        { id: 'd1', platform: 'android', target_language: 'rus', last_seen_at: recent, revoked_at: null },
        { id: 'd2', platform: 'tv', target_language: 'eng', last_seen_at: yesterday, revoked_at: null }
      ]
    }
  });

  await bot.handleMessage({
    text: 'Мои устройства',
    from: { id: 42, username: 'viewer' },
    chat: { id: 100 }
  });

  const text = sent[0].text;
  assert.match(text, /5 минут назад/);
  assert.match(text, /вчера в \d{2}:\d{2}/);
  assert.doesNotMatch(text, /T\d{2}:\d{2}/);
});

test('admin /stats includes a clickable list of linked users', async () => {
  const users = [{
    id: 1,
    telegram_id: '11111',
    username: 'vanya',
    first_name: 'Иван',
    balance: 30,
    unlimited: 0,
    blocked: 0,
    translations_done: 5,
    credits_spent: 7
  }, {
    id: 2,
    telegram_id: '22222',
    username: '',
    first_name: 'Anna',
    balance: 0,
    unlimited: 1,
    blocked: 0,
    translations_done: 12,
    credits_spent: 0
  }, {
    id: 3,
    telegram_id: '33333',
    username: 'spam',
    first_name: 'Spammer',
    balance: 0,
    unlimited: 0,
    blocked: 1,
    translations_done: 0,
    credits_spent: 0
  }];
  const { bot, sent } = createBot({
    admins: ['42'],
    store: {
      countLinkedUsers: () => users.length,
      listLinkedUsers: () => users
    }
  });

  await bot.handleMessage({
    text: '/stats',
    from: { id: 42, username: 'admin' },
    chat: { id: 100 }
  });

  const text = sent[0].text;
  assert.match(text, /Активные пользователи/);
  assert.match(text, /tg:\/\/user\?id=11111/);
  assert.match(text, /@vanya/);
  assert.match(text, /Иван/);
  assert.match(text, /30 кр\./);
  assert.match(text, /безлимит/);
  assert.match(text, /blocked/);
  assert.match(text, /5 перев\./);
  assert.match(text, /-7 кр\./);
});

test('bot formats history with title, langs, credits and date', async () => {
  const rows = [{
    id: 'job-1',
    source_language: 'eng',
    target_language: 'rus',
    source_chars: 25000,
    credits_spent: 3,
    media_json: JSON.stringify({
      title: 'Breaking Bad',
      year: '2008',
      type: 'series',
      season: 5,
      episode: 14
    }),
    completed_at: '2026-05-08T14:32:00.000Z',
    created_at: '2026-05-08T14:31:00.000Z'
  }, {
    id: 'job-2',
    source_language: 'eng',
    target_language: 'rus',
    source_chars: 18000,
    credits_spent: 0,
    media_json: JSON.stringify({ title: 'Inception', year: '2010', type: 'movie' }),
    completed_at: '2026-05-07T18:05:00.000Z',
    created_at: '2026-05-07T18:00:00.000Z'
  }];

  const { bot, sent } = createBot({
    store: { listUserTranslations: () => rows }
  });

  await bot.handleMessage({
    text: 'История',
    from: { id: 42, username: 'viewer' },
    chat: { id: 100 }
  });

  const text = sent[0].text;
  assert.match(text, /Последние переводы: 2/);
  assert.match(text, /Списано кредитов: 3/);
  assert.match(text, /Breaking Bad/);
  assert.match(text, /S05E14/);
  assert.match(text, /2008/);
  assert.match(text, /Английский → Русский/);
  assert.match(text, /3 кр\./);
  assert.match(text, /Inception/);
  assert.match(text, /безлимит/);
});
