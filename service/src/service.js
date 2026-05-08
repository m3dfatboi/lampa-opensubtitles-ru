import { HttpError, randomCode, randomId, sha256 } from './utils.js';
import { normalizeCues, sourceCharacters, subtitleHash } from './translator.js';

function publicBotUrl(config, code) {
  if (config.telegram.username) return `https://t.me/${config.telegram.username}?start=${encodeURIComponent(code)}`;
  return `${config.publicBaseUrl}/bot/start?code=${encodeURIComponent(code)}`;
}

function jobResponse(job, user) {
  const base = {
    status: job.status,
    job_id: job.id,
    progress: job.progress || '',
    reserved_credits: job.credits_reserved,
    credits_spent: job.credits_spent || 0,
    balance: user?.balance
  };

  if (job.status === 'completed') {
    return {
      ...base,
      cues: JSON.parse(job.result_json || '[]')
    };
  }

  if (job.status === 'failed') return { ...base, message: job.error || 'ошибка перевода' };

  return base;
}

function freeTrialPayload(usage, limit) {
  const used = usage?.used || 0;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used)
  };
}

export class TranslationQueue {
  constructor(store, translator) {
    this.store = store;
    this.translator = translator;
    this.queue = [];
    this.running = false;
    this.onJobComplete = null;
  }

  enqueue(jobId) {
    if (!this.queue.includes(jobId)) this.queue.push(jobId);
    this.runNext();
  }

  resume() {
    for (const row of this.store.listRecoverableJobs()) this.enqueue(row.id);
  }

  async runNext() {
    if (this.running) return;
    const jobId = this.queue.shift();
    if (!jobId) return;

    this.running = true;
    try {
      await this.process(jobId);
    }
    finally {
      this.running = false;
      if (this.queue.length) this.runNext();
    }
  }

  async process(jobId) {
    const job = this.store.getTranslationJob(jobId);
    if (!job || !['queued', 'processing'].includes(job.status)) return;

    this.store.updateJobStatus(job.id, 'processing', job.progress || '0%');

    try {
      const cached = this.store.getCachedTranslation(job.cache_key);
      if (cached) {
        this.store.completeJob(job, cached.cues);
        this.fireOnJobComplete(job.id);
        return;
      }

      const sourceCues = JSON.parse(job.cues_json || '[]');
      const media = JSON.parse(job.media_json || '{}');
      const translated = await this.translator.translate({
        cues: sourceCues,
        sourceLanguage: job.source_language,
        targetLanguage: job.target_language,
        media,
        onProgress: (progress) => this.store.updateJobStatus(job.id, 'processing', progress),
        chunkCache: {
          get: (chunkKey) => this.store.getCachedTranslationChunk(job.cache_key, chunkKey),
          set: (chunkKey, items) => this.store.saveCachedTranslationChunk(job.cache_key, chunkKey, items)
        }
      });

      this.store.completeJob(job, translated);
      this.fireOnJobComplete(job.id);
    }
    catch (error) {
      this.store.failJob(job, error?.message || 'translation failed');
    }
  }

  fireOnJobComplete(jobId) {
    if (typeof this.onJobComplete !== 'function') return;
    const completed = this.store.getTranslationJob(jobId);
    if (!completed) return;

    Promise.resolve()
      .then(() => this.onJobComplete(completed))
      .catch((error) => console.error('[queue] onJobComplete failed', error.message));
  }
}

export class LampaTranslateService {
  constructor({ config, store, translator, robokassa }) {
    this.config = config;
    this.store = store;
    this.translator = translator;
    this.robokassa = robokassa;
    this.queue = new TranslationQueue(store, translator);
    this.linkedTokens = new Map();
  }

  start() {
    this.queue.resume();
  }

  createDeviceSession(input) {
    const code = randomCode();
    const session = {
      id: randomId('sess'),
      code,
      device_id: String(input.device_id || '').slice(0, 128) || randomId('unknown', 6),
      plugin_version: String(input.plugin_version || '').slice(0, 64),
      platform: String(input.platform || '').slice(0, 32),
      target_language: String(input.target_language || '').slice(0, 16),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    };

    this.store.createDeviceSession(session);

    return {
      session_id: session.id,
      code: session.code,
      bot_url: publicBotUrl(this.config, session.code),
      expires_in: 600
    };
  }

  getDeviceSession(sessionId) {
    const session = this.store.getDeviceSessionById(sessionId);
    if (!session) throw new HttpError(404, 'session not found');

    if (new Date(session.expires_at).getTime() < Date.now() && !session.linked_at) {
      return { status: 'expired' };
    }

    if (!session.user_id || !session.device_token_hash) return { status: 'pending' };

    const user = this.store.getUserById(session.user_id);
    const token = this.linkedTokens.get(session.id) || this.refreshLinkedSessionToken(session);

    return {
      status: 'linked',
      device_token: token,
      balance: user?.balance || 0,
      unlimited: Boolean(user?.unlimited)
    };
  }

