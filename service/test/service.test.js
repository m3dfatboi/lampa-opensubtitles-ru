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
