import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDB } from './d1shim.js';
import { handle } from '../worker/src/index.js';

const ORIGIN = 'https://hirad1222.github.io';
const TOKEN = 'TESTTOKEN_abcdefghijklmnopqrstuvwxyz0123456789';
const baseEnv = () => ({ DB: makeDB(), ALLOWED_ORIGINS: ORIGIN, ADMIN_PASSWORD: 'correct-horse-battery', SESSION_SECRET: 's'.repeat(40), TOKEN_ENC_KEY: 'k'.repeat(40) });
let calls;
const rubikaFetch = (behaviour = {}) => async (url, init) => {
  calls.push({ url: String(url), body: JSON.parse(init.body) });
  const method = String(url).split('/').pop();
  const b = behaviour[method];
  if (b === 'fail') return new Response('{"status":"ERROR"}', { status: 403 });
  if (method === 'getMe') return Response.json({ status: 'OK', data: { bot: { bot_id: 'b0X', bot_title: 'TestBot', username: 'test_bot' } } });
  if (method === 'getChat') return Response.json({ status: 'OK', data: { chat: { chat_id: 'g0A', title: "گروه تست", chat_type: 'Group' } } });
  return Response.json({ status: 'OK', data: { message_id: '123' } });
};
async function call(env, method, path, { body, token, origin, raw, headers, f } = {}) {
  const h = { ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  if (origin) h.Origin = origin;
  if (body !== undefined || raw !== undefined) h['Content-Type'] = 'application/json';
  const res = await handle(new Request('https://api.test' + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) }), env, f || rubikaFetch());
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
}
async function authed() {
  const env = baseEnv(); calls = [];
  const r = await call(env, 'POST', '/api/auth/login', { body: { password: env.ADMIN_PASSWORD } });
  return { env, token: r.json.data.token };
}
async function withGroup(f) {
  const s = await authed();
  await call(s.env, 'POST', '/api/bot/connect', { token: s.token, body: { token: TOKEN }, f });
  const r = await call(s.env, 'POST', '/api/groups', { token: s.token, body: { chat_id: 'g0A' }, f });
  assert.equal(r.status, 201);
  return s;
}