  refreshLinkedSessionToken(session) {
    const token = randomId('dev', 24);
    const tokenHash = sha256(token);
    const now = new Date().toISOString();

    this.store.tx(() => {
      this.store.db.prepare('UPDATE devices SET token_hash = ?, last_seen_at = ? WHERE token_hash = ?')
        .run(tokenHash, now, session.device_token_hash);
      this.store.db.prepare('UPDATE device_sessions SET device_token_hash = ? WHERE id = ?')
        .run(tokenHash, session.id);
    });

    this.linkedTokens.set(session.id, token);
    return token;
  }

  linkDeviceByCode(code, telegramUser) {
    return this.store.tx(() => {
      const session = this.store.getDeviceSessionByCode(code);
      if (!session) throw new Error('Код не найден. Создайте новый код в Lampa.');
      if (session.linked_at) throw new Error('Этот код уже использован.');
      if (new Date(session.expires_at).getTime() < Date.now()) throw new Error('Код устарел. Создайте новый код в Lampa.');

      const user = this.store.ensureUser(telegramUser);
      const token = randomId('dev', 24);
      const deviceRowId = randomId('device', 12);

      this.store.linkDeviceSession(session, user, deviceRowId, token);
      this.linkedTokens.set(session.id, token);

      return {
        token,
        user: this.store.getUserById(user.id),
        session: this.store.getDeviceSessionById(session.id)
      };
    });
  }

  authDevice(authorization) {
    const match = String(authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!match) throw new HttpError(401, 'missing device token');

    const device = this.store.getDeviceByToken(match[1]);
    if (!device) throw new HttpError(401, 'bad device token');
    if (device.blocked) throw new HttpError(403, 'user is blocked');

    return {
      device,
      user: {
        id: device.user_id,
        telegram_id: device.telegram_id,
        username: device.username,
        first_name: device.first_name,
        balance: device.balance,
        unlimited: device.unlimited,
        blocked: device.blocked
      }
    };
  }

  tryAuthDevice(authorization) {
    try {
      return this.authDevice(authorization);
    }
    catch (error) {
      if (error instanceof HttpError && error.status === 401) return null;
      throw error;
    }
  }

  authOrAnonymousDevice(authorization, input) {
    const linked = this.tryAuthDevice(authorization);
    if (linked) return { ...linked, anonymous: false };

    const deviceId = String(input?.device_id || '').slice(0, 128);
    if (!deviceId) throw new HttpError(401, 'missing device token');

    const anonymous = this.store.ensureAnonymousDevice({
      device_id: deviceId,
      plugin_version: String(input?.plugin_version || '').slice(0, 64),
      platform: String(input?.platform || '').slice(0, 32),
      target_language: String(input?.target_language || '').slice(0, 16)
    });

    return { ...anonymous, anonymous: true };
  }

  getAccount(authorization, input = {}) {
    const linked = this.tryAuthDevice(authorization);
    if (linked) {
      return {
        linked: true,
        balance: linked.user.balance,
        unlimited: Boolean(linked.user.unlimited)
      };
    }

    const limit = this.config.product.anonymousFreeTranslations;
    const usage = this.store.getAnonymousUsage(input.device_id);

    return {
      linked: false,
      free_trial: freeTrialPayload(usage, limit)
    };
  }

