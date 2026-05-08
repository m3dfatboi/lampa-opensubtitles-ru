import fs from 'node:fs';
import path from 'node:path';

export function loadDotEnv(filePath = '.env') {
  if (!fs.existsSync(filePath)) return;

  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const index = trimmed.indexOf('=');
    if (index < 0) continue;

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!Object.prototype.hasOwnProperty.call(process.env, key)) process.env[key] = value;
  }
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (typeof value === 'undefined') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function numberEnv(name, fallback) {
  const value = Number.parseFloat(process.env[name] || '');
  return Number.isFinite(value) ? value : fallback;
}

function listEnv(name) {
  return (process.env[name] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function packagesEnv() {
  return (process.env.CREDIT_PACKAGES || '30:299,100:899,300:2390,1000:6990')
    .split(',')
    .map((item) => {
      const [creditsRaw, priceRaw] = item.split(':');
      const credits = Number.parseInt(creditsRaw, 10);
      const price = Number.parseFloat(priceRaw);
      if (!credits || !Number.isFinite(price)) return null;

      return {
        id: `credits_${credits}`,
        title: `${credits} кредитов`,
        credits,
        price: price.toFixed(2)
      };
    })
    .filter(Boolean);
}

function safeTranslationModel(value, fallback) {
  const model = (value || fallback).trim() || fallback;

  if (/^openrouter\/auto$/i.test(model)) return fallback;
  if (/^openai\/gpt-5\.4-pro/i.test(model)) return fallback;

  return model;
}

export function createConfig(rootDir = process.cwd()) {
  loadDotEnv(path.join(rootDir, '.env'));

  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8090}`).replace(/\/+$/, '');

  return {
    rootDir,
    env: process.env.NODE_ENV || 'development',
    port: intEnv('PORT', 8090),
    publicBaseUrl,
    dbPath: path.resolve(rootDir, process.env.DB_PATH || './data/lampa_translate.sqlite'),
    telegram: {
      token: process.env.TELEGRAM_BOT_TOKEN || '',
      username: (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
      apiHost: process.env.TELEGRAM_API_HOST || 'api.telegram.org',
      apiIp: process.env.TELEGRAM_API_IP || '',
      apiTimeoutMs: intEnv('TELEGRAM_API_TIMEOUT_MS', 45000),
      proxyUrl: (process.env.TELEGRAM_PROXY_URL || '').replace(/\/+$/, ''),
      admins: listEnv('ADMIN_TELEGRAM_IDS'),
      unlimitedUsers: listEnv('UNLIMITED_TELEGRAM_IDS')
    },
    openRouter: {
      apiKey: process.env.OPENROUTER_API_KEY || '',
      model: safeTranslationModel(process.env.TRANSLATION_MODEL, 'google/gemini-2.5-flash'),
      fallbackModel: safeTranslationModel(process.env.TRANSLATION_FALLBACK_MODEL, 'google/gemini-2.5-pro'),
      enableFallback: boolEnv('TRANSLATION_ENABLE_FALLBACK', true),
      temperature: numberEnv('TRANSLATION_TEMPERATURE', 0.1),
      timeoutMs: intEnv('OPENROUTER_TIMEOUT_MS', 180000),
      referer: process.env.OPENROUTER_REFERER || 'https://m3dfatboi.github.io/lampa-opensubtitles-ru/',
      title: process.env.OPENROUTER_TITLE || 'Lampa OpenSubtitles Translate'
    },
    product: {
      trialCredits: intEnv('TRIAL_CREDITS', 3),
      anonymousFreeTranslations: intEnv('ANONYMOUS_FREE_TRANSLATIONS', 3),
      creditChars: intEnv('CREDIT_CHARS', 10000),
      maxSubtitleChars: intEnv('MAX_SUBTITLE_CHARS', 250000),
      maxActiveJobsPerUser: intEnv('MAX_ACTIVE_JOBS_PER_USER', 1),
      chunkMaxCues: intEnv('TRANSLATION_CHUNK_MAX_CUES', 80),
      chunkMaxChars: intEnv('TRANSLATION_CHUNK_MAX_CHARS', 8000),
      chunkMaxTokens: intEnv('TRANSLATION_CHUNK_MAX_TOKENS', 12000),
      packages: packagesEnv()
    },
    robokassa: {
      merchantLogin: process.env.ROBOKASSA_MERCHANT_LOGIN || '',
      password1: process.env.ROBOKASSA_PASSWORD1 || '',
      password2: process.env.ROBOKASSA_PASSWORD2 || '',
      hashAlgo: (process.env.ROBOKASSA_HASH_ALGO || 'md5').toLowerCase(),
      test: boolEnv('ROBOKASSA_TEST', true),
      receiptEnabled: boolEnv('ROBOKASSA_RECEIPT_ENABLED', false),
      receiptSno: process.env.ROBOKASSA_RECEIPT_SNO || 'usn_income',
      receiptTax: process.env.ROBOKASSA_RECEIPT_TAX || 'none'
    }
  };
}