test('health is public and reports configuration without secrets', async () => {
  const env = baseEnv();
  const r = await call(env, 'GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.database, true);
  assert.equal(r.json.data.configured.admin_password, true);
  assert.ok(!JSON.stringify(r.json).includes(env.ADMIN_PASSWORD));
});
test('missing configuration is reported, not hidden', async () => {
  const env = { DB: makeDB() };
  assert.equal((await call(env, 'GET', '/api/health')).json.data.configured.session_secret, false);
  assert.equal((await call(env, 'POST', '/api/auth/login', { body: { password: 'whatever-long-pw' } })).status, 503);
  assert.equal((await call(env, 'GET', '/api/summary', { token: 'x.y' })).status, 503);
  assert.equal((await call({}, 'GET', '/api/summary')).status, 503); // no DB binding
});
test('protected routes reject missing, malformed and forged tokens', async () => {
  const { env, token } = await authed();
  for (const t of [undefined, 'garbage', token.slice(0, -2) + 'xx', 'a.b']) assert.equal((await call(env, 'GET', '/api/summary', { token: t })).status, 401);
  assert.equal((await call(env, 'GET', '/api/summary', { token })).status, 200);
});
test('login: wrong password 401, rate limited after 5 attempts', async () => {
  const env = baseEnv();
  for (let i = 0; i < 5; i++) assert.equal((await call(env, 'POST', '/api/auth/login', { body: { password: 'wrong-wrong-wrong' } })).status, 401);
  const r = await call(env, 'POST', '/api/auth/login', { body: { password: env.ADMIN_PASSWORD } });
  assert.equal(r.status, 429);
  assert.ok(r.headers.get('Retry-After'));
});
test('logout-all invalidates existing sessions', async () => {
  const { env, token } = await authed();
  assert.equal((await call(env, 'POST', '/api/auth/logout-all', { token })).status, 200);
  assert.equal((await call(env, 'GET', '/api/summary', { token })).status, 401);
});
test('CORS: allowed origin echoed, others rejected, wildcard ignored', async () => {
  const env = baseEnv();
  const ok = await call(env, 'GET', '/api/health', { origin: ORIGIN });
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal((await call(env, 'GET', '/api/health', { origin: 'https://evil.example' })).status, 403);
  const pre = await call(env, 'OPTIONS', '/api/summary', { origin: ORIGIN });
  assert.equal(pre.status, 204);
  assert.equal((await call(env, 'OPTIONS', '/api/summary', { origin: 'https://evil.example' })).status, 403);
  const wild = { ...env, ALLOWED_ORIGINS: '*' };
  assert.equal((await call(wild, 'GET', '/api/health', { origin: 'https://evil.example' })).status, 403);
  assert.equal(wild.ALLOWED_ORIGINS === '*' && (await call(wild, 'GET', '/api/health', { origin: ORIGIN })).status, 403);
});
test('invalid JSON, wrong shape, empty and oversized bodies', async () => {
  const { env, token } = await authed();
  assert.equal((await call(env, 'POST', '/api/bot/connect', { token, raw: '{bad' })).json.error.code, 'invalid_json');
  assert.equal((await call(env, 'POST', '/api/bot/connect', { token, raw: '[1]' })).json.error.code, 'invalid_body');
  assert.equal((await call(env, 'POST', '/api/bot/connect', { token, raw: '' })).json.error.code, 'empty_body');
  const big = await call(env, 'POST', '/api/bot/connect', { token, raw: JSON.stringify({ token: 'a'.repeat(70000) }) });
  assert.equal(big.status, 413);
});
test('unknown route 404, wrong method 405, errors never leak stack', async () => {
  const { env, token } = await authed();
  assert.equal((await call(env, 'GET', '/api/nope', { token })).status, 404);
  assert.equal((await call(env, 'DELETE', '/api/summary', { token })).status, 405);
  const bad = await call({ ...env, DB: { prepare() { throw new Error('boom /secret/path'); } } }, 'GET', '/api/health');
  assert.equal(bad.json.data.status, 'degraded');
  const r = await call({ ...env, DB: { prepare() { throw new Error('boom /secret/path'); } } }, 'POST', '/api/auth/login', { body: { password: env.ADMIN_PASSWORD } });
  assert.equal(r.status, 500);
  assert.ok(!JSON.stringify(r.json).includes('boom'));
});
test('bot starts disconnected and groups explain why they are empty', async () => {
  const { env, token } = await authed();
  assert.equal((await call(env, 'GET', '/api/bot', { token })).json.data.status, 'disconnected');
  const g = await call(env, 'GET', '/api/groups', { token });
  assert.deepEqual(g.json.data.groups, []);
  assert.match(g.json.data.message, /not connected/i);
  assert.equal((await call(env, 'POST', '/api/groups', { token, body: { chat_id: 'g0A' } })).json.error.code, 'bot_not_connected');
  const s = (await call(env, 'GET', '/api/summary', { token })).json.data;
  assert.equal(s.messages_checked, null);
  assert.equal(s.capabilities.ban_member.available, false);
});
test('bot connect: validates, stores token encrypted only, never returns it', async () => {
  const { env, token } = await authed();
  assert.equal((await call(env, 'POST', '/api/bot/connect', { token, body: { token: 'short' } })).status, 400);
  assert.equal((await call(env, 'POST', '/api/bot/connect', { token, body: { token: 'has spaces and !!! chars ok' } })).status, 400);
  const bad = await call(env, 'POST', '/api/bot/connect', { token, body: { token: TOKEN }, f: rubikaFetch({ getMe: 'fail' }) });
  assert.equal(bad.status, 422);
  assert.equal((await call(env, 'GET', '/api/bot', { token })).json.data.status, 'error');
  const good = await call(env, 'POST', '/api/bot/connect', { token, body: { token: TOKEN } });
  assert.equal(good.status, 200);
  assert.equal(good.json.data.status, 'connected');
  assert.equal(good.json.data.bot.username, 'test_bot');
  assert.ok(!JSON.stringify(good.json).includes(TOKEN));
  const row = env.DB.raw.prepare('SELECT * FROM bot_connections').get();
  assert.ok(row.token_enc && !row.token_enc.includes(TOKEN));
  const everything = JSON.stringify(env.DB.raw.prepare('SELECT * FROM audit_logs').all());
  assert.ok(!everything.includes(TOKEN));
  const disc = await call(env, 'POST', '/api/bot/disconnect', { token });
  assert.equal(disc.json.data.status, 'disconnected');
  assert.equal(env.DB.raw.prepare('SELECT token_enc FROM bot_connections').get().token_enc, null);
});
test('bot connect refuses to store a token when encryption key is missing', async () => {
  const { env, token } = await authed();
  delete env.TOKEN_ENC_KEY;
  assert.equal((await call(env, 'POST', '/api/bot/connect', { token, body: { token: TOKEN } })).status, 503);
});
test('RUBIKA_BOT_TOKEN secret is used without storing it in D1', async () => {
  const { env, token } = await authed();
  env.RUBIKA_BOT_TOKEN = TOKEN;
  const r = await call(env, 'POST', '/api/bot/connect', { token, body: { token: TOKEN } });
  assert.equal(r.json.data.source, 'secret');
  assert.equal(env.DB.raw.prepare('SELECT token_enc FROM bot_connections').get().token_enc, null);
});
test('rubika calls use the documented endpoint and token never appears in errors', async () => {
  const s = await withGroup();
  assert.ok(calls.every((c) => c.url.startsWith('https://botapi.rubika.ir/v3/' + TOKEN + '/')));
  assert.deepEqual([...new Set(calls.map((c) => c.url.split('/').pop()))].sort(), ['getChat', 'getMe']);
  const r = await call(s.env, 'POST', '/api/groups', { token: s.token, body: { chat_id: 'g0B' }, f: rubikaFetch({ getChat: 'fail' }) });
  assert.equal(r.status, 422);
  assert.ok(!JSON.stringify(r.json).includes(TOKEN));
});
test('group add validates ids, rejects duplicates, creates default settings', async () => {
  const s = await withGroup();
  for (const bad of ['', 'a b', '../x', 'x'.repeat(129), 5, null]) assert.equal((await call(s.env, 'POST', '/api/groups', { token: s.token, body: { chat_id: bad } })).status, 400);
  assert.equal((await call(s.env, 'POST', '/api/groups', { token: s.token, body: { chat_id: 'g0A' } })).status, 409);
  const list = (await call(s.env, 'GET', '/api/groups', { token: s.token })).json.data.groups;
  assert.equal(list.length, 1); assert.equal(list[0].title, "گروه تست");
  const st = (await call(s.env, 'GET', '/api/groups/g0A/settings', { token: s.token })).json.data;
  assert.equal(st.group.warn_threshold, 3);
  assert.equal(st.group.warn_action, 'review');
  assert.equal(st.rules.admin_protection.enabled, true);
  assert.equal(st.rules.anti_link.enabled, false);
  assert.equal((await call(s.env, 'GET', '/api/groups/unknown/settings', { token: s.token })).status, 404);
  assert.equal((await call(s.env, 'GET', '/api/groups/' + encodeURIComponent('a b') + '/settings', { token: s.token })).status, 400);
});
test('settings PUT validates and persists, and is audited', async () => {
  const s = await withGroup();
  const put = (body) => call(s.env, 'PUT', '/api/groups/g0A/settings', { token: s.token, body });
  assert.equal((await put({})).status, 400);
  assert.equal((await put({ bogus: 1 })).status, 400);
  assert.equal((await put({ group: { warn_threshold: 0 } })).status, 400);
  assert.equal((await put({ group: { warn_action: 'nuke' } })).status, 400);
  assert.equal((await put({ group: { lock_links: 'yes' } })).status, 400);
  assert.equal((await put({ rules: { nope: { enabled: true } } })).status, 400);
  assert.equal((await put({ rules: { anti_link: { params: { action: 'ban' } } } })).status, 400);
  const r = await put({ group: { warn_threshold: 5, rules_text: 'احترام' }, welcome: { welcome_enabled: true }, rules: { anti_link: { enabled: true, params: { allowed_domains: ['ok.org'] } } } });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.group.warn_threshold, 5);
  assert.equal(r.json.data.rules.anti_link.enabled, true);
  assert.deepEqual(r.json.data.rules.anti_link.params.allowed_domains, ['ok.org']);
  assert.equal((await call(s.env, 'GET', '/api/groups/g0A/settings', { token: s.token })).json.data.welcome.welcome_enabled, true);
  const logs = (await call(s.env, 'GET', '/api/audit-logs', { token: s.token })).json.data.logs;
  assert.ok(logs.some((l) => l.action === 'settings.update'));
});
test('moderation dry-run flags per enabled rules and sends/deletes nothing', async () => {
  const s = await withGroup();
  await call(s.env, 'PUT', '/api/groups/g0A/settings', { token: s.token, body: { rules: { anti_link: { enabled: true } } } });
  const before = calls.length;
  const r = await call(s.env, 'POST', '/api/groups/g0A/moderation/test', { token: s.token, body: { text: 'visit https://x.com' } });
  assert.equal(r.json.data.violations[0].rule, 'anti_link');
  assert.equal(r.json.data.dry_run, true);
  assert.equal(calls.length, before);
  await call(s.env, 'POST', '/api/groups/g0A/exemptions', { token: s.token, body: { user_id: 'u1' } });
  const ex = await call(s.env, 'POST', '/api/groups/g0A/moderation/test', { token: s.token, body: { text: 'https://x.com', user_id: 'u1' } });
  assert.equal(ex.json.data.exempt, true);
  assert.equal((await call(s.env, 'POST', '/api/groups/g0A/moderation/test', { token: s.token, body: { text: 5 } })).status, 400);
});
test('warnings: threshold escalation is reported honestly, ban is never simulated', async () => {
  const s = await withGroup();
  await call(s.env, 'PUT', '/api/groups/g0A/settings', { token: s.token, body: { group: { warn_threshold: 2, warn_action: 'temp_ban' } } });
  const w = (u) => call(s.env, 'POST', '/api/groups/g0A/warnings', { token: s.token, body: { user_id: u, reason: 'spam' } });
  const a = await w('u1'); assert.equal(a.status, 201); assert.equal(a.json.data.escalation.triggered, false);
  const b = await w('u1');
  assert.equal(b.json.data.active_warnings, 2);
  assert.equal(b.json.data.escalation.triggered, true);
  assert.equal(b.json.data.escalation.executed, false);
  assert.equal(b.json.data.escalation.supported, false);
  assert.match(b.json.data.escalation.message, /cannot be executed/);
  const id = a.json.data.id;
  assert.equal((await call(s.env, 'DELETE', `/api/groups/g0A/warnings/${id}`, { token: s.token })).status, 200);
  assert.equal((await call(s.env, 'DELETE', `/api/groups/g0A/warnings/${id}`, { token: s.token })).status, 404);
  assert.equal((await call(s.env, 'DELETE', '/api/groups/g0A/warnings/abc', { token: s.token })).status, 400);
  assert.equal((await call(s.env, 'POST', '/api/groups/g0A/warnings', { token: s.token, body: {} })).status, 400);
  const n = await call(s.env, 'POST', '/api/groups/g0A/warnings', { token: s.token, body: { user_id: 'u9', notify: true } });
  assert.equal(n.json.data.notified, true);
  assert.equal(calls.at(-1).url.split('/').pop(), 'sendMessage');
});
test('exempt users cannot be warned; exemptions list/remove', async () => {
  const s = await withGroup();
  await call(s.env, 'POST', '/api/groups/g0A/exemptions', { token: s.token, body: { user_id: 'adm', kind: 'admin' } });
  assert.equal((await call(s.env, 'POST', '/api/groups/g0A/warnings', { token: s.token, body: { user_id: 'adm' } })).status, 409);
  assert.equal((await call(s.env, 'POST', '/api/groups/g0A/exemptions', { token: s.token, body: { user_id: 'x', kind: 'god' } })).status, 400);
  assert.equal((await call(s.env, 'GET', '/api/groups/g0A/exemptions', { token: s.token })).json.data.exemptions.length, 1);
  assert.equal((await call(s.env, 'DELETE', '/api/groups/g0A/exemptions/adm', { token: s.token })).status, 200);
  assert.equal((await call(s.env, 'DELETE', '/api/groups/g0A/exemptions/adm', { token: s.token })).status, 404);
});
test('ban / unban / mute answer 501 feature_unavailable', async () => {
  const s = await withGroup();
  for (const a of ['ban', 'unban', 'mute']) {
    const r = await call(s.env, 'POST', `/api/groups/g0A/members/u1/${a}`, { token: s.token, body: {} });
    assert.equal(r.status, 501); assert.equal(r.json.error.code, 'feature_unavailable');
  }
  assert.equal((await call(s.env, 'POST', '/api/groups/g0A/members/u1/ban')).status, 401);
});
test('delete message requires confirmation and calls the documented method', async () => {
  const s = await withGroup();
  const p = '/api/groups/g0A/messages/delete';
  assert.equal((await call(s.env, 'POST', p, { token: s.token, body: { message_id: 'm1' } })).json.error.code, 'confirmation_required');
  assert.equal((await call(s.env, 'POST', p, { token: s.token, body: { message_id: 'm1', confirm: true }, f: rubikaFetch({ deleteMessage: 'fail' }) })).status, 422);
  const ok = await call(s.env, 'POST', p, { token: s.token, body: { message_id: 'm1', confirm: true } });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls.at(-1).body, { chat_id: 'g0A', message_id: 'm1' });
  const a = (await call(s.env, 'GET', '/api/analytics?days=7', { token: s.token })).json.data.series;
  assert.ok(a.some((x) => x.metric === 'messages_deleted' && x.value === 1));
});
test('welcome test message uses saved template via sendMessage', async () => {
  const s = await withGroup();
  const r = await call(s.env, 'POST', '/api/groups/g0A/welcome/test', { token: s.token, body: { kind: 'welcome' } });
  assert.equal(r.status, 200);
  assert.match(r.json.data.preview, /گروه تست/);
});
test('reports lifecycle and violations history', async () => {
  const s = await withGroup();
  const c = await call(s.env, 'POST', '/api/groups/g0A/reports', { token: s.token, body: { reported_user_id: 'u2', reason: 'ads' } });
  assert.equal(c.status, 201);
  assert.equal((await call(s.env, 'PATCH', `/api/groups/g0A/reports/${c.json.data.id}`, { token: s.token, body: { status: 'bad' } })).status, 400);
  assert.equal((await call(s.env, 'PATCH', `/api/groups/g0A/reports/${c.json.data.id}`, { token: s.token, body: { status: 'resolved' } })).status, 200);
  assert.equal((await call(s.env, 'GET', '/api/groups/g0A/reports?status=open', { token: s.token })).json.data.reports.length, 0);
  assert.equal((await call(s.env, 'GET', '/api/groups/g0A/reports?status=zzz', { token: s.token })).status, 400);
  assert.equal((await call(s.env, 'POST', '/api/groups/g0A/violations', { token: s.token, body: { user_id: 'u2', rule_key: 'bad' } })).status, 400);
  assert.equal((await call(s.env, 'POST', '/api/groups/g0A/violations', { token: s.token, body: { user_id: 'u2', rule_key: 'anti_link', excerpt: 'x' } })).status, 201);
  assert.equal((await call(s.env, 'GET', '/api/groups/g0A/violations', { token: s.token })).json.data.violations.length, 1);
  assert.equal((await call(s.env, 'GET', '/api/summary', { token: s.token })).json.data.violations_30d, 1);
});
test('removing a group cascades its data', async () => {
  const s = await withGroup();
  await call(s.env, 'POST', '/api/groups/g0A/warnings', { token: s.token, body: { user_id: 'u1' } });
  assert.equal((await call(s.env, 'DELETE', '/api/groups/g0A', { token: s.token })).status, 200);
  for (const t of ['warnings', 'group_settings', 'welcome_settings']) assert.equal(s.env.DB.raw.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c, 0);
});
test('analytics and audit pagination validate parameters', async () => {
  const { env, token } = await authed();
  for (const q of ['days=0', 'days=abc', 'days=999']) assert.equal((await call(env, 'GET', '/api/analytics?' + q, { token })).status, 400);
  for (const q of ['limit=0', 'limit=500', 'before=x']) assert.equal((await call(env, 'GET', '/api/audit-logs?' + q, { token })).status, 400);
  assert.equal((await call(env, 'GET', '/api/audit-logs?limit=1', { token })).json.data.logs.length, 1);
});
test('SQL schema enforces constraints at the database level', async () => {
  const { raw } = makeDB();
  assert.throws(() => raw.prepare("INSERT INTO groups (chat_id, status) VALUES ('x','weird')").run());
  assert.throws(() => raw.prepare("INSERT INTO warnings (group_id, user_id) VALUES ('missing','u')").run()); // FK
  assert.throws(() => raw.prepare("INSERT INTO bot_connections (id) VALUES (2)").run());
});
test('malformed percent-encoding in the path is a 400, not a 500', async () => {
  const { env, token } = await authed();
  assert.equal((await call(env, 'GET', '/api/groups/%E0%A4%A/settings', { token })).status, 400);
});
