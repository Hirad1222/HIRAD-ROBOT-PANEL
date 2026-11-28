// Minimal Rubika Bot API client. Only methods listed on the official page
// https://rubika.ir/botapi/methods are used: getMe, getChat, sendMessage, deleteMessage.
// The token is part of the request URL, so every error path is redacted.
import { HttpError, redact } from './util.js';

const BASE = 'https://botapi.rubika.ir/v3';

export class RubikaError extends Error {
  constructor(message, status) { super(message); this.name = 'RubikaError'; this.status = status; }
}

export async function callRubika(token, method, body = {}, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(`${BASE}/${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    throw new RubikaError(redact(`Network error calling ${method}: ${e?.message || e}`, token), 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new RubikaError(`Rubika ${method} failed with HTTP ${res.status}`, res.status);
  // The methods page does not specify the envelope; if a `status` field exists it must be "OK".
  if (data && typeof data === 'object' && 'status' in data && String(data.status).toUpperCase() !== 'OK') {
    throw new RubikaError(redact(`Rubika ${method} returned status ${String(data.status).slice(0, 40)}`, token), res.status);
  }
  if (!data || typeof data !== 'object') throw new RubikaError(`Rubika ${method} returned an unreadable response`, res.status);
  return data.data ?? data;
}

export const rubika = {
  getMe: (token, f) => callRubika(token, 'getMe', {}, f),
  getChat: (token, chat_id, f) => callRubika(token, 'getChat', { chat_id }, f),
  sendMessage: (token, chat_id, text, f) => callRubika(token, 'sendMessage', { chat_id, text }, f),
  deleteMessage: (token, chat_id, message_id, f) => callRubika(token, 'deleteMessage', { chat_id, message_id }, f),
};

// Fields of the getMe / getChat responses are not documented on the methods page, so
// display fields are read defensively and never used for security decisions.
export function pickBot(me) {
  const b = me?.bot ?? me ?? {};
  return {
    id: b.bot_id ?? b.id ?? null,
    name: b.bot_title ?? b.title ?? b.name ?? b.first_name ?? null,
    username: b.username ?? null,
  };
}
export function pickChat(res) {
  const c = res?.chat ?? res ?? {};
  return { title: c.title ?? c.first_name ?? null, type: c.chat_type ?? c.type ?? null };
}
export function requireToken(token) {
  if (!token) throw new HttpError(409, 'bot_not_connected', 'The Rubika bot is not connected');
  return token;
}
