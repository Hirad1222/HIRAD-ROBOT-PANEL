import {
  HttpError, assertId, assertInt, assertString, assertBool, readJson, audit, rateLimit, safeEqual, hmac, b64u,
  encryptString, decryptString, redact, VERSION, ok,
} from './util.js';
import { rubika, pickBot, pickChat, requireToken, RubikaError } from './rubika.js';
import { RULE_KEYS, RULE_DEFS, defaultParams, defaultEnabled, validateParams, evaluateMessage, escalation, renderTemplate } from './rules.js';

export const CAPABILITIES = {
  bot_connect: { available: true, basis: 'getMe (official)' },
  manual_group_add: { available: true, basis: 'getChat (official)' },
  send_message: { available: true, basis: 'sendMessage (official)' },
  delete_message: { available: true, basis: 'deleteMessage (official); works only where Rubika grants the bot permission' },
  group_discovery: { available: false, reason: 'The official Rubika Bot API lists no method to enumerate the groups a bot belongs to. Add groups by chat ID.' },
  ban_member: { available: false, reason: 'banChatMember / unbanChatMember are not on the official methods page, so they are not implemented.' },
  mute_member: { available: false, reason: 'No restrict/mute method is documented by Rubika.' },
  slow_mode: { available: false, reason: 'No slow-mode method is documented; the value is stored only.' },
  media_link_lock: { available: false, reason: 'No chat-permission method is documented; the switches are stored only.' },
  member_list: { available: false, reason: 'No member-listing method is documented.' },
  message_ingestion: { available: false, reason: 'getUpdates / updateBotEndpoints are documented, but the Update object fields are not, so live automatic moderation is not enabled. Use the dry-run tester.' },
  welcome_delivery: { available: false, reason: 'Join/leave events cannot be received yet. Use "send test message" to check the text.' },
  live_prices: { available: false, reason: 'No verified free source for currency/gold prices is wired in.' },
  levels_leaderboard: { available: false, reason: 'Requires the live message stream.' },
};

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

// ---------- auth ----------
const SESSION_TTL = 12 * 3600;
async function epoch(env) {
  const r = await env.DB.prepare("SELECT value FROM app_state WHERE key = 'session_epoch'").first();
  return r ? Number(r.value) : 0;
}
export async function issueSession(env) {
  const payload = b64u.enc(new TextEncoder().encode(JSON.stringify({ sub: 'owner', exp: Math.floor(Date.now() / 1000) + SESSION_TTL, ep: await epoch(env) })));
  return payload + '.' + (await hmac(env.SESSION_SECRET, payload));
}
export async function verifySession(env, token) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new HttpError(503, 'not_configured', 'Server authentication is not configured');
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig || !(await safeEqual(sig, await hmac(env.SESSION_SECRET, payload)))) throw new HttpError(401, 'unauthorized', 'Authentication required');
  let p;
  try { p = JSON.parse(new TextDecoder().decode(b64u.dec(payload))); } catch { throw new HttpError(401, 'unauthorized', 'Authentication required'); }
  if (!p || p.exp < Date.now() / 1000 || p.ep !== (await epoch(env))) throw new HttpError(401, 'session_expired', 'Session expired, please sign in again');
  return p;
}

