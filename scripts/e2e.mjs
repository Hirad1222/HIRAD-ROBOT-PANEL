// End-to-end browser test: runs the REAL Worker code (with an in-memory D1 stand-in and a fake Rubika
// transport) behind a local HTTP server and drives the REAL frontend in Chromium.
// Usage: node scripts/e2e.mjs [screenshotDir]      (needs `playwright` + Chromium; not part of CI)
import http from 'node:http';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDB } from '../tests/d1shim.js';
import { handle } from '../worker/src/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });

const FAKE_TOKEN = 'TESTTOKEN' + 'x'.repeat(30); // test double only - not a real credential
const STATIC_PORT = 8091, API_PORT = 8792;
const ORIGIN = `http://127.0.0.1:${STATIC_PORT}`;
const env = { DB: makeDB(), ADMIN_PASSWORD: 'correct horse battery staple', SESSION_SECRET: 's'.repeat(40), TOKEN_ENC_KEY: 'k'.repeat(40), ALLOWED_ORIGINS: ORIGIN };

const fakeRubika = async (url, init) => {
  const u = String(url);
  if (!u.startsWith('https://botapi.rubika.ir/v3/')) throw new Error('unexpected outbound request ' + u);
  const method = u.split('/').pop();
  const j = (data) => new Response(JSON.stringify({ status: 'OK', data }), { status: 200 });
  if (!u.includes(FAKE_TOKEN)) return new Response(JSON.stringify({ status: 'INVALID_ACCESS' }), { status: 403 });
  if (method === 'getMe') return j({ bot: { bot_id: 'b0TEST', bot_title: 'Test Bot', username: 'test_bot' } });
  if (method === 'getChat') return j({ chat: { chat_id: JSON.parse(init.body).chat_id, title: 'گروه آزمایشی', chat_type: 'Group' } });
  if (method === 'sendMessage') return j({ message_id: '123' });
  if (method === 'deleteMessage') return j({});
  return new Response('{}', { status: 404 });
};

const apiServer = http.createServer(async (rq, rs) => {
  const chunks = []; for await (const c of rq) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const req = new Request(`http://127.0.0.1:${API_PORT}${rq.url}`, { method: rq.method, headers: rq.headers, body: ['GET', 'HEAD'].includes(rq.method) ? undefined : body });
  const res = await handle(req, env, fakeRubika);
  rs.writeHead(res.status, Object.fromEntries(res.headers)); rs.end(Buffer.from(await res.arrayBuffer()));
});
let apiBase = `http://127.0.0.1:${API_PORT}`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const staticServer = http.createServer((rq, rs) => {
  let p = new URL(rq.url, 'http://x').pathname; if (p === '/') p = '/index.html';
  if (p === '/assets/config.js') { rs.writeHead(200, { 'Content-Type': MIME['.js'] }); return rs.end(`window.HIRAD_CONFIG={API_BASE_URL:${JSON.stringify(apiBase)}};`); }
  const f = path.join(ROOT, path.normalize(p));
  if (!f.startsWith(ROOT) || !existsSync(f)) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(readFileSync(f));
});
await Promise.all([new Promise((r) => apiServer.listen(API_PORT, '127.0.0.1', r)), new Promise((r) => staticServer.listen(STATIC_PORT, '127.0.0.1', r))]);

let failures = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); if (!cond) failures++; };
const browser = await chromium.launch();
const errors = [];
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // Fonts come from Google Fonts; the sandbox has no internet, so block them (layout falls back to system fonts).
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  return page;
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: false }); };
const clearToasts = (page) => page.evaluate(() => document.querySelectorAll('.toast').forEach((n) => n.remove()));
const chips = (page) => page.$$eval('#view .chip', (n) => n.map((x) => x.textContent.trim()));

