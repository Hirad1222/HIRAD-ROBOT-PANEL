// HIRAD ROBOT PANEL - Cloudflare Worker entry point.
import { HttpError, json, corsHeaders, VERSION, redact, ok } from './util.js';
import * as h from './handlers.js';

const G = '([^/]+)';
// [method, path regex, handler(ctx) , auth]
const routes = [
  ['GET', /^\/api\/health$/, (c) => health(c), false],
  ['POST', /^\/api\/auth\/login$/, (c) => h.login(c.req, c.env, c), false],
  ['GET', /^\/api\/auth\/me$/, () => ok({ role: 'owner' }), true],
  ['POST', /^\/api\/auth\/logout-all$/, (c) => h.logoutAll(c.env, c), true],

  ['GET', /^\/api\/capabilities$/, () => ok(h.CAPABILITIES), true],
  ['GET', /^\/api\/summary$/, (c) => h.summary(c.env), true],
  ['GET', /^\/api\/analytics$/, (c) => h.analytics(c.env, c.url), true],
  ['GET', /^\/api\/audit-logs$/, (c) => h.auditLogs(c.env, c.url), true],

  ['GET', /^\/api\/bot$/, (c) => h.botStatus(c.env), true],
  ['POST', /^\/api\/bot\/connect$/, (c) => h.botConnect(c.req, c.env, c, c.fetch), true],
  ['POST', /^\/api\/bot\/disconnect$/, (c) => h.botDisconnect(c.env, c), true],
  ['POST', /^\/api\/bot\/check$/, (c) => h.botCheck(c.env, c, c.fetch), true],

  ['GET', /^\/api\/groups$/, (c) => h.listGroups(c.env), true],
  ['POST', /^\/api\/groups$/, (c) => h.addGroup(c.req, c.env, c, c.fetch), true],
  ['DELETE', new RegExp(`^/api/groups/${G}$`), (c, m) => h.removeGroup(c.env, c, m[1]), true],
  ['POST', new RegExp(`^/api/groups/${G}/refresh$`), (c, m) => h.refreshGroup(c.env, c, m[1], c.fetch), true],
  ['GET', new RegExp(`^/api/groups/${G}/settings$`), (c, m) => h.getSettings(c.env, m[1]), true],
  ['PUT', new RegExp(`^/api/groups/${G}/settings$`), (c, m) => h.putSettings(c.req, c.env, c, m[1]), true],

  ['POST', new RegExp(`^/api/groups/${G}/moderation/test$`), (c, m) => h.testMessage(c.req, c.env, m[1]), true],
  ['GET', new RegExp(`^/api/groups/${G}/warnings$`), (c, m) => h.listWarnings(c.env, m[1], c.url), true],
  ['POST', new RegExp(`^/api/groups/${G}/warnings$`), (c, m) => h.issueWarning(c.req, c.env, c, m[1], c.fetch), true],
  ['DELETE', new RegExp(`^/api/groups/${G}/warnings/${G}$`), (c, m) => h.revokeWarning(c.env, c, m[1], m[2]), true],
  ['GET', new RegExp(`^/api/groups/${G}/violations$`), (c, m) => h.listViolations(c.env, m[1]), true],
  ['POST', new RegExp(`^/api/groups/${G}/violations$`), (c, m) => h.recordViolation(c.req, c.env, c, m[1]), true],
  ['GET', new RegExp(`^/api/groups/${G}/exemptions$`), (c, m) => h.listExemptions(c.env, m[1]), true],
  ['POST', new RegExp(`^/api/groups/${G}/exemptions$`), (c, m) => h.addExemption(c.req, c.env, c, m[1]), true],
  ['DELETE', new RegExp(`^/api/groups/${G}/exemptions/${G}$`), (c, m) => h.removeExemption(c.env, c, m[1], m[2]), true],
  ['GET', new RegExp(`^/api/groups/${G}/reports$`), (c, m) => h.listReports(c.env, m[1], c.url), true],
  ['POST', new RegExp(`^/api/groups/${G}/reports$`), (c, m) => h.addReport(c.req, c.env, c, m[1]), true],
  ['PATCH', new RegExp(`^/api/groups/${G}/reports/${G}$`), (c, m) => h.updateReport(c.req, c.env, c, m[1], m[2]), true],
  ['POST', new RegExp(`^/api/groups/${G}/messages/delete$`), (c, m) => h.deleteGroupMessage(c.req, c.env, c, m[1], c.fetch), true],
  ['POST', new RegExp(`^/api/groups/${G}/welcome/test$`), (c, m) => h.testWelcome(c.req, c.env, c, m[1], c.fetch), true],

  // Explicitly unavailable: answered with 501, never simulated.
  ['POST', new RegExp(`^/api/groups/${G}/members/${G}/ban$`), () => h.unavailable('ban_member'), true],
  ['POST', new RegExp(`^/api/groups/${G}/members/${G}/unban$`), () => h.unavailable('ban_member'), true],
  ['POST', new RegExp(`^/api/groups/${G}/members/${G}/mute$`), () => h.unavailable('mute_member'), true],
];