export async function login(req, env, ctx) {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 12 || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new HttpError(503, 'not_configured', 'ADMIN_PASSWORD (12+ chars) and SESSION_SECRET (32+ chars) must be set as Worker secrets');
  }
  await rateLimit(env, 'login:' + ctx.ip, 5, 900);
  const body = await readJson(req, 2048);
  const pw = assertString(body.password, 'password', 256, { min: 1 });
  if (!(await safeEqual(pw, env.ADMIN_PASSWORD))) {
    await audit(env, 'anonymous', 'auth.login_failed', null, { ip_tail: ctx.ip.slice(-6) });
    throw new HttpError(401, 'invalid_credentials', 'Incorrect password');
  }
  await audit(env, 'owner', 'auth.login');
  return ok({ token: await issueSession(env), expires_in: SESSION_TTL });
}
export async function logoutAll(env, ctx) {
  await env.DB.prepare("INSERT INTO app_state (key, value) VALUES ('session_epoch','1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();
  await audit(env, ctx.actor, 'auth.logout_all');
  return ok({ done: true });
}

// ---------- bot connection ----------
async function getBotRow(env) { return env.DB.prepare('SELECT * FROM bot_connections WHERE id = 1').first(); }
export async function getToken(env) {
  if (env.RUBIKA_BOT_TOKEN) return env.RUBIKA_BOT_TOKEN; // preferred: Cloudflare secret
  const row = await getBotRow(env);
  if (!row?.token_enc) return null;
  if (!env.TOKEN_ENC_KEY || env.TOKEN_ENC_KEY.length < 32) throw new HttpError(503, 'not_configured', 'TOKEN_ENC_KEY secret is not configured');
  try { return await decryptString(env.TOKEN_ENC_KEY, row.token_enc); } catch { throw new HttpError(500, 'token_unreadable', 'Stored token cannot be decrypted; reconnect the bot'); }
}
function botView(row, env) {
  return {
    status: row.status,
    source: env.RUBIKA_BOT_TOKEN ? 'secret' : row.token_enc ? 'encrypted_d1' : null,
    bot: row.status === 'connected' ? { id: row.bot_id, name: row.bot_name, username: row.bot_username } : null,
    connected_at: row.connected_at, last_checked_at: row.last_checked_at, last_error: row.last_error,
    encryption_configured: !!(env.TOKEN_ENC_KEY && env.TOKEN_ENC_KEY.length >= 32),
  };
}
export async function botStatus(env) { return ok(botView(await getBotRow(env), env)); }

export async function botConnect(req, env, ctx, f) {
  await rateLimit(env, 'bot-connect:' + ctx.actor, 10, 600);
  const body = await readJson(req, 4096);
  const token = assertString(body.token, 'token', 256, { min: 16 });
  if (!/^[A-Za-z0-9_\-]+$/.test(token)) throw new HttpError(400, 'invalid_token', 'Token format is invalid');
  if (!env.RUBIKA_BOT_TOKEN && (!env.TOKEN_ENC_KEY || env.TOKEN_ENC_KEY.length < 32)) {
    throw new HttpError(503, 'not_configured', 'TOKEN_ENC_KEY (32+ chars) must be set as a Worker secret before a token can be stored');
  }
  let bot;
  try { bot = pickBot(await rubika.getMe(token, f)); }
  catch (e) {
    const msg = e instanceof RubikaError ? redact(e.message, token) : 'Could not reach Rubika';
    await env.DB.prepare("UPDATE bot_connections SET status='error', last_error=?, last_checked_at=?, updated_at=? WHERE id=1").bind(msg, nowIso(), nowIso()).run();
    await audit(env, ctx.actor, 'bot.connect_failed', null, { error: msg });
    throw new HttpError(422, 'rubika_rejected', 'Rubika did not accept this token');
  }
  const stored = env.RUBIKA_BOT_TOKEN ? null : await encryptString(env.TOKEN_ENC_KEY, token);
  await env.DB.prepare("UPDATE bot_connections SET status='connected', bot_id=?, bot_name=?, bot_username=?, token_enc=?, last_error=NULL, connected_at=?, last_checked_at=?, updated_at=? WHERE id=1")
    .bind(bot.id == null ? null : String(bot.id), bot.name, bot.username, stored, nowIso(), nowIso(), nowIso()).run();
  await audit(env, ctx.actor, 'bot.connect', null, { bot_username: bot.username });
  return ok(botView(await getBotRow(env), env));
}
export async function botDisconnect(env, ctx) {
  await env.DB.prepare("UPDATE bot_connections SET status='disconnected', bot_id=NULL, bot_name=NULL, bot_username=NULL, token_enc=NULL, last_error=NULL, connected_at=NULL, updated_at=? WHERE id=1").bind(nowIso()).run();
  await audit(env, ctx.actor, 'bot.disconnect');
  return ok({ ...botView(await getBotRow(env), env), note: env.RUBIKA_BOT_TOKEN ? 'A RUBIKA_BOT_TOKEN secret is still set in Cloudflare; delete it there to fully disconnect.' : undefined });
}
export async function botCheck(env, ctx, f) {
  await rateLimit(env, 'bot-check:' + ctx.actor, 20, 300);
  const token = await getToken(env);
  if (!token) throw new HttpError(409, 'bot_not_connected', 'The Rubika bot is not connected');
  try {
    const bot = pickBot(await rubika.getMe(token, f));
    await env.DB.prepare("UPDATE bot_connections SET status='connected', bot_id=?, bot_name=?, bot_username=?, last_error=NULL, last_checked_at=?, connected_at=COALESCE(connected_at, ?) WHERE id=1")
      .bind(bot.id == null ? null : String(bot.id), bot.name, bot.username, nowIso(), nowIso()).run();
  } catch (e) {
    await env.DB.prepare("UPDATE bot_connections SET status='error', last_error=?, last_checked_at=? WHERE id=1").bind(redact(e.message, token), nowIso()).run();
  }
  return ok(botView(await getBotRow(env), env));
}

// ---------- groups ----------
async function requireGroup(env, id) {
  assertId(id, 'group_id');
  const g = await env.DB.prepare('SELECT * FROM groups WHERE chat_id = ?').bind(id).first();
  if (!g) throw new HttpError(404, 'group_not_found', 'Group is not registered in the panel');
  return g;
}
export async function listGroups(env) {
  const bot = await getBotRow(env);
  const rows = (await env.DB.prepare('SELECT chat_id, title, chat_type, status, last_error, last_checked_at, added_at FROM groups ORDER BY added_at DESC').all()).results;
  return ok({
    groups: rows,
    bot_status: bot.status,
    discovery: CAPABILITIES.group_discovery,
    message: rows.length ? null : bot.status === 'connected'
      ? 'No groups registered yet. Rubika offers no way to list a bot\'s groups, so add a group by its chat ID.'
      : 'The bot is not connected, so groups cannot be verified. Connect the bot first.',
  });
}
export async function addGroup(req, env, ctx, f) {
  await rateLimit(env, 'group-add:' + ctx.actor, 20, 600);
  const body = await readJson(req, 2048);
  const id = assertId(body.chat_id, 'chat_id');
  const token = requireToken(await getToken(env));
  let chat;
  try { chat = pickChat(await rubika.getChat(token, id, f)); }
  catch (e) { throw new HttpError(422, 'chat_unreachable', 'Rubika could not return this chat. Check the ID and that the bot is a member.', { rubika_status: e.status ?? null }); }
  const t = nowIso();
  const ex = await env.DB.prepare('SELECT 1 AS x FROM groups WHERE chat_id = ?').bind(id).first();
  if (ex) throw new HttpError(409, 'group_exists', 'Group is already registered');
  await env.DB.batch([
    env.DB.prepare("INSERT INTO groups (chat_id, title, chat_type, status, last_checked_at) VALUES (?, ?, ?, 'reachable', ?)").bind(id, chat.title, chat.type, t),
    env.DB.prepare('INSERT INTO group_settings (group_id) VALUES (?)').bind(id),
    env.DB.prepare('INSERT INTO welcome_settings (group_id) VALUES (?)').bind(id),
  ]);
  await audit(env, ctx.actor, 'group.add', id, { title: chat.title });
  return ok({ chat_id: id, title: chat.title, chat_type: chat.type, status: 'reachable' }, 201);
}
export async function refreshGroup(env, ctx, id, f) {
  await requireGroup(env, id);
  await rateLimit(env, 'group-refresh:' + ctx.actor, 30, 300);
  const token = requireToken(await getToken(env));
  try {
    const chat = pickChat(await rubika.getChat(token, id, f));
    await env.DB.prepare("UPDATE groups SET title=?, chat_type=?, status='reachable', last_error=NULL, last_checked_at=?, updated_at=? WHERE chat_id=?").bind(chat.title, chat.type, nowIso(), nowIso(), id).run();
  } catch (e) {
    await env.DB.prepare("UPDATE groups SET status='unreachable', last_error=?, last_checked_at=?, updated_at=? WHERE chat_id=?").bind(redact(e.message, token).slice(0, 200), nowIso(), nowIso(), id).run();
  }
  return ok(await requireGroup(env, id));
}
export async function removeGroup(env, ctx, id) {
  await requireGroup(env, id);
  await env.DB.prepare('DELETE FROM groups WHERE chat_id = ?').bind(id).run(); // cascades
  await audit(env, ctx.actor, 'group.remove', id);
  return ok({ removed: id });
}

// ---------- settings ----------
async function loadSettings(env, id) {
  const [gs, ws, rs] = await Promise.all([
    env.DB.prepare('SELECT * FROM group_settings WHERE group_id = ?').bind(id).first(),
    env.DB.prepare('SELECT * FROM welcome_settings WHERE group_id = ?').bind(id).first(),
    env.DB.prepare('SELECT rule_key, enabled, params_json FROM moderation_rules WHERE group_id = ?').bind(id).all(),
  ]);
  const rules = {};
  for (const k of RULE_KEYS) rules[k] = { enabled: defaultEnabled(k), params: defaultParams(k) };
  for (const r of rs.results) {
    let p = {};
    try { p = JSON.parse(r.params_json); } catch { /* keep defaults */ }
    rules[r.rule_key] = { enabled: !!r.enabled, params: { ...defaultParams(r.rule_key), ...p } };
  }
  return {
    group: {
      rules_text: gs.rules_text, slow_mode_seconds: gs.slow_mode_seconds, lock_links: !!gs.lock_links, lock_media: !!gs.lock_media,
      warn_threshold: gs.warn_threshold, warn_action: gs.warn_action, action_duration_minutes: gs.action_duration_minutes, updated_at: gs.updated_at,
    },
    welcome: { welcome_enabled: !!ws.welcome_enabled, welcome_text: ws.welcome_text, leave_enabled: !!ws.leave_enabled, leave_text: ws.leave_text },
    rules,
  };
}
export async function getSettings(env, id) {
  await requireGroup(env, id);
  return ok({ group_id: id, ...(await loadSettings(env, id)), capabilities: CAPABILITIES });
}

const GROUP_FIELDS = {
  rules_text: (v) => assertString(v, 'rules_text', 2000),
  slow_mode_seconds: (v) => assertInt(v, 'slow_mode_seconds', 0, 3600),
  lock_links: (v) => (assertBool(v, 'lock_links') ? 1 : 0),
  lock_media: (v) => (assertBool(v, 'lock_media') ? 1 : 0),
  warn_threshold: (v) => assertInt(v, 'warn_threshold', 1, 20),
  warn_action: (v) => { if (!['none', 'review', 'mute', 'temp_ban', 'ban'].includes(v)) throw new HttpError(400, 'invalid_warn_action', 'Invalid warn_action'); return v; },
  action_duration_minutes: (v) => assertInt(v, 'action_duration_minutes', 1, 525600),
};
const WELCOME_FIELDS = {
  welcome_enabled: (v) => (assertBool(v, 'welcome_enabled') ? 1 : 0),
  welcome_text: (v) => assertString(v, 'welcome_text', 1000),
  leave_enabled: (v) => (assertBool(v, 'leave_enabled') ? 1 : 0),
  leave_text: (v) => assertString(v, 'leave_text', 1000),
};

export async function putSettings(req, env, ctx, id) {
  await requireGroup(env, id);
  await rateLimit(env, 'settings:' + ctx.actor, 60, 60);
  const body = await readJson(req, 65536);
  const allowedTop = ['group', 'welcome', 'rules'];
  for (const k of Object.keys(body)) if (!allowedTop.includes(k)) throw new HttpError(400, 'unknown_field', `Unknown field: ${k}`);
  const stmts = [];
  const changed = [];
  const build = (table, fields, input, where) => {
    if (input == null) return;
    if (typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'invalid_body', `${table} must be an object`);
    const cols = [], vals = [];
    for (const [k, v] of Object.entries(input)) {
      if (!fields[k]) throw new HttpError(400, 'unknown_field', `Unknown field: ${k}`);
      cols.push(`${k} = ?`); vals.push(fields[k](v)); changed.push(k);
    }
    if (cols.length) stmts.push(env.DB.prepare(`UPDATE ${table} SET ${cols.join(', ')}, updated_at = ? WHERE group_id = ?`).bind(...vals, nowIso(), where));
  };
  build('group_settings', GROUP_FIELDS, body.group, id);
  build('welcome_settings', WELCOME_FIELDS, body.welcome, id);
  if (body.rules != null) {
    if (typeof body.rules !== 'object' || Array.isArray(body.rules)) throw new HttpError(400, 'invalid_body', 'rules must be an object');
    for (const [key, val] of Object.entries(body.rules)) {
      if (!RULE_DEFS[key]) throw new HttpError(400, 'unknown_rule', `Unknown rule: ${key}`);
      if (val == null || typeof val !== 'object') throw new HttpError(400, 'invalid_rule', `Rule ${key} must be an object`);
      for (const k of Object.keys(val)) if (!['enabled', 'params'].includes(k)) throw new HttpError(400, 'unknown_field', `Unknown field in rule ${key}: ${k}`);
      const cur = (await loadSettings(env, id)).rules[key];
      const enabled = 'enabled' in val ? assertBool(val.enabled, 'enabled') : cur.enabled;
      let params = cur.params;
      if ('params' in val) { const v = validateParams(key, val.params); if (!v.ok) throw new HttpError(400, 'invalid_rule_params', `${key}: ${v.error}`); params = v.params; }
      stmts.push(env.DB.prepare("INSERT INTO moderation_rules (group_id, rule_key, enabled, params_json) VALUES (?, ?, ?, ?) ON CONFLICT(group_id, rule_key) DO UPDATE SET enabled = excluded.enabled, params_json = excluded.params_json, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')")
        .bind(id, key, enabled ? 1 : 0, JSON.stringify(params)));
      changed.push('rule:' + key);
    }
  }
  if (!stmts.length) throw new HttpError(400, 'nothing_to_update', 'No settings were provided');
  try { await env.DB.batch(stmts); } catch { throw new HttpError(500, 'db_error', 'Database write failed'); }
  await audit(env, ctx.actor, 'settings.update', id, { fields: changed });
  return ok({ group_id: id, ...(await loadSettings(env, id)), capabilities: CAPABILITIES });
}

// ---------- moderation ----------
async function bump(env, groupId, metric, n = 1) {
  const sql = 'INSERT INTO analytics_daily (day, group_id, metric, value) VALUES (?, ?, ?, ?) ON CONFLICT(day, group_id, metric) DO UPDATE SET value = value + excluded.value';
  await env.DB.batch([env.DB.prepare(sql).bind(today(), groupId, metric, n), env.DB.prepare(sql).bind(today(), '*', metric, n)]);
}

export async function testMessage(req, env, id) {
  await requireGroup(env, id);
  const body = await readJson(req, 32768);
  const text = assertString(body.text, 'text', 8000);
  let recent = [];
  if (body.recent != null) {
    if (!Array.isArray(body.recent) || body.recent.length > 50) throw new HttpError(400, 'invalid_recent', 'recent must be an array of up to 50 items');
    recent = body.recent.map((r) => ({ text: assertString(r?.text, 'recent.text', 8000), ts: assertInt(r?.ts, 'recent.ts', 0, 8.64e15) }));
  }
  const s = await loadSettings(env, id);
  const exempt = body.user_id ? !!(await env.DB.prepare('SELECT 1 AS x FROM user_exemptions WHERE group_id = ? AND user_id = ?').bind(id, assertId(body.user_id, 'user_id')).first()) : false;
  const res = evaluateMessage({ text, recent, now: body.now ?? Date.now(), isAdmin: body.is_admin === true, exempt }, s.rules);
  return ok({
    dry_run: true, engine: 'deterministic rules (regex + counters), not AI', ...res,
    note: 'Nothing was deleted or sent. Live automatic enforcement is unavailable until Rubika documents its update payload.',
    unavailable_actions: ['ban', 'mute'],
  });
}

export async function issueWarning(req, env, ctx, id, f) {
  const g = await requireGroup(env, id);
  await rateLimit(env, 'warn:' + ctx.actor, 60, 60);
  const body = await readJson(req, 4096);
  const userId = assertId(body.user_id, 'user_id');
  const reason = body.reason == null ? '' : assertString(body.reason, 'reason', 500);
  const notify = body.notify === true;
  const ex = await env.DB.prepare('SELECT kind FROM user_exemptions WHERE group_id = ? AND user_id = ?').bind(id, userId).first();
  if (ex) throw new HttpError(409, 'user_exempt', `User is exempt (${ex.kind}) and cannot be warned`);
  const r = await env.DB.prepare('INSERT INTO warnings (group_id, user_id, reason, issued_by) VALUES (?, ?, ?, ?)').bind(id, userId, reason, ctx.actor).run();
  const count = (await env.DB.prepare('SELECT COUNT(*) AS c FROM warnings WHERE group_id = ? AND user_id = ? AND revoked_at IS NULL').bind(id, userId).first()).c;
  const s = (await loadSettings(env, id)).group;
  const esc = escalation(count, s);
  await bump(env, id, 'warnings');
  await audit(env, ctx.actor, 'warning.issue', id, { user_id: userId, count });
  let notified = false;
  if (notify) {
    const token = requireToken(await getToken(env));
    try { await rubika.sendMessage(token, id, `⚠️ اخطار ${count}/${s.warn_threshold} برای کاربر ${userId}${reason ? ': ' + reason : ''}`, f); notified = true; } catch { /* reported below */ }
  }
  let escalationInfo = { triggered: false };
  if (esc.triggered) {
    const supported = esc.action === 'review';
    escalationInfo = { ...esc, executed: false, supported, message: supported ? 'Threshold reached: needs manual review by an administrator.' : `Threshold reached, but "${esc.action}" cannot be executed: the Rubika Bot API does not document a way to do this. No action was taken.` };
    await audit(env, ctx.actor, 'warning.threshold_reached', id, { user_id: userId, action: esc.action, executed: false });
  }
  return ok({ id: r.meta.last_row_id, group_id: g.chat_id, user_id: userId, active_warnings: count, threshold: s.warn_threshold, notified: notify ? notified : null, escalation: escalationInfo }, 201);
}
export async function listWarnings(env, id, url) {
  await requireGroup(env, id);
  const u = url.searchParams.get('user_id');
  const rows = u
    ? (await env.DB.prepare('SELECT * FROM warnings WHERE group_id = ? AND user_id = ? ORDER BY id DESC LIMIT 100').bind(id, assertId(u, 'user_id')).all()).results
    : (await env.DB.prepare('SELECT * FROM warnings WHERE group_id = ? ORDER BY id DESC LIMIT 100').bind(id).all()).results;
  return ok({ warnings: rows });
}
export async function revokeWarning(env, ctx, id, wid) {
  await requireGroup(env, id);
  const n = Number(wid);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'invalid_id', 'Invalid warning id');
  const r = await env.DB.prepare('UPDATE warnings SET revoked_at = ? WHERE id = ? AND group_id = ? AND revoked_at IS NULL').bind(nowIso(), n, id).run();
  if (!r.meta.changes) throw new HttpError(404, 'warning_not_found', 'Active warning not found');
  await audit(env, ctx.actor, 'warning.revoke', id, { warning_id: n });
  return ok({ revoked: n });
}
export async function listViolations(env, id) {
  await requireGroup(env, id);
  return ok({ violations: (await env.DB.prepare('SELECT * FROM violations WHERE group_id = ? ORDER BY id DESC LIMIT 100').bind(id).all()).results });
}
export async function listExemptions(env, id) {
  await requireGroup(env, id);
  return ok({ exemptions: (await env.DB.prepare('SELECT * FROM user_exemptions WHERE group_id = ? ORDER BY created_at DESC LIMIT 500').bind(id).all()).results });
}
export async function addExemption(req, env, ctx, id) {
  await requireGroup(env, id);
  const body = await readJson(req, 2048);
  const userId = assertId(body.user_id, 'user_id');
  const kind = body.kind ?? 'user';
  if (!['user', 'admin'].includes(kind)) throw new HttpError(400, 'invalid_kind', 'kind must be user or admin');
  const note = body.note == null ? '' : assertString(body.note, 'note', 200);
  await env.DB.prepare('INSERT INTO user_exemptions (group_id, user_id, kind, note) VALUES (?, ?, ?, ?) ON CONFLICT(group_id, user_id) DO UPDATE SET kind = excluded.kind, note = excluded.note').bind(id, userId, kind, note).run();
  await audit(env, ctx.actor, 'exemption.add', id, { user_id: userId, kind });
  return ok({ group_id: id, user_id: userId, kind, note }, 201);
}
export async function removeExemption(env, ctx, id, userId) {
  await requireGroup(env, id);
  assertId(userId, 'user_id');
  const r = await env.DB.prepare('DELETE FROM user_exemptions WHERE group_id = ? AND user_id = ?').bind(id, userId).run();
  if (!r.meta.changes) throw new HttpError(404, 'exemption_not_found', 'Exemption not found');
  await audit(env, ctx.actor, 'exemption.remove', id, { user_id: userId });
  return ok({ removed: userId });
}

