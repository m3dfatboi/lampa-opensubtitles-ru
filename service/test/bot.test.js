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
      packages: [],
      creditChars: 10000
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
    }
  }, {
    ensureUser: (user) => ({ id: user.id, ...user }),
    listUserTranslations: () => [],
    stats: () => ({
      users: 0,
      paid: { count: 0, amount: 0 },
      cache: { count: 0, hits: 0 },
      jobs: []
    }),
    countLinkedUsers: () => 0,
    listLinkedUsers: () => [],
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
  assert.match(text, /Пользователи с Telegram/);
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
    media_json: JSON.stringify({ title: 'Inception', year: '2010' }),
    completed_at: '2026-05-07T18:05:00.000Z',
    created_at: '2026-05-07T18:00:00.000Z'
  }];

  const { bot, sent } = createBot({
    store: { listUserTranslations: () => rows }
  });

  await bot.handleMessage({
    text: 'История переводов',
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