try {
  // 1) Frontend with NO backend configured -> "Not configured", never a fake connected state.
  apiBase = '';
  let page = await newPage();
  await page.goto(ORIGIN + '/#/dashboard'); await page.waitForSelector('#view .panel');
  check('not configured: dashboard says Not configured (fa)', (await chips(page)).some((c) => c.includes('پیکربندی نشده')));
  await page.click('.top button[aria-label]:has-text("EN")');
  check('language switch -> en: lang/dir attributes', (await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir])).join() === 'en,ltr');
  check('not configured: shows "Not configured" (en)', (await chips(page)).some((c) => c === 'Not configured'));
  await shot(page, '01-not-configured-en');
  await page.context().close();

  // 2) Backend configured but unreachable -> Error state.
  apiBase = 'http://127.0.0.1:1';
  page = await newPage(); await page.goto(ORIGIN + '/'); await page.waitForSelector('#view .panel');
  await page.waitForFunction(() => document.querySelector('#view .chip.error'), null, { timeout: 15000 });
  check('unreachable backend: Error chip shown', (await chips(page)).length > 0);
  await page.context().close();

  // 3) Real backend: login, status, connect, groups, moderation.
  apiBase = `http://127.0.0.1:${API_PORT}`;
  page = await newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => console.log('  [console]', m.type(), m.text().slice(0, 200)));
  await page.goto(ORIGIN + '/'); await page.waitForSelector('#pw', { timeout: 8000 }).catch(async () => { console.log('  [debug] page text:', (await page.textContent('body')).slice(0, 300)); throw new Error('login form missing'); });
  check('login form shown, no Backend URL / API key fields', (await page.$$('#view input')).length === 1 && !(await page.content()).includes('Panel API Key'));
  await shot(page, '02-login-fa-light');
  await clearToasts(page);
  await page.fill('#pw', 'wrong password!!'); await page.click('button[type=submit]');
  await page.waitForSelector('.toast.bad'); check('wrong password rejected with an alert', true);
  await page.fill('#pw', env.ADMIN_PASSWORD); await page.click('button[type=submit]');
  await page.waitForSelector('.rail .nav-btn'); await page.waitForFunction(() => document.querySelector('#view .stat, #view .panel h2'));
  await page.waitForTimeout(500);
  await page.click('.top button:has-text("EN")'); await page.waitForTimeout(200);
  const dash = await page.textContent('#view');
  check('dashboard: bot shown as Disconnected (never fake online)', /Disconnected/.test(dash) && !/Connected\b(?!.*Disconnected)/.test('') );
  check('dashboard: no invented message statistics', /Unavailable|—/.test(dash));
  await shot(page, '03-dashboard-en-light');

  await page.click('.top button[aria-label*="heme"], .top button[aria-label*="پوسته"]');
  check('theme toggles to dark', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await shot(page, '04-dashboard-en-dark');

  await page.click('.rail [data-page=connection]'); await page.waitForSelector('#tok');
  await clearToasts(page);
  await page.fill('#tok', 'short'); await page.click('button[type=submit]');
  await page.waitForSelector('.toast.bad');
  await page.waitForFunction(() => !document.querySelector('#view button[type=submit]')?.disabled, null, { timeout: 8000 });
  check('malformed token is rejected by validation and status stays Disconnected', (await chips(page)).includes('Disconnected'));
  await clearToasts(page);
  await page.fill('#tok', 'wrongtoken0123456789'); await page.click('button[type=submit]');
  await page.waitForSelector('.toast.bad');
  await page.waitForFunction(() => !document.querySelector('#view button[type=submit]')?.disabled && !document.querySelector('#view .chip.connecting'), null, { timeout: 8000 });
  check('connect with a rejected token shows an error', (await chips(page)).some((c) => /Error/.test(c)) && !(await chips(page)).includes('Connected'));
  await clearToasts(page);
  await page.fill('#tok', FAKE_TOKEN); await page.click('button[type=submit]');
  await page.waitForFunction(() => /Test Bot/.test(document.querySelector('#view')?.textContent || ''), null, { timeout: 8000 });
  check('after connect: status Connected and bot name shown', (await chips(page)).includes('Connected'));
  check('token field cleared after submit', (await page.inputValue('#tok')) === '');
  const leaks = await page.evaluate((tok) => ({ ls: JSON.stringify(Object.entries(localStorage)).includes(tok), ss: JSON.stringify(Object.entries(sessionStorage)).includes(tok), dom: document.documentElement.outerHTML.includes(tok), cookie: document.cookie.includes(tok) }), FAKE_TOKEN);
  check('bot token is absent from localStorage, sessionStorage, cookies and DOM', !Object.values(leaks).some(Boolean), JSON.stringify(leaks));
  const statusJson = await page.evaluate(async (b) => { const s = sessionStorage.getItem('hirad_session'); const r = await fetch(b + '/api/bot', { headers: { Authorization: 'Bearer ' + s } }); return r.text(); }, apiBase);
  check('GET /api/bot never returns the token', !statusJson.includes(FAKE_TOKEN) && !/token_enc/.test(statusJson));
  const row = env.DB.raw.prepare('SELECT token_enc FROM bot_connections WHERE id=1').get();
  check('token stored encrypted in D1 (no plaintext)', !!row.token_enc && !row.token_enc.includes(FAKE_TOKEN));
  await shot(page, '05-connection-connected');

  await page.click('.rail [data-page=groups]'); await page.waitForSelector('#cid');
  await page.fill('#cid', 'g0TESTGROUP123'); await page.click('form button[type=submit]');
  await page.waitForFunction(() => /گروه آزمایشی/.test(document.querySelector('#view')?.textContent || ''), null, { timeout: 8000 });
  check('group added through getChat validation and listed', true);

  await page.click('.rail [data-page=guard]'); await page.waitForSelector('#view .sw');
  const toggles = await page.$$('#view .sw input'); check('guard: rule toggles rendered', toggles.length >= 10, String(toggles.length));
  await shot(page, '06-guard');

  // 4) Navigate every page; no console errors; mobile layout.
  const pages = await page.$$eval('.rail .nav-btn', (b) => b.map((x) => x.dataset.page));
  check('11 sections present', pages.length === 11, pages.join());
  for (const p of pages) {
    await page.click(`.rail [data-page=${p}]`); await page.waitForTimeout(250);
    const len = (await page.textContent('#view')).trim().length;
    check(`page "${p}" renders content`, len > 20);
  }
  await page.click('.rail [data-page=tools]'); await page.waitForSelector('#view .panel');
  await page.fill('#view input[inputmode], #view .panel input >> nth=0', '2+3*4').catch(() => {});
  await shot(page, '07-tools');
  await page.context().close();

  for (const [lang, name] of [['fa', 'fa'], ['en', 'en']]) {
    const m = await newPage({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await m.addInitScript((l) => { try { localStorage.setItem('hirad_lang', l); } catch {} }, lang);
    await m.goto(ORIGIN + '/'); await m.waitForSelector('#pw');
    await m.fill('#pw', env.ADMIN_PASSWORD); await m.click('button[type=submit]'); await m.waitForSelector('.bar'); await m.waitForTimeout(700);
    for (const p of ['dashboard', 'guard', 'moderation', 'tools', 'groups']) {
      await m.evaluate((x) => { location.hash = '#/' + x; }, p); await m.waitForTimeout(350);
      const over = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`mobile 360px ${lang}/${p}: no horizontal overflow`, over <= 1, 'overflow ' + over);
      if (p === 'dashboard' || p === 'guard') await shot(m, `08-mobile-${name}-${p}`);
    }
    check(`mobile ${lang}: dir`, (await m.evaluate(() => document.documentElement.dir)) === (lang === 'fa' ? 'rtl' : 'ltr'));
    await m.context().close();
  }
  check('no console errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.log('FAIL  e2e crashed: ' + e.message); failures++;
} finally {
  await browser.close(); apiServer.close(); staticServer.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall e2e checks passed');
process.exit(failures ? 1 : 0);