export async function deleteGroupMessage(req, env, ctx, id, f) {
  await requireGroup(env, id);
  await rateLimit(env, 'delete-msg:' + ctx.actor, 30, 60);
  const body = await readJson(req, 2048);
  const messageId = assertId(body.message_id, 'message_id');
  if (body.confirm !== true) throw new HttpError(400, 'confirmation_required', 'Set confirm: true to delete a message');
  const token = requireToken(await getToken(env));
  try { await rubika.deleteMessage(token, id, messageId, f); }
  catch (e) {
    await audit(env, ctx.actor, 'message.delete_failed', id, { message_id: messageId, status: e.status ?? null });
    throw new HttpError(422, 'rubika_rejected', 'Rubika refused to delete this message (the bot may lack permission).', { rubika_status: e.status ?? null });
  }
  await bump(env, id, 'messages_deleted');
  await audit(env, ctx.actor, 'message.delete', id, { message_id: messageId });
  return ok({ deleted: messageId });
}

export async function testWelcome(req, env, ctx, id, f) {
  const g = await requireGroup(env, id);
  await rateLimit(env, 'welcome-test:' + ctx.actor, 10, 300);
  const body = await readJson(req, 2048);
  const kind = body.kind === 'leave' ? 'leave' : 'welcome';
  const s = (await loadSettings(env, id)).welcome;
  const text = '[تست] ' + renderTemplate(kind === 'leave' ? s.leave_text : s.welcome_text, { name: 'کاربر نمونه', group: g.title || g.chat_id });
  const token = requireToken(await getToken(env));
  try { await rubika.sendMessage(token, id, text, f); } catch (e) { throw new HttpError(422, 'rubika_rejected', 'Rubika did not accept the message', { rubika_status: e.status ?? null }); }
  await bump(env, id, 'welcome_tests');
  await audit(env, ctx.actor, 'welcome.test_sent', id, { kind });
  return ok({ sent: true, preview: text });
}

