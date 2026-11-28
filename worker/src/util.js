// Shared helpers: errors, JSON responses, CORS, validation, crypto, audit, rate limiting.
export const VERSION = '3.0.0';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const ID_RE = /^[A-Za-z0-9_.:\-]{1,128}$/;
export function assertId(v, name = 'id') {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new HttpError(400, 'invalid_' + name, `Invalid ${name}`);
  return v;
}
export function assertInt(v, name, min, max) {
  if (!Number.isInteger(v) || v < min || v > max) throw new HttpError(400, 'invalid_' + name, `${name} must be an integer between ${min} and ${max}`);
  return v;
}
export function assertString(v, name, max, { min = 0 } = {}) {
  if (typeof v !== 'string' || v.length < min || v.length > max) throw new HttpError(400, 'invalid_' + name, `${name} must be a string of ${min}-${max} characters`);
  return v;
}
export function assertBool(v, name) {
  if (typeof v !== 'boolean') throw new HttpError(400, 'invalid_' + name, `${name} must be true or false`);
  return v;
}

export function parseOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => s && s !== '*'); // wildcard is never honoured
}

export function corsHeaders(req, env) {
  const origin = req.headers.get('Origin');
  const h = { Vary: 'Origin' };
  if (origin && parseOrigins(env).includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Authorization,Content-Type';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}
export const ok = (data, status = 200) => ({ __ok: true, data, status });

export async function readJson(req, max = 65536) {
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > max) throw new HttpError(413, 'payload_too_large', 'Request body is too large');
  const buf = await req.arrayBuffer();
  if (buf.byteLength > max) throw new HttpError(413, 'payload_too_large', 'Request body is too large');
  if (buf.byteLength === 0) throw new HttpError(400, 'empty_body', 'A JSON body is required');
  let v;
  try {
    v = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Malformed JSON');
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'invalid_body', 'JSON body must be an object');
  return v;
}

// ---------- crypto ----------
const enc = new TextEncoder();
export const b64u = {
  enc(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const p = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
    const bin = atob(p);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
export async function hmac(secret, data) {
  return b64u.enc(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data)));
}
// Constant-time string comparison (compares SHA-256 digests so length does not leak).
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b))),
  ]);
  const xa = new Uint8Array(x), ya = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < xa.length; i++) d |= xa[i] ^ ya[i];
  return d === 0;
}

async function aesKey(secret) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('hirad-token-key:' + secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptString(secret, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(plain));
  return b64u.enc(iv) + '.' + b64u.enc(ct);
}
export async function decryptString(secret, blob) {
  const [iv, ct] = blob.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u.dec(iv) }, await aesKey(secret), b64u.dec(ct));
  return new TextDecoder().decode(pt);
}

// ---------- redaction ----------
export function redact(s, extra) {
  let out = String(s ?? '');
  out = out.replace(/(botapi\.rubika\.ir\/v3\/)[^/\s"']+/gi, '$1[REDACTED]');
  if (extra && extra.length >= 8) out = out.split(extra).join('[REDACTED]');
  return out;
}

// ---------- audit + rate limiting ----------
export async function audit(env, actor, action, target = null, details = null) {
  let d = null;
  if (details != null) d = redact(JSON.stringify(details)).slice(0, 2000);
  await env.DB.prepare('INSERT INTO audit_logs (actor, action, target, details_json) VALUES (?, ?, ?, ?)')
    .bind(actor, action, target, d)
    .run();
}

// Fixed-window limiter backed by D1 (shared across Worker isolates).
export async function rateLimit(env, key, limit, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?').bind(key).first();
  if (!row || now - row.window_start >= windowSec) {
    await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1')
      .bind(key, now).run();
    return;
  }
  if (row.count >= limit) {
    throw new HttpError(429, 'rate_limited', 'Too many requests, try again later', { retry_after: windowSec - (now - row.window_start) });
  }
  await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
}
