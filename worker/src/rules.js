// Deterministic moderation rules (regular expressions + counters). This is NOT generative AI.
// Pure functions: no I/O, fully unit-testable.

export const RULE_KEYS = ['anti_spam','anti_flood','anti_link','anti_ads','profanity','anti_repeat','anti_mention','anti_emoji','join_flood','scam_patterns','long_message','admin_protection'];

const ACTIONS = ['log', 'delete', 'warn', 'delete_warn'];

// Parameter definitions: type + bounds + default. Unknown params are rejected.
export const RULE_DEFS = {
  anti_spam: { stateless: true, params: { max_char_run: [int, 3, 200, 12], max_lines: [int, 2, 200, 15], action: [act, 'delete_warn'] } },
  anti_flood: { stateless: false, params: { max_messages: [int, 2, 100, 6], window_seconds: [int, 2, 600, 10], action: [act, 'warn'] } },
  anti_link: { stateless: true, params: { allowed_domains: [list, 50, 100], action: [act, 'delete_warn'] } },
  anti_ads: { stateless: true, params: { extra_phrases: [list, 100, 100], action: [act, 'delete_warn'] } },
  profanity: { stateless: true, params: { extra_words: [list, 200, 50], action: [act, 'delete_warn'] } },
  anti_repeat: { stateless: false, params: { max_repeats: [int, 2, 50, 3], window_seconds: [int, 5, 3600, 120], action: [act, 'delete_warn'] } },
  anti_mention: { stateless: true, params: { max_mentions: [int, 1, 50, 5], action: [act, 'delete_warn'] } },
  anti_emoji: { stateless: true, params: { max_emojis: [int, 1, 200, 15], action: [act, 'delete_warn'] } },
  join_flood: { stateless: false, params: { max_joins: [int, 2, 200, 10], window_seconds: [int, 5, 3600, 60], action: [act, 'log'] } },
  scam_patterns: { stateless: true, params: { extra_patterns: [list, 50, 100], action: [act, 'delete_warn'] } },
  long_message: { stateless: true, params: { max_length: [int, 50, 20000, 1500], action: [act, 'delete'] } },
  admin_protection: { stateless: true, params: {} },
};
function int(v, min, max) { return Number.isInteger(v) && v >= min && v <= max; }
function act(v) { return ACTIONS.includes(v); }
function list(v, maxItems, maxLen) { return Array.isArray(v) && v.length <= maxItems && v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= maxLen); }

export function defaultParams(key) {
  const out = {};
  for (const [name, def] of Object.entries(RULE_DEFS[key].params)) {
    if (def[0] === int) out[name] = def[3];
    else if (def[0] === act) out[name] = def[1];
    else out[name] = [];
  }
  return out;
}
export function defaultEnabled(key) { return key === 'admin_protection'; }

// Returns { ok:true, params } or { ok:false, error }.
export function validateParams(key, input) {
  const def = RULE_DEFS[key];
  if (!def) return { ok: false, error: 'unknown rule' };
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'params must be an object' };
  const params = defaultParams(key);
  for (const [name, value] of Object.entries(input)) {
    const d = def.params[name];
    if (!d) return { ok: false, error: `unknown parameter ${name}` };
    let valid;
    if (d[0] === int) valid = int(value, d[1], d[2]);
    else if (d[0] === act) valid = act(value);
    else valid = list(value, d[1], d[2]);
    if (!valid) return { ok: false, error: `invalid value for ${name}` };
    params[name] = value;
  }
  return { ok: true, params };
}

// ---------- text normalisation ----------
const DIGITS_FA = '۰۱۲۳۴۵۶۷۸۹', DIGITS_AR = '٠١٢٣٤٥٦٧٨٩';
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[ً-ٰٟـ‌‍‎‏]/g, (c) => (c === '‌' ? ' ' : ''))
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/ۀ/g, 'ه').replace(/ة/g, 'ه')
    .replace(/[۰-۹]/g, (d) => String(DIGITS_FA.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(DIGITS_AR.indexOf(d)))
    .toLowerCase();
}