// ---------- reports ----------
export async function listReports(env, id, url) {
  await requireGroup(env, id);
  const st = url.searchParams.get('status');
  if (st && !['open', 'resolved', 'dismissed'].includes(st)) throw new HttpError(400, 'invalid_status', 'Invalid status');
  const rows = st
    ? (await env.DB.prepare('SELECT * FROM user_reports WHERE group_id = ? AND status = ? ORDER BY id DESC LIMIT 100').bind(id, st).all()).results
    : (await env.DB.prepare('SELECT * FROM user_reports WHERE group_id = ? ORDER BY id DESC LIMIT 100').bind(id).all()).results;
  return ok({ reports: rows });
}
export async function addReport(req, env, ctx, id) {
  await requireGroup(env, id);
  const body = await readJson(req, 4096);
  const reported = assertId(body.reported_user_id, 'reported_user_id');
  const reporter = body.reporter_id == null ? null : assertId(body.reporter_id, 'reporter_id');
  const messageId = body.message_id == null ? null : assertId(body.message_id, 'message_id');
  const reason = body.reason == null ? '' : assertString(body.reason, 'reason', 500);
  const r = await env.DB.prepare('INSERT INTO user_reports (group_id, reporter_id, reported_user_id, message_id, reason) VALUES (?, ?, ?, ?, ?)').bind(id, reporter, reported, messageId, reason).run();
  await audit(env, ctx.actor, 'report.create', id, { reported_user_id: reported });
  return ok({ id: r.meta.last_row_id }, 201);
}
export async function updateReport(req, env, ctx, id, rid) {
  await requireGroup(env, id);
  const n = Number(rid);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'invalid_id', 'Invalid report id');
  const body = await readJson(req, 1024);
  if (!['resolved', 'dismissed', 'open'].includes(body.status)) throw new HttpError(400, 'invalid_status', 'status must be open, resolved or dismissed');
  const r = await env.DB.prepare('UPDATE user_reports SET status = ?, resolved_at = ? WHERE id = ? AND group_id = ?').bind(body.status, body.status === 'open' ? null : nowIso(), n, id).run();
  if (!r.meta.changes) throw new HttpError(404, 'report_not_found', 'Report not found');
  await audit(env, ctx.actor, 'report.update', id, { report_id: n, status: body.status });
  return ok({ id: n, status: body.status });
}

