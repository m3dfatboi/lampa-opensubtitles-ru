import crypto from 'node:crypto';

export function nowIso() {
  return new Date().toISOString();
}

export function randomId(prefix, bytes = 16) {
  return `${prefix}_${crypto.randomBytes(bytes).toString('hex')}`;
}

export function randomCode(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) code += alphabet[crypto.randomInt(0, alphabet.length)];
  return code;
}

export function sha256(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

export function hash(algo, text) {
  return crypto.createHash(algo).update(String(text || '')).digest('hex');
}

export function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || '').toUpperCase());
  const right = Buffer.from(String(b || '').toUpperCase());
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function jsonResponse(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}

export function textResponse(res, status, text, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(text);
}

export function htmlResponse(res, status, html, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(html);
}

export function cleanText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}
