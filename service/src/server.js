import http from 'node:http';
import { htmlResponse, HttpError, jsonResponse, textResponse } from './utils.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

async function readBody(req, maxBytes = 1024 * 1024 * 4) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'request body is too large');
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8');
  const contentType = req.headers['content-type'] || '';

  if (!text) return {};
  if (/application\/json/i.test(contentType)) return JSON.parse(text);
  if (/application\/x-www-form-urlencoded/i.test(contentType)) return Object.fromEntries(new URLSearchParams(text));

  return { raw: text };
}

function queryParams(url) {
  return Object.fromEntries(url.searchParams.entries());
}

function routeMatch(pathname, pattern) {
  const pathParts = pathname.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(pathParts[i]);
    else if (part !== pathParts[i]) return null;
  }

  return params;
}

function paymentPage(title, text) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#111827;color:#fff;margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
    main{max-width:520px;text-align:center}
    h1{font-size:28px;margin:0 0 12px}
    p{font-size:18px;line-height:1.45;color:#d1d5db}
  </style>
</head>
<body><main><h1>${title}</h1><p>${text}</p></main></body>
</html>`;
}

export function createServer(service, bot, config) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        jsonResponse(res, 200, { ok: true, service: 'lampa-opensubtitles-service' }, CORS);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/account') {
        jsonResponse(res, 200, service.getAccount(req.headers.authorization, queryParams(url)), CORS);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/devices/session') {
        const body = await readBody(req);
        jsonResponse(res, 200, service.createDeviceSession(body), CORS);
        return;
      }

      const sessionParams = routeMatch(url.pathname, '/v1/devices/session/:id');
      if (req.method === 'GET' && sessionParams) {
        jsonResponse(res, 200, service.getDeviceSession(sessionParams.id), CORS);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/translations') {
        const body = await readBody(req, 1024 * 1024 * 8);
        jsonResponse(res, 200, service.startTranslation(req.headers.authorization, body), CORS);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/translations/check') {
        const body = await readBody(req, 1024 * 1024 * 8);
        jsonResponse(res, 200, service.checkTranslation(req.headers.authorization, body), CORS);
        return;
      }

      const translationParams = routeMatch(url.pathname, '/v1/translations/:id');
      if (req.method === 'GET' && translationParams) {
        jsonResponse(res, 200, service.getTranslation(req.headers.authorization, translationParams.id, queryParams(url)), CORS);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/payments/robokassa/success') {
        htmlResponse(res, 200, paymentPage('Оплата принята', 'Кредиты появятся в Telegram-боте после подтверждения Robokassa.'), CORS);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/payments/robokassa/fail') {
        htmlResponse(res, 200, paymentPage('Оплата не завершена', 'Можно вернуться в Telegram-бота и попробовать ещё раз.'), CORS);
        return;
      }

      if ((req.method === 'POST' || req.method === 'GET') && url.pathname === '/payments/robokassa/result') {
        const params = req.method === 'POST'
          ? { ...queryParams(url), ...(await readBody(req)) }
          : queryParams(url);
        const result = service.applyRobokassaResult(params);

        if (!result.alreadyPaid && bot) {
          bot.notifyPayment(result.user, result.payment).catch((error) => {
            console.error('[bot] payment notify failed', error);
          });
        }

        textResponse(res, 200, `OK${result.payment.inv_id}`, CORS);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/bot/start') {
        const code = url.searchParams.get('code') || '';
        htmlResponse(res, 200, paymentPage('Откройте Telegram', config.telegram.username ? `Напишите боту @${config.telegram.username}: /start ${code}` : `Код подключения: ${code}`), CORS);
        return;
      }

      jsonResponse(res, 404, { message: 'not found' }, CORS);
    }
    catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof SyntaxError ? 'bad json' : (error.message || 'server error');
      const payload = { message };
      if (error instanceof HttpError && error.details) Object.assign(payload, error.details);
      if (status >= 500) console.error('[server]', error);
      jsonResponse(res, status, payload, CORS);
    }
  });

  return server;
}