async function health(c) {
  const env = c.env;
  let db = false;
  try { await env.DB.prepare('SELECT 1').first(); db = true; } catch { /* reported below */ }
  const longEnough = (v, n) => typeof v === 'string' && v.length >= n;
  return ok({
    status: db ? 'ok' : 'degraded', service: 'hirad-robot-panel', version: VERSION, database: db,
    configured: {
      admin_password: longEnough(env.ADMIN_PASSWORD, 12), session_secret: longEnough(env.SESSION_SECRET, 32),
      token_encryption: longEnough(env.TOKEN_ENC_KEY, 32), allowed_origins: !!env.ALLOWED_ORIGINS && env.ALLOWED_ORIGINS.split(',').some((s) => s.trim() && s.trim() !== '*'),
    },
  });
}

export async function handle(req, env, fetchImpl = fetch) {
  const url = new URL(req.url);
  const cors = corsHeaders(req, env);
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    if (req.method === 'OPTIONS') {
      if (!cors['Access-Control-Allow-Origin']) throw new HttpError(403, 'origin_not_allowed', 'Origin not allowed');
      return new Response(null, { status: 204, headers: cors });
    }
    const origin = req.headers.get('Origin');
    if (origin && !cors['Access-Control-Allow-Origin']) throw new HttpError(403, 'origin_not_allowed', 'Origin not allowed');
    let path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    if (path === '/') return json({ ok: true, data: { name: 'HIRAD ROBOT PANEL API', version: VERSION } }, 200, cors);
    let pathMatched = false;
    for (const [method, re, fn, needsAuth] of routes) {
      const m = path.match(re);
      if (!m) continue;
      pathMatched = true;
      if (method !== req.method) continue;
      const ctx = { req, env, url, ip, actor: 'anonymous', fetch: fetchImpl };
      if (!env.DB) throw new HttpError(503, 'not_configured', 'Database binding is missing');
      if (needsAuth) {
        const m2 = (req.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/i);
        const session = await h.verifySession(env, m2 ? m2[1] : '');
        ctx.actor = session.sub;
      }
      let args;
      try { args = m.map((x, i) => (i ? decodeURIComponent(x) : x)); } catch { throw new HttpError(400, 'invalid_path', 'Malformed URL path'); }
      const result = await fn(ctx, args);
      return json({ ok: true, data: result.data }, result.status, cors);
    }
    throw pathMatched ? new HttpError(405, 'method_not_allowed', 'Method not allowed') : new HttpError(404, 'not_found', 'Route not found');
  } catch (e) {
    if (e instanceof HttpError) {
      const retry = e.details?.retry_after ? { 'Retry-After': String(e.details.retry_after) } : {};
      return json({ ok: false, error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }, e.status, { ...cors, ...retry });
    }
    console.error('unhandled', redact(e?.message || e)); // never log stack or request bodies
    return json({ ok: false, error: { code: 'internal_error', message: 'Internal server error' } }, 500, cors);
  }
}

export default { fetch: (req, env) => handle(req, env) };
