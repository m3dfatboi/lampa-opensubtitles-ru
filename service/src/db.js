import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nowIso, sha256 } from './utils.js';

export class Store {
  constructor(dbPath, config) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.config = config;
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT UNIQUE NOT NULL,
        username TEXT,
        first_name TEXT,
        balance INTEGER NOT NULL DEFAULT 0,
        unlimited INTEGER NOT NULL DEFAULT 0,
        blocked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS device_sessions (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        device_id TEXT NOT NULL,
        plugin_version TEXT,
        platform TEXT,
        target_language TEXT,
        user_id INTEGER,
        device_token_hash TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        linked_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        device_id TEXT NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        plugin_version TEXT,
        platform TEXT,
        target_language TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS anonymous_usage (
        device_key TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        translations_used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS subtitle_cache (
        cache_key TEXT PRIMARY KEY,
        source_hash TEXT NOT NULL,
        source_language TEXT NOT NULL,
        target_language TEXT NOT NULL,
        model TEXT NOT NULL,
        source_chars INTEGER NOT NULL,
        cues_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        hits INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS subtitle_chunk_cache (
        cache_key TEXT NOT NULL,
        chunk_key TEXT NOT NULL,
        items_json TEXT NOT NULL,
        items_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        hits INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(cache_key, chunk_key)
      );

      CREATE INDEX IF NOT EXISTS idx_subtitle_chunk_cache_key ON subtitle_chunk_cache(cache_key);

      CREATE TABLE IF NOT EXISTS translations (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        device_row_id TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        source_url TEXT,
        source_language TEXT NOT NULL,
        target_language TEXT NOT NULL,
        model TEXT NOT NULL,
        media_json TEXT,
        cues_json TEXT NOT NULL,
        result_json TEXT,
        source_chars INTEGER NOT NULL,
        credits_reserved INTEGER NOT NULL DEFAULT 0,
        credits_spent INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        progress TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(device_row_id) REFERENCES devices(id)
      );

      CREATE INDEX IF NOT EXISTS idx_translations_user_status ON translations(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_translations_cache_status ON translations(cache_key, status);

      CREATE TABLE IF NOT EXISTS payments (
        inv_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        package_id TEXT NOT NULL,
        credits INTEGER NOT NULL,
        amount TEXT NOT NULL,
        status TEXT NOT NULL,
        payment_url TEXT,
        raw_result TEXT,
        created_at TEXT NOT NULL,
        paid_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        reason TEXT NOT NULL,
        ref_type TEXT,
        ref_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
    `);
  }

  close() {
    this.db.close();
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    }
    catch (error) {
      try { this.db.exec('ROLLBACK'); }
      catch (_) {}
      throw error;
    }
  }

  ensureUser(telegramUser) {
    const telegramId = String(telegramUser.id);
    const now = nowIso();
    const shouldBeUnlimited = this.config.telegram.unlimitedUsers.includes(telegramId) ? 1 : 0;
    const existing = this.db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);

    if (existing) {
      const unlimited = existing.unlimited || shouldBeUnlimited;
      this.db.prepare(`
        UPDATE users
        SET username = ?, first_name = ?, unlimited = ?, updated_at = ?
        WHERE id = ?
      `).run(telegramUser.username || '', telegramUser.first_name || '', unlimited ? 1 : 0, now, existing.id);
      return this.getUserById(existing.id);
    }

    const trialCredits = shouldBeUnlimited ? 0 : this.config.product.trialCredits;
    const result = this.db.prepare(`
      INSERT INTO users (telegram_id, username, first_name, balance, unlimited, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(telegramId, telegramUser.username || '', telegramUser.first_name || '', trialCredits, shouldBeUnlimited, now, now);

    if (trialCredits > 0) this.addLedger(result.lastInsertRowid, trialCredits, 'trial', 'user', String(result.lastInsertRowid));

    return this.getUserById(result.lastInsertRowid);
  }

  ensureAnonymousDevice(input) {
    const deviceId = String(input.device_id || '').slice(0, 128);
    if (!deviceId) throw new Error('ANONYMOUS_DEVICE_ID_REQUIRED');

    const now = nowIso();
    const key = sha256(deviceId);
    const telegramId = `anon:${key}`;
    let user = this.db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);

    if (!user) {
      const result = this.db.prepare(`
        INSERT INTO users (telegram_id, username, first_name, balance, unlimited, created_at, updated_at)
        VALUES (?, ?, ?, 0, 1, ?, ?)
      `).run(telegramId, '', 'Anonymous Lampa', now, now);
      user = this.getUserById(result.lastInsertRowid);
    }

    const deviceRowId = `anon_${key.slice(0, 24)}`;
    const tokenHash = sha256(`anon:${deviceId}`);
    const existingDevice = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceRowId);

    if (existingDevice) {
      this.db.prepare(`
        UPDATE devices
        SET plugin_version = ?, platform = ?, target_language = ?, last_seen_at = ?
        WHERE id = ?
      `).run(input.plugin_version || '', input.platform || '', input.target_language || '', now, deviceRowId);
    }
    else {
      this.db.prepare(`
        INSERT INTO devices (id, user_id, device_id, token_hash, plugin_version, platform, target_language, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        deviceRowId,
        user.id,
        deviceId,
        tokenHash,
        input.plugin_version || '',
        input.platform || '',
        input.target_language || '',
        now,
        now
      );
    }

    return {
      device: this.db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceRowId),
      user: this.getUserById(user.id)
    };
  }

  getAnonymousUsage(deviceId) {
    const safeDeviceId = String(deviceId || '').slice(0, 128);
    if (!safeDeviceId) return { used: 0 };

    const row = this.db.prepare('SELECT translations_used AS used FROM anonymous_usage WHERE device_key = ?').get(sha256(safeDeviceId));
    return row || { used: 0 };
  }

  consumeAnonymousTranslation(deviceId, limit) {
    const safeDeviceId = String(deviceId || '').slice(0, 128);
    if (!safeDeviceId) throw new Error('ANONYMOUS_DEVICE_ID_REQUIRED');

    return this.tx(() => {
      const now = nowIso();
      const deviceKey = sha256(safeDeviceId);
      const row = this.db.prepare('SELECT translations_used AS used FROM anonymous_usage WHERE device_key = ?').get(deviceKey);
      const used = row ? row.used : 0;

      if (used >= limit) throw new Error('ANONYMOUS_LIMIT_REACHED');

      if (row) {
        this.db.prepare('UPDATE anonymous_usage SET translations_used = ?, updated_at = ? WHERE device_key = ?')
          .run(used + 1, now, deviceKey);
      }
      else {
        this.db.prepare(`
          INSERT INTO anonymous_usage (device_key, device_id, translations_used, created_at, updated_at)
          VALUES (?, ?, 1, ?, ?)
        `).run(deviceKey, safeDeviceId, now, now);
      }

      return {
        used: used + 1,
        limit,
        remaining: Math.max(0, limit - used - 1)
      };
    });
  }

  getUserById(id) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  getUserByTelegramId(telegramId) {
    return this.db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
  }

  updateUserBalance(userId, balance) {
    this.db.prepare('UPDATE users SET balance = ?, updated_at = ? WHERE id = ?').run(balance, nowIso(), userId);
  }

  setUserFlag(userId, flag, value) {
    if (!['unlimited', 'blocked'].includes(flag)) throw new Error('unsupported flag');
    this.db.prepare(`UPDATE users SET ${flag} = ?, updated_at = ? WHERE id = ?`).run(value ? 1 : 0, nowIso(), userId);
  }

  addLedger(userId, amount, reason, refType, refId) {
    this.db.prepare(`
      INSERT INTO ledger (user_id, amount, reason, ref_type, ref_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, amount, reason, refType || '', refId || '', nowIso());
  }

  createDeviceSession(session) {
    this.db.prepare(`
      INSERT INTO device_sessions (id, code, device_id, plugin_version, platform, target_language, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.code,
      session.device_id,
      session.plugin_version || '',
      session.platform || '',
      session.target_language || '',
      session.expires_at,
      nowIso()
    );
  }

  getDeviceSessionById(id) {
    return this.db.prepare('SELECT * FROM device_sessions WHERE id = ?').get(id);
  }

  getDeviceSessionByCode(code) {
    return this.db.prepare('SELECT * FROM device_sessions WHERE code = ?').get(String(code || '').toUpperCase());
  }

  linkDeviceSession(session, user, deviceId, token) {
    const tokenHash = sha256(token);
    const now = nowIso();

    this.db.prepare(`
      INSERT INTO devices (id, user_id, device_id, token_hash, plugin_version, platform, target_language, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      deviceId,
      user.id,
      session.device_id,
      tokenHash,
      session.plugin_version || '',
      session.platform || '',
      session.target_language || '',
      now,
      now
    );

    this.db.prepare(`
      UPDATE device_sessions
      SET user_id = ?, device_token_hash = ?, linked_at = ?
      WHERE id = ?
    `).run(user.id, tokenHash, now, session.id);
  }

  getDeviceByToken(token) {
    const tokenHash = sha256(token);
    const device = this.db.prepare(`
      SELECT d.*, u.telegram_id, u.username, u.first_name, u.balance, u.unlimited, u.blocked
      FROM devices d
      JOIN users u ON u.id = d.user_id
      WHERE d.token_hash = ? AND d.revoked_at IS NULL
    `).get(tokenHash);

    if (device) {
      this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(nowIso(), device.id);
    }

    return device || null;
  }

  listUserDevices(userId) {
    return this.db.prepare(`
      SELECT id, device_id, plugin_version, platform, target_language, created_at, last_seen_at, revoked_at
      FROM devices
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(userId);
  }

  revokeDevice(userId, deviceRowId) {
    const now = nowIso();
    const result = this.db.prepare(`
      UPDATE devices SET revoked_at = ?
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL
    `).run(now, deviceRowId, userId);
    return result.changes > 0;
  }

  getCachedTranslation(cacheKey) {
    const row = this.db.prepare('SELECT * FROM subtitle_cache WHERE cache_key = ?').get(cacheKey);
    if (!row) return null;
    this.db.prepare('UPDATE subtitle_cache SET hits = hits + 1 WHERE cache_key = ?').run(cacheKey);
    return {
      ...row,
      cues: JSON.parse(row.cues_json)
    };
  }

  saveCachedTranslation(cache) {
    this.db.prepare(`
      INSERT OR REPLACE INTO subtitle_cache
        (cache_key, source_hash, source_language, target_language, model, source_chars, cues_json, created_at, hits)
      VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM subtitle_cache WHERE cache_key = ?), ?), COALESCE((SELECT hits FROM subtitle_cache WHERE cache_key = ?), 0))
    `).run(
      cache.cache_key,
      cache.source_hash,
      cache.source_language,
      cache.target_language,
      cache.model,
      cache.source_chars,
      JSON.stringify(cache.cues),
      cache.cache_key,
      nowIso(),
      cache.cache_key
    );
  }

  getCachedTranslationChunk(cacheKey, chunkKey) {
    const row = this.db.prepare(`
      SELECT items_json FROM subtitle_chunk_cache
      WHERE cache_key = ? AND chunk_key = ?
    `).get(cacheKey, chunkKey);

    if (!row) return null;

    this.db.prepare(`
      UPDATE subtitle_chunk_cache
      SET hits = hits + 1
      WHERE cache_key = ? AND chunk_key = ?
    `).run(cacheKey, chunkKey);

    return JSON.parse(row.items_json);
  }

  saveCachedTranslationChunk(cacheKey, chunkKey, items) {
    const safeItems = Array.isArray(items) ? items : [];

    if (!cacheKey || !chunkKey || !safeItems.length) return;

    this.db.prepare(`
      INSERT OR REPLACE INTO subtitle_chunk_cache
        (cache_key, chunk_key, items_json, items_count, created_at, hits)
      VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM subtitle_chunk_cache WHERE cache_key = ? AND chunk_key = ?), ?), COALESCE((SELECT hits FROM subtitle_chunk_cache WHERE cache_key = ? AND chunk_key = ?), 0))
    `).run(
      cacheKey,
      chunkKey,
      JSON.stringify(safeItems),
      safeItems.length,
      cacheKey,
      chunkKey,
      nowIso(),
      cacheKey,
      chunkKey
    );
  }

  findActiveJobByUserCache(userId, cacheKey) {
    return this.db.prepare(`
      SELECT * FROM translations
      WHERE user_id = ? AND cache_key = ? AND status IN ('queued', 'processing')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(userId, cacheKey);
  }

  countActiveJobs(userId) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM translations
      WHERE user_id = ? AND status IN ('queued', 'processing')
    `).get(userId);
    return row ? row.count : 0;
  }

  createTranslationJob(job, user) {
    return this.tx(() => {
      const fresh = this.getUserById(user.id);
      if (!fresh || fresh.blocked) throw new Error('USER_BLOCKED');
      if (!fresh.unlimited && fresh.balance < job.credits_reserved) throw new Error('NOT_ENOUGH_CREDITS');

      if (!fresh.unlimited && job.credits_reserved > 0) {
        this.updateUserBalance(fresh.id, fresh.balance - job.credits_reserved);
        this.addLedger(fresh.id, -job.credits_reserved, 'translation_reserve', 'translation', job.id);
      }

      this.db.prepare(`
        INSERT INTO translations
          (id, user_id, device_row_id, cache_key, source_url, source_language, target_language, model, media_json, cues_json,
           source_chars, credits_reserved, credits_spent, status, progress, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'queued', '0%', ?, ?)
      `).run(
        job.id,
        user.id,
        job.device_row_id,
        job.cache_key,
        job.source_url || '',
        job.source_language,
        job.target_language,
        job.model,
        JSON.stringify(job.media || {}),
        JSON.stringify(job.cues),
        job.source_chars,
        fresh.unlimited ? 0 : job.credits_reserved,
        nowIso(),
        nowIso()
      );
    });
  }

  getTranslationJob(jobId) {
    return this.db.prepare('SELECT * FROM translations WHERE id = ?').get(jobId);
  }

  getTranslationJobForUser(jobId, userId) {
    return this.db.prepare('SELECT * FROM translations WHERE id = ? AND user_id = ?').get(jobId, userId);
  }

  listUserTranslations(userId, limit = 10) {
    return this.db.prepare(`
      SELECT id, source_language, target_language, source_chars, credits_spent, media_json, created_at, completed_at
      FROM translations
      WHERE user_id = ? AND status = 'completed'
      ORDER BY COALESCE(completed_at, created_at) DESC
      LIMIT ?
    `).all(userId, Math.max(1, Math.min(50, Number(limit) || 10)));
  }

  listRecoverableJobs() {
    return this.db.prepare(`
      SELECT id FROM translations
      WHERE status IN ('queued', 'processing')
      ORDER BY created_at ASC
    `).all();
  }

  updateJobStatus(jobId, status, progress, error = null) {
    this.db.prepare(`
      UPDATE translations
      SET status = ?, progress = ?, error = ?, updated_at = ?
      WHERE id = ?
    `).run(status, progress || '', error || null, nowIso(), jobId);
  }

  completeJob(job, translatedCues) {
    return this.tx(() => {
      const creditsSpent = job.credits_reserved || 0;
      this.db.prepare(`
        UPDATE translations
        SET status = 'completed', progress = 'done', result_json = ?, credits_spent = ?, updated_at = ?, completed_at = ?
        WHERE id = ?
      `).run(JSON.stringify(translatedCues), creditsSpent, nowIso(), nowIso(), job.id);

      this.saveCachedTranslation({
        cache_key: job.cache_key,
        source_hash: job.cache_key.split(':').pop() || job.cache_key,
        source_language: job.source_language,
        target_language: job.target_language,
        model: job.model,
        source_chars: job.source_chars,
        cues: translatedCues
      });
    });
  }

  failJob(job, message) {
    return this.tx(() => {
      this.db.prepare(`
        UPDATE translations
        SET status = 'failed', progress = 'failed', error = ?, updated_at = ?
        WHERE id = ?
      `).run(message, nowIso(), job.id);

      if (job.credits_reserved > 0) {
        const user = this.getUserById(job.user_id);
        if (user) {
          this.updateUserBalance(user.id, user.balance + job.credits_reserved);
          this.addLedger(user.id, job.credits_reserved, 'translation_refund', 'translation', job.id);
        }
      }
    });
  }

  createPayment(userId, pkg, paymentUrl) {
    const result = this.db.prepare(`
      INSERT INTO payments (user_id, package_id, credits, amount, status, payment_url, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(userId, pkg.id, pkg.credits, pkg.price, paymentUrl || '', nowIso());

    return this.getPayment(result.lastInsertRowid);
  }

  setPaymentUrl(invId, paymentUrl) {
    this.db.prepare('UPDATE payments SET payment_url = ? WHERE inv_id = ?').run(paymentUrl, invId);
    return this.getPayment(invId);
  }

  getPayment(invId) {
    return this.db.prepare('SELECT * FROM payments WHERE inv_id = ?').get(invId);
  }

  markPaymentPaid(invId, rawResult) {
    return this.tx(() => {
      const payment = this.getPayment(invId);
      if (!payment) throw new Error('PAYMENT_NOT_FOUND');
      if (payment.status === 'paid') return { payment, alreadyPaid: true, user: this.getUserById(payment.user_id) };

      const user = this.getUserById(payment.user_id);
      if (!user) throw new Error('USER_NOT_FOUND');

      this.updateUserBalance(user.id, user.balance + payment.credits);
      this.addLedger(user.id, payment.credits, 'payment', 'payment', String(invId));
      this.db.prepare(`
        UPDATE payments
        SET status = 'paid', raw_result = ?, paid_at = ?
        WHERE inv_id = ?
      `).run(JSON.stringify(rawResult || {}), nowIso(), invId);

      return { payment: this.getPayment(invId), alreadyPaid: false, user: this.getUserById(user.id) };
    });
  }

  stats() {
    const users = this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    const paid = this.db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(CAST(amount AS REAL)), 0) AS amount FROM payments WHERE status = 'paid'").get();
    const jobs = this.db.prepare('SELECT status, COUNT(*) AS count FROM translations GROUP BY status').all();
    const cache = this.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(hits), 0) AS hits FROM subtitle_cache').get();
    const chunkCache = this.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(hits), 0) AS hits FROM subtitle_chunk_cache').get();
    return { users, paid, jobs, cache, chunkCache };
  }
}
