// Static validation: JS syntax, schema.sql == migrations, wrangler.toml sanity. Run: node scripts/check.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;
const fail = (m) => { console.error('FAIL ' + m); bad++; };
function walk(d, out = []) { for (const f of readdirSync(path.join(ROOT, d))) { if (['node_modules', '.git', '.wrangler', '_site'].includes(f)) continue; const r = path.join(d, f); statSync(path.join(ROOT, r)).isDirectory() ? walk(r, out) : out.push(r); } return out; }
const files = walk('.');

for (const f of files.filter((x) => /\.(js|mjs)$/.test(x))) {
  try { execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' }); } catch (e) { fail(`syntax error in ${f}\n${e.stderr}`); }
}
console.log(`syntax OK (${files.filter((x) => /\.(js|mjs)$/.test(x)).length} JS files)`);

const migrations = files.filter((f) => /^worker\/migrations\/\d+.*\.sql$/.test(f)).sort();
const merged = migrations.map((f) => readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const schema = readFileSync(path.join(ROOT, 'worker/schema.sql'), 'utf8');
if (merged.trim() !== schema.trim()) fail('worker/schema.sql is out of sync with worker/migrations (it must equal the concatenated migrations)');
try {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON;'); db.exec(merged);
  const fk = db.prepare('PRAGMA foreign_key_check').all(); if (fk.length) fail('foreign key violations');
  const n = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'").get().c;
  console.log(`D1 schema OK (${n} tables, applied from ${migrations.length} migration file(s))`);
} catch (e) { fail('SQL schema does not apply: ' + e.message); }

const toml = readFileSync(path.join(ROOT, 'worker/wrangler.toml'), 'utf8');
for (const k of ['name', 'main', 'compatibility_date', 'binding = "DB"', 'ALLOWED_ORIGINS']) if (!toml.includes(k)) fail('wrangler.toml missing ' + k);
console.log('wrangler.toml OK');
process.exit(bad ? 1 : 0);