  startTranslation(authorization, input) {
    const { device, user, anonymous } = this.authOrAnonymousDevice(authorization, input);
    const targetLanguage = String(input.target_language || '').slice(0, 16) || 'rus';
    const sourceLanguage = String(input.source_language || '').slice(0, 16) || 'eng';
    const rawText = input.subtitle?.text || '';
    const cues = normalizeCues(input.subtitle?.cues || []);
    const chars = sourceCharacters(cues, rawText);

    if (!cues.length) throw new HttpError(400, 'empty subtitles');
    if (chars > this.config.product.maxSubtitleChars) throw new HttpError(413, 'subtitle file is too large');

    const cacheKey = this.translator.cacheKey({ cues, rawText, sourceLanguage, targetLanguage });
    const cached = this.store.getCachedTranslation(cacheKey);
    if (cached) {
      return {
        status: 'completed',
        credits_spent: 0,
        balance: user.balance,
        anonymous,
        free_trial: anonymous ? freeTrialPayload(this.store.getAnonymousUsage(input.device_id), this.config.product.anonymousFreeTranslations) : undefined,
        cues: cached.cues
      };
    }

    const existing = this.store.findActiveJobByUserCache(user.id, cacheKey);
    if (existing) {
      return {
        ...jobResponse(existing, user),
        anonymous,
        free_trial: anonymous ? freeTrialPayload(this.store.getAnonymousUsage(input.device_id), this.config.product.anonymousFreeTranslations) : undefined
      };
    }

    if (this.store.countActiveJobs(user.id) >= this.config.product.maxActiveJobsPerUser) {
      throw new HttpError(429, 'у вас уже есть активный перевод');
    }

    const credits = Math.max(1, Math.ceil(chars / this.config.product.creditChars));
    const job = {
      id: randomId('job'),
      device_row_id: device.id,
      cache_key: cacheKey,
      source_url: String(input.source_url || '').slice(0, 1024),
      source_language: sourceLanguage,
      target_language: targetLanguage,
      model: this.config.openRouter.model,
      media: input.media || {},
      cues,
      source_chars: chars,
      source_hash: subtitleHash(cues, rawText),
      credits_reserved: credits
    };
    let freeTrial = null;

    if (anonymous) {
      try {
        freeTrial = this.store.consumeAnonymousTranslation(input.device_id, this.config.product.anonymousFreeTranslations);
      }
      catch (error) {
        if (error.message === 'ANONYMOUS_LIMIT_REACHED') {
          throw new HttpError(402, 'бесплатные ИИ-переводы закончились. Подключите Telegram и пополните баланс.', {
            requires_link: true,
            free_trial: freeTrialPayload(this.store.getAnonymousUsage(input.device_id), this.config.product.anonymousFreeTranslations)
          });
        }
        throw error;
      }
    }

    try {
      this.store.createTranslationJob(job, user);
    }
    catch (error) {
      if (error.message === 'NOT_ENOUGH_CREDITS') throw new HttpError(402, 'недостаточно кредитов');
      if (error.message === 'USER_BLOCKED') throw new HttpError(403, 'аккаунт заблокирован');
      throw error;
    }

    this.queue.enqueue(job.id);
    const freshUser = this.store.getUserById(user.id);

    return {
      status: 'queued',
      job_id: job.id,
      reserved_credits: user.unlimited ? 0 : credits,
      balance: freshUser.balance,
      anonymous,
      free_trial_activated: Boolean(freeTrial),
      free_trial: freeTrial || (anonymous ? freeTrialPayload(this.store.getAnonymousUsage(input.device_id), this.config.product.anonymousFreeTranslations) : undefined)
    };
  }

  checkTranslation(authorization, input) {
    this.authOrAnonymousDevice(authorization, input);
    const targetLanguage = String(input.target_language || '').slice(0, 16) || 'rus';
    const sourceLanguage = String(input.source_language || '').slice(0, 16) || 'eng';
    const rawText = input.subtitle?.text || '';
    const cues = normalizeCues(input.subtitle?.cues || []);
    const chars = sourceCharacters(cues, rawText);

    if (!cues.length) throw new HttpError(400, 'empty subtitles');

    const cacheKey = this.translator.cacheKey({ cues, rawText, sourceLanguage, targetLanguage });
    const cached = Boolean(this.store.getCachedTranslation(cacheKey));
    const credits = Math.max(1, Math.ceil(chars / this.config.product.creditChars));

    return {
      cached,
      credits,
      source_chars: chars,
      source_language: sourceLanguage,
      target_language: targetLanguage
    };
  }

  getTranslation(authorization, jobId, input = {}) {
    const { user, anonymous } = this.authOrAnonymousDevice(authorization, input);
    const job = this.store.getTranslationJobForUser(jobId, user.id);
    if (!job) throw new HttpError(404, 'job not found');
    return {
      ...jobResponse(job, this.store.getUserById(user.id)),
      anonymous,
      free_trial: anonymous ? freeTrialPayload(this.store.getAnonymousUsage(input.device_id), this.config.product.anonymousFreeTranslations) : undefined
    };
  }

  createPaymentForUser(telegramUser, packageId) {
    if (!this.robokassa.isConfigured()) throw new Error('Robokassa не настроена на сервере.');

    const user = this.store.ensureUser(telegramUser);
    const pkg = this.config.product.packages.find((item) => item.id === packageId);
    if (!pkg) throw new Error('Пакет не найден.');

    const payment = this.store.createPayment(user.id, pkg, '');
    const paymentUrl = this.robokassa.buildPaymentUrl(payment, pkg, user);
    return this.store.setPaymentUrl(payment.inv_id, paymentUrl);
  }

  applyRobokassaResult(params) {
    const result = this.robokassa.parseResult(params);
    const payment = this.store.getPayment(result.invId);
    if (!payment) throw new Error('Payment not found');
    if (Number.parseFloat(payment.amount).toFixed(2) !== result.outSum) throw new Error('Bad payment amount');

    return this.store.markPaymentPaid(result.invId, params);
  }
}
