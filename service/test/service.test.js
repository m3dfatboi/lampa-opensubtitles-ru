import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../src/db.js';
import { Robokassa } from '../src/robokassa.js';
import { LampaTranslateService } from '../src/service.js';
import { normalizeCues, Translator } from '../src/translator.js';
import { sleep } from '../src/utils.js';

function testConfig(tmp) {
  return {
    rootDir: tmp,
    publicBaseUrl: 'https://example.test',
    dbPath: path.join(tmp, 'db.sqlite'),
    telegram: {
      token: '',
      username: 'test_bot',
      admins: ['1'],
      unlimitedUsers: ['1']
    },
    openRouter: {
      apiKey: 'sk-test',
      model: 'test-model',
      fallbackModel: '',
      enableFallback: false,
      temperature: 0.1,
      timeoutMs: 1000,
      referer: 'https://example.test',
      title: 'test'
    },
    product: {
      trialCredits: 3,
      anonymousFreeTranslations: 3,
      creditChars: 10000,
      maxSubtitleChars: 250000,
      maxActiveJobsPerUser: 1,
      chunkMaxCues: 80,
      chunkMaxChars: 8000,
      chunkMaxTokens: 12000,
      packages: [
        { id: 'credits_30', title: '30 кредитов', credits: 30, price: '299.00' }
      ]
    },
    robokassa: {
      merchantLogin: 'merchant',
      password1: 'pass1',
      password2: 'pass2',
      hashAlgo: 'md5',
      test: true,
      receiptEnabled: false,
      receiptSno: 'usn_income',
      receiptTax: 'none'
    }
  };
}

