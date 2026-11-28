// Repository-wide security guards: secrets, unsafe DOM/JS patterns, CSP, CORS, storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
function walk(dir, out = []) {
  for (const f of readdirSync(path.join(ROOT, dir))) {
    if (['node_modules', '.git', '.wrangler', '_site'].includes(f)) continue;
    const rel = path.join(dir, f);
    statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel, out) : out.push(rel);
  }
  return out;
}
const all = walk('.');
const frontend = all.filter((f) => /^assets\/.*\.js$/.test(f));
const worker = all.filter((f) => /^worker\/src\/.*\.js$/.test(f));

test('no hard-coded credentials anywhere in the repository', () => {
  const re = /(?:token|secret|password|api[_-]?key|passwd)["']?\s*[:=]\s*["'][A-Za-z0-9_\-+/=]{20,}["']/i;
  for (const f of all.filter((x) => /\.(js|mjs|html|toml|yml|yaml|json|md|sql)$/.test(x) && !x.startsWith('tests/') && !x.startsWith('scripts/e2e'))) {
    assert.ok(!re.test(read(f)), `possible credential in ${f}`);
  }
});

test('frontend never uses innerHTML, eval, Function() or document.write', () => {
  for (const f of [...frontend, 'index.html']) {
    const s = read(f).replace(/\/\/.*$/gm, '');
    for (const bad of [/\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new\s+Function\s*\(/]) assert.ok(!bad.test(s), `${f} matches ${bad}`);
  }
});

test('frontend never talks to Rubika directly and has no token constants', () => {
  for (const f of frontend.filter((x) => x !== 'assets/i18n.js')) { // i18n.js only holds help text naming the secrets
    const s = read(f);
    assert.ok(!/botapi\.rubika\.ir/.test(s), `${f} calls Rubika directly`);
    assert.ok(!/RUBIKA_BOT_TOKEN|ADMIN_PASSWORD|SESSION_SECRET|TOKEN_ENC_KEY/.test(s), `${f} mentions a server secret`);
  }
});

test('browser storage holds only preferences and the session (never the bot token)', () => {
  const core = read('assets/core.js');
  const keys = [...core.matchAll(/(?:ls|ss)\.(?:get|set)\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(keys)].sort(), ['hirad_lang', 'hirad_session', 'hirad_theme']);
  for (const f of frontend) assert.ok(!/(?:localStorage|sessionStorage)\.setItem\(\s*['"][^'"]*token/i.test(read(f)), `${f} stores a token`);
});

test('config.js is public and contains only API_BASE_URL', () => {
  const s = read('assets/config.js');
  const body = s.replace(/\/\/.*$/gm, '');
  assert.deepEqual([...body.matchAll(/^\s*([A-Z_]+)\s*:/gm)].map((m) => m[1]), ['API_BASE_URL']);
});

test('CSP forbids inline script/eval and restricts framing/forms', () => {
  const html = read('index.html');
  const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
  assert.ok(csp, 'CSP meta tag missing');
  assert.ok(!/unsafe-eval/.test(csp) && !/unsafe-inline/.test(csp), csp);
  assert.match(csp, /script-src 'self'(?:;|$)/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
});

test('wrangler config has no secrets and no wildcard CORS origin', () => {
  const w = read('worker/wrangler.toml');
  assert.ok(!/ADMIN_PASSWORD\s*=|SESSION_SECRET\s*=|TOKEN_ENC_KEY\s*=|RUBIKA_BOT_TOKEN\s*=/.test(w.replace(/^#.*$/gm, '')));
  const origins = /ALLOWED_ORIGINS\s*=\s*"([^"]*)"/.exec(w)?.[1] ?? '';
  assert.ok(origins && !origins.includes('*'), 'ALLOWED_ORIGINS must be explicit');
  for (const o of origins.split(',')) assert.match(o.trim(), /^https:\/\/[a-z0-9.-]+$/i, 'origin must be https, no path');
});

test('worker code never logs request bodies, tokens or stacks', () => {
  for (const f of worker) {
    const s = read(f);
    assert.ok(!/console\.log\(/.test(s), `${f} uses console.log`);
    assert.ok(!/\.stack\b/.test(s), `${f} touches error stacks`);
    for (const m of s.matchAll(/console\.error\(([^)]*)\)/g)) assert.ok(/redact\(/.test(m[1]), `${f}: console.error without redact: ${m[0]}`);
  }
});

test('GitHub workflows only reference secrets via the secrets context', () => {
  for (const f of all.filter((x) => x.startsWith('.github/workflows/'))) {
    const s = read(f);
    assert.ok(!/CLOUDFLARE_API_TOKEN\s*:\s*[^$\s'"]/.test(s), `${f} hard-codes a Cloudflare token`);
    assert.ok(!/permissions:\s*write-all/.test(s), `${f} grants write-all`);
  }
});

test('legacy auto-generating workflow and FastAPI backend are gone', () => {
  assert.ok(!all.includes('.github/workflows/create-project-files.yml'));
  assert.ok(!all.some((f) => f.startsWith('backend/')));
});

test('calculator copy used by the bot panel is the single implementation', () => {
  assert.ok(read('assets/lib.js').includes('recursive-descent parser, never uses eval/Function'));
});

test('write-config produces a valid public config and rejects unsafe URLs', async () => {
  const { configSource } = await import('../scripts/write-config.mjs');
  const src = configSource('https://hirad.example.workers.dev/');
  assert.match(src, /API_BASE_URL: "https:\/\/hirad\.example\.workers\.dev"/);
  for (const bad of ['http://x.dev', 'javascript:alert(1)', 'https://x.dev/path', 'https://x.dev"};alert(1);//', '']) assert.throws(() => configSource(bad), bad);
  const ctx = { window: {} }; new Function('window', src)(ctx.window); // evaluates cleanly in a sandboxed function
  assert.equal(ctx.window.HIRAD_CONFIG.API_BASE_URL, 'https://hirad.example.workers.dev');
});