const URL_RE = /(?:https?:\/\/|www\.)[^\s]+|(?:^|[\s(])(?:[a-z0-9-]+\.)+(?:com|ir|org|net|me|io|app|xyz|info|biz|co|cc|ly|link|site|online|top|club|shop|store|live|tv|ru|tk)(?:\/[^\s]*)?(?=$|[\s),.!؟])/gi;
const RUBIKA_JOIN_RE = /rubika\.ir\/(?:joing|joinc|join)[^\s]*/i;
const MENTION_RE = /@[a-z0-9_]{3,}/gi;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const WORD = (w) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(normalize(w))}(?![\\p{L}\\p{N}])`, 'u');
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const PROFANITY_DEFAULT = ['کیر', 'کسکش', 'جنده', 'کونی', 'گایید', 'مادرجنده', 'fuck', 'shit', 'bitch', 'asshole'];
const AD_PHRASES = ['تبلیغات', 'کانال ما', 'عضو شوید', 'عضو شو', 'جوین شوید', 'جوین بشید', 'join our channel', 'join my channel', 'سفارش بدهید', 'فروش ویژه', 'تخفیف ویژه', 'پیج ما'];
const SCAM_PATTERNS = [
  /کسب\s*درآمد\s*(?:روزانه|میلیونی|آسان|اینترنتی)/,
  /سرمایه\s*گذاری\s*(?:تضمینی|بدون ریسک)/,
  /(?:واریز|برداشت)\s*فوری/,
  /سود\s*(?:تضمین|روزانه)\s*\S*\s*(?:درصد|%)/,
  /جایزه\s*(?:ویژه)?\s*(?:برنده|بردی)/,
  /(?:free|easy)\s+(?:money|crypto|bitcoin)/,
  /double\s+your\s+(?:money|bitcoin|crypto)/,
  /claim\s+your\s+(?:prize|reward|airdrop)/,
  /guaranteed\s+(?:profit|returns?)/,
  /send\s+(?:usdt|btc|eth)\s+to/,
];

export function containsLink(norm, allowed = []) {
  const allow = allowed.map((d) => normalize(d));
  const found = [];
  for (const m of norm.matchAll(URL_RE)) found.push(m[0].trim());
  const rj = norm.match(RUBIKA_JOIN_RE);
  if (rj) found.push(rj[0]);
  return found.filter((u) => !allow.some((d) => u.includes(d)));
}

// ---------- evaluation ----------
// ctx: { text, recent?: [{text, ts}], now?: ms, isAdmin?: bool, exempt?: bool, userJoinEvents?: [ts] }
// rules: { [key]: { enabled, params } }
// Returns { exempt, violations: [{rule, reason, action, excerpt}] }
export function evaluateMessage(ctx, rules) {
  const text = String(ctx.text ?? '');
  const norm = normalize(text);
  const now = ctx.now ?? Date.now();
  const on = (k) => rules[k] && rules[k].enabled;
  const p = (k) => ({ ...defaultParams(k), ...(rules[k]?.params || {}) });
  const out = [];
  const add = (rule, reason, action) => out.push({ rule, reason, action, excerpt: text.slice(0, 120) });

  if (ctx.exempt) return { exempt: true, reason: 'user_exempt', violations: [] };
  if (ctx.isAdmin && on('admin_protection')) return { exempt: true, reason: 'admin_protection', violations: [] };

  if (on('long_message')) { const q = p('long_message'); if (text.length > q.max_length) add('long_message', `length ${text.length} > ${q.max_length}`, q.action); }
  if (on('anti_link')) { const q = p('anti_link'); const l = containsLink(norm, q.allowed_domains); if (l.length) add('anti_link', 'link detected', q.action); }
  if (on('anti_ads')) {
    const q = p('anti_ads');
    const hit = [...AD_PHRASES, ...q.extra_phrases].find((ph) => norm.includes(normalize(ph)));
    if (hit || RUBIKA_JOIN_RE.test(norm)) add('anti_ads', 'advertising phrase', q.action);
  }
  if (on('profanity')) {
    const q = p('profanity');
    if ([...PROFANITY_DEFAULT, ...q.extra_words].some((w) => WORD(w).test(norm))) add('profanity', 'profanity', q.action);
  }
  if (on('anti_mention')) { const q = p('anti_mention'); const n = (norm.match(MENTION_RE) || []).length; if (n > q.max_mentions) add('anti_mention', `${n} mentions`, q.action); }
  if (on('anti_emoji')) { const q = p('anti_emoji'); const n = (text.match(EMOJI_RE) || []).length; if (n > q.max_emojis) add('anti_emoji', `${n} emojis`, q.action); }
  if (on('scam_patterns')) {
    const q = p('scam_patterns');
    let hit = SCAM_PATTERNS.some((re) => re.test(norm));
    for (const pat of q.extra_patterns) if (!hit && norm.includes(normalize(pat))) hit = true;
    if (hit) add('scam_patterns', 'scam pattern', q.action);
  }
  if (on('anti_spam')) {
    const q = p('anti_spam');
    const run = new RegExp(`(.)\\1{${q.max_char_run},}`, 'su');
    if (run.test(text)) add('anti_spam', 'repeated characters', q.action);
    else if (text.split('\n').length > q.max_lines) add('anti_spam', 'too many lines', q.action);
  }
  const recent = Array.isArray(ctx.recent) ? ctx.recent : [];
  if (on('anti_flood') && recent.length) {
    const q = p('anti_flood');
    const n = recent.filter((r) => now - r.ts <= q.window_seconds * 1000).length + 1;
    if (n > q.max_messages) add('anti_flood', `${n} messages in ${q.window_seconds}s`, q.action);
  }
  if (on('anti_repeat') && recent.length) {
    const q = p('anti_repeat');
    const n = recent.filter((r) => now - r.ts <= q.window_seconds * 1000 && normalize(r.text) === norm).length + 1;
    if (n > q.max_repeats) add('anti_repeat', `same message ${n} times`, q.action);
  }
  return { exempt: false, violations: out };
}

// Join-flood is evaluated on join timestamps (ms), independent of message text.
export function evaluateJoinFlood(joinTimestamps, now, rule) {
  if (!rule || !rule.enabled) return null;
  const q = { ...defaultParams('join_flood'), ...(rule.params || {}) };
  const n = joinTimestamps.filter((t) => now - t <= q.window_seconds * 1000).length;
  return n > q.max_joins ? { rule: 'join_flood', reason: `${n} joins in ${q.window_seconds}s`, action: q.action } : null;
}

// Warning escalation. Never returns a permanent ban unless the admin explicitly configured it.
export function escalation(activeWarnings, settings) {
  if (settings.warn_action === 'none' || activeWarnings < settings.warn_threshold) return { triggered: false };
  return { triggered: true, action: settings.warn_action, duration_minutes: settings.warn_action === 'temp_ban' || settings.warn_action === 'mute' ? settings.action_duration_minutes : null };
}

export function renderTemplate(tpl, vars) {
  return String(tpl).replace(/\{(name|group)\}/g, (_, k) => String(vars[k] ?? '').slice(0, 100));
}