async function withStore(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lampa-service-test-'));
  const config = testConfig(tmp);
  const store = new Store(config.dbPath, config);
  try {
    return await fn({ tmp, config, store });
  }
  finally {
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('device session can be linked and returns a usable token', () => withStore(({ config, store }) => {
  const translator = new Translator(config);
  const service = new LampaTranslateService({
    config,
    store,
    translator,
    robokassa: new Robokassa(config)
  });
  const session = service.createDeviceSession({
    device_id: 'lampa-device',
    plugin_version: 'test',
    platform: 'android',
    target_language: 'rus'
  });

  assert.equal(service.getDeviceSession(session.session_id).status, 'pending');

  const linked = service.linkDeviceByCode(session.code, {
    id: 42,
    username: 'viewer',
    first_name: 'Viewer'
  });
  const status = service.getDeviceSession(session.session_id);

  assert.equal(linked.user.balance, 3);
  assert.equal(status.status, 'linked');
  assert.match(status.device_token, /^dev_/);

  const auth = service.authDevice(`Bearer ${status.device_token}`);
  assert.equal(auth.user.telegram_id, '42');
}));

test('robokassa result signature is verified and credits are applied once', () => withStore(({ config, store }) => {
  const robokassa = new Robokassa(config);
  const user = store.ensureUser({ id: 7, username: 'paid', first_name: 'Paid' });
  const pkg = config.product.packages[0];
  let payment = store.createPayment(user.id, pkg, '');
  payment = store.setPaymentUrl(payment.inv_id, robokassa.buildPaymentUrl(payment, pkg, user));

  const params = {
    OutSum: '299.000000',
    InvId: String(payment.inv_id),
    Shp_package: pkg.id,
    Shp_user: String(user.id)
  };
  params.SignatureValue = robokassa.resultSignature({
    outSum: params.OutSum,
    invId: params.InvId,
    shp: {
      Shp_package: params.Shp_package,
      Shp_user: params.Shp_user
    }
  });

  const service = new LampaTranslateService({
    config,
    store,
    translator: new Translator(config),
    robokassa
  });

  const first = service.applyRobokassaResult(params);
  const second = service.applyRobokassaResult(params);
  const updated = store.getUserById(user.id);

  assert.equal(first.alreadyPaid, false);
  assert.equal(second.alreadyPaid, true);
  assert.equal(updated.balance, 33);
}));

test('subtitle cues are normalized before translation', () => {
  const cues = normalizeCues([
    { start: 0, end: 1000, text: ' Hello ' },
    { start: 2000, end: 1000, text: 'bad' },
    { start_ms: 1500, end_ms: 2500, value: 'World' }
  ]);

  assert.deepEqual(cues, [
    { start: 0, end: 1000, text: 'Hello' },
    { start: 1500, end: 2500, text: 'World' }
  ]);
});

test('translation reserves credits once and then returns cached result', async () => withStore(async ({ config, store }) => {
  const service = new LampaTranslateService({
    config,
    store,
    translator: {
      cacheKey: () => 'cache:test',
      translate: async ({ cues, onProgress }) => {
        onProgress('1/1');
        return cues.map((cue) => ({ ...cue, text: `RU ${cue.text}` }));
      }
    },
    robokassa: new Robokassa(config)
  });

  const session = service.createDeviceSession({ device_id: 'dev', platform: 'android' });
  service.linkDeviceByCode(session.code, { id: 123, username: 'buyer', first_name: 'Buyer' });
  const token = service.getDeviceSession(session.session_id).device_token;
  const auth = `Bearer ${token}`;
  const body = {
    source_url: 'https://subs.test/a.srt',
    source_language: 'eng',
    target_language: 'rus',
    subtitle: {
      cues: [{ start: 0, end: 1000, text: 'Hello' }]
    }
  };

  const queued = service.startTranslation(auth, body);
  assert.equal(queued.status, 'queued');
  assert.equal(queued.reserved_credits, 1);
  assert.equal(queued.balance, 2);

  await sleep(30);
  const completed = service.getTranslation(auth, queued.job_id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.credits_spent, 1);
  assert.equal(completed.cues[0].text, 'RU Hello');

  const cached = service.startTranslation(auth, body);
  assert.equal(cached.status, 'completed');
  assert.equal(cached.credits_spent, 0);
  assert.equal(cached.balance, 2);
}));

test('anonymous device gets three free translations before linking', async () => withStore(async ({ config, store }) => {
  let translateCount = 0;
  const service = new LampaTranslateService({
    config,
    store,
    translator: {
      cacheKey: ({ cues }) => `cache:${cues[0].text}`,
      translate: async ({ cues }) => {
        translateCount++;
        return cues.map((cue) => ({ ...cue, text: `RU ${cue.text}` }));
      }
    },
    robokassa: new Robokassa(config)
  });

  for (let index = 1; index <= 3; index++) {
    const queued = service.startTranslation('', {
      device_id: 'anon-device',
      plugin_version: 'test',
      platform: 'browser',
      source_language: 'eng',
      target_language: 'rus',
      subtitle: {
        cues: [{ start: 0, end: 1000, text: `Hello ${index}` }]
      }
    });

    assert.equal(queued.status, 'queued');
    assert.equal(queued.anonymous, true);
    assert.equal(queued.free_trial.used, index);
    assert.equal(queued.free_trial.limit, 3);

    await sleep(30);
    const completed = service.getTranslation('', queued.job_id, { device_id: 'anon-device' });
    assert.equal(completed.status, 'completed');
  }

  assert.equal(translateCount, 3);

  assert.throws(() => service.startTranslation('', {
    device_id: 'anon-device',
    plugin_version: 'test',
    platform: 'browser',
    source_language: 'eng',
    target_language: 'rus',
    subtitle: {
      cues: [{ start: 0, end: 1000, text: 'Hello 4' }]
    }
  }), /бесплатные ИИ-переводы закончились/);

  const account = service.getAccount('', { device_id: 'anon-device' });
  assert.equal(account.linked, false);
  assert.deepEqual(account.free_trial, { used: 3, limit: 3, remaining: 0 });
}));

test('translator accepts local chunk ids returned by model', async () => {
  const config = testConfig(fs.mkdtempSync(path.join(os.tmpdir(), 'lampa-translator-test-')));
  config.product.chunkMaxCues = 2;
  config.product.chunkMaxChars = 1000;
  const originalFetch = globalThis.fetch;
  const seenChunks = [];

  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const payload = JSON.parse(body.messages[1].content);
    seenChunks.push(payload.items.map((item) => item.id));

    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                items: payload.items.map((item, index) => ({ id: index, text: `RU ${item.text}` }))
              })
            }
          }
        ]
      })
    };
  };

  try {
    const translated = await new Translator(config).translate({
      sourceLanguage: 'eng',
      targetLanguage: 'rus',
      cues: [
        { start: 0, end: 1000, text: 'one' },
        { start: 1000, end: 2000, text: 'two' },
        { start: 2000, end: 3000, text: 'three' }
      ]
    });

    assert.deepEqual(seenChunks, [[0, 1], [2]]);
    assert.deepEqual(translated.map((cue) => cue.text), ['RU one', 'RU two', 'RU three']);
  }
  finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(config.rootDir, { recursive: true, force: true });
  }
});