// ---------- unavailable features: explicit, never simulated ----------
export function unavailable(feature) {
  const c = CAPABILITIES[feature];
  throw new HttpError(501, 'feature_unavailable', c.reason, { feature });
}

// ---------- summary / analytics / audit ----------
export async function summary(env) {
  const bot = await getBotRow(env);
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
  const [g, w, v, r, m] = await Promise.all([
    q('SELECT COUNT(*) AS c FROM groups'),
    q('SELECT COUNT(*) AS c FROM warnings WHERE revoked_at IS NULL'),
    q("SELECT COALESCE(SUM(value),0) AS c FROM analytics_daily WHERE group_id='*' AND metric='violations' AND day >= ?", since),
    q("SELECT COUNT(*) AS c FROM user_reports WHERE status='open'"),
    q("SELECT COALESCE(SUM(value),0) AS c FROM analytics_daily WHERE group_id='*' AND metric='messages_deleted' AND day >= ?", since),
  ]);
  return ok({
    version: VERSION, bot_status: bot.status, groups: g.c, active_warnings: w.c, violations_30d: v.c, open_reports: r.c, messages_deleted_30d: m.c,
    messages_checked: null, messages_checked_note: CAPABILITIES.message_ingestion.reason,
    capabilities: CAPABILITIES,
  });
}
export async function analytics(env, url) {
  const days = Number(url.searchParams.get('days') ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new HttpError(400, 'invalid_days', 'days must be 1-365');
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const gid = url.searchParams.get('group_id') ?? '*';
  if (gid !== '*') assertId(gid, 'group_id');
  const rows = (await env.DB.prepare('SELECT day, metric, value FROM analytics_daily WHERE group_id = ? AND day >= ? ORDER BY day ASC').bind(gid, since).all()).results;
  return ok({ group_id: gid, days, series: rows, note: 'Counts only actions recorded by this panel. Message volume is unavailable (no live message stream).' });
}
export async function auditLogs(env, url) {
  const limit = Number(url.searchParams.get('limit') ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new HttpError(400, 'invalid_limit', 'limit must be 1-200');
  const before = url.searchParams.get('before');
  let rows;
  if (before != null) {
    const b = Number(before);
    if (!Number.isInteger(b) || b < 1) throw new HttpError(400, 'invalid_before', 'before must be a positive integer');
    rows = (await env.DB.prepare('SELECT * FROM audit_logs WHERE id < ? ORDER BY id DESC LIMIT ?').bind(b, limit).all()).results;
  } else rows = (await env.DB.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').bind(limit).all()).results;
  return ok({ logs: rows, next_before: rows.length === limit ? rows[rows.length - 1].id : null });
}

export async function recordViolation(req, env, ctx, id) {
  await requireGroup(env, id);
  const body = await readJson(req, 4096);
  const userId = assertId(body.user_id, 'user_id');
  if (!RULE_KEYS.includes(body.rule_key)) throw new HttpError(400, 'invalid_rule_key', 'Unknown rule_key');
  const excerpt = body.excerpt == null ? null : assertString(body.excerpt, 'excerpt', 200);
  const action = body.action_taken == null ? 'logged' : assertString(body.action_taken, 'action_taken', 40, { min: 1 });
  const r = await env.DB.prepare('INSERT INTO violations (group_id, user_id, rule_key, excerpt, action_taken) VALUES (?, ?, ?, ?, ?)').bind(id, userId, body.rule_key, excerpt, action).run();
  await bump(env, id, 'violations');
  await audit(env, ctx.actor, 'violation.record', id, { user_id: userId, rule_key: body.rule_key });
  return ok({ id: r.meta.last_row_id }, 201);
}
