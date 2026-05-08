import assert from 'node:assert/strict';
import test from 'node:test';
import { TelegramBot } from '../src/bot.js';

function createBot() {
  const sent = [];
  const linked = [];
  const bot = new TelegramBot({
    telegram: {
      token: 'test-token',
      admins: [],
      unlimitedUsers: [],
      apiHost: 'api.telegram.org',
      apiIp: '',
      apiTimeoutMs: 1000,
      proxyUrl: ''
    },
    product: {
      packages: []
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
    ensureUser: (user) => user
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