test('translator reuses cached chunks after a failed partial translation', async () => {
  const config = testConfig(fs.mkdtempSync(path.join(os.tmpdir(), 'lampa-translator-partial-cache-test-')));
  config.product.chunkMaxCues = 2;
  config.product.chunkMaxChars = 1000;
  const originalFetch = globalThis.fetch;
  const chunkCache = new Map();
  const seenChunks = [];
  let failSecondChunk = true;

  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const payload = JSON.parse(body.messages[1].content);
    seenChunks.push(payload.items.map((item) => item.id));

    if (failSecondChunk && payload.items.length === 1) {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: 'length',
              message: {
                content: ''
              }
            }
          ]
        })
      };
    }

    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                items: payload.items.map((item, index) => ({ id: index, text: `RU ${item.text}` }))
              })
            }
          }
        ]
      })
    };
  };

  try {
    const translator = new Translator(config);
    const args = {
      sourceLanguage: 'eng',
      targetLanguage: 'rus',
      cues: [
        { start: 0, end: 1000, text: 'one' },
        { start: 1000, end: 2000, text: 'two' },
        { start: 2000, end: 3000, text: 'three' }
      ],
      chunkCache: {
        get: (key) => chunkCache.get(key) || null,
        set: (key, items) => chunkCache.set(key, items)
      }
    };

    await assert.rejects(translator.translate(args), /OpenRouter обрезал ответ/);
    assert.deepEqual(seenChunks, [[0, 1], [2]]);
    assert.equal(chunkCache.has('0,1'), true);

    seenChunks.length = 0;
    failSecondChunk = false;

    const translated = await translator.translate(args);
    assert.deepEqual(seenChunks, [[2]]);
    assert.deepEqual(translated.map((cue) => cue.text), ['RU one', 'RU two', 'RU three']);
  }
  finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(config.rootDir, { recursive: true, force: true });
  }
});

test('translator splits a chunk when model returns incomplete JSON items', async () => {
  const config = testConfig(fs.mkdtempSync(path.join(os.tmpdir(), 'lampa-translator-split-test-')));
  config.product.chunkMaxCues = 4;
  config.product.chunkMaxChars = 1000;
  const originalFetch = globalThis.fetch;
  let call = 0;

  globalThis.fetch = async (_url, options) => {
    call++;
    const body = JSON.parse(options.body);
    const payload = JSON.parse(body.messages[1].content);
    const items = call === 1
      ? payload.items.slice(0, 1)
      : payload.items.map((item, index) => ({ id: index, text: `RU ${item.text}` }));

    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({ items })
            }
          }
        ]
      })
    };
  };

  try {
    const translated = await new Translator(config).translate({
      sourceLanguage: 'eng',
      targetLanguage: 'rus',
      cues: [
        { start: 0, end: 1000, text: 'one' },
        { start: 1000, end: 2000, text: 'two' },
        { start: 2000, end: 3000, text: 'three' },
        { start: 3000, end: 4000, text: 'four' }
      ]
    });

    assert.equal(call, 3);
    assert.deepEqual(translated.map((cue) => cue.text), ['RU one', 'RU two', 'RU three', 'RU four']);
  }
  finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(config.rootDir, { recursive: true, force: true });
  }
});
