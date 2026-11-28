import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMessage, normalize, validateParams, escalation, evaluateJoinFlood, renderTemplate, defaultParams } from '../worker/src/rules.js';

const on = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { enabled: true, params: v }]));
const hit = (text, rules, ctx = {}) => evaluateMessage({ text, ...ctx }, rules).violations.map((v) => v.rule);

test('nothing enabled means nothing flagged', () => assert.deepEqual(hit('http://spam.com fuck', {}), []));
test('anti_link catches urls, bare domains and rubika join links', () => {
  const r = on({ anti_link: {} });
  assert.deepEqual(hit('see https://evil.example/x', r), ['anti_link']);
  assert.deepEqual(hit('بیا سایت evil.com', r), ['anti_link']);
  assert.deepEqual(hit('rubika.ir/joing/ABC', r), ['anti_link']);
  assert.deepEqual(hit('سلام چطوری', r), []);
});
test('anti_link honours allowed domains', () => assert.deepEqual(hit('https://good.org/a', on({ anti_link: { allowed_domains: ['good.org'] } })), []));
test('profanity matches whole words only (Persian and English)', () => {
  const r = on({ profanity: {} });
  assert.deepEqual(hit('you shit', r), ['profanity']);
  assert.deepEqual(hit('کسی اینجاست؟', r), []);   // "کسی" must not match "کس"-like words
  assert.deepEqual(hit('classic shitake', r), []);
  assert.deepEqual(hit('hello', on({ profanity: { extra_words: ['hello'] } })), ['profanity']);
});
test('normalize maps Arabic letters/digits and strips tatweel', () => {
  assert.equal(normalize('ك١٢ـي'), 'ک12ی');
  assert.equal(normalize('۱۲۳'), '123');
});
test('anti_mention / anti_emoji / long_message thresholds', () => {
  assert.deepEqual(hit('@aaa @bbb @ccc', on({ anti_mention: { max_mentions: 2 } })), ['anti_mention']);
  assert.deepEqual(hit('@aaa @bbb', on({ anti_mention: { max_mentions: 2 } })), []);
  assert.deepEqual(hit('😀😀😀', on({ anti_emoji: { max_emojis: 2 } })), ['anti_emoji']);
  assert.deepEqual(hit('x'.repeat(60), on({ long_message: { max_length: 50 } })), ['long_message']);
});
test('scam patterns and ads', () => {
  assert.deepEqual(hit('کسب درآمد روزانه بدون سرمایه', on({ scam_patterns: {} })), ['scam_patterns']);
  assert.deepEqual(hit('Double your bitcoin now', on({ scam_patterns: {} })), ['scam_patterns']);
  assert.deepEqual(hit('کانال ما رو ببینید', on({ anti_ads: {} })), ['anti_ads']);
});
test('anti_spam: char runs and many lines', () => {
  assert.deepEqual(hit('aaaaaaaaaaaaaaaa', on({ anti_spam: {} })), ['anti_spam']);
  assert.deepEqual(hit('a\n'.repeat(20), on({ anti_spam: {} })), ['anti_spam']);
});
test('flood and repeat use recent history', () => {
  const now = 1_000_000;
  const recent = Array.from({ length: 6 }, (_, i) => ({ text: 'same', ts: now - i * 1000 }));
  assert.deepEqual(hit('same', on({ anti_flood: { max_messages: 5, window_seconds: 10 } }), { recent, now }), ['anti_flood']);
  assert.deepEqual(hit('same', on({ anti_repeat: { max_repeats: 3 } }), { recent, now }), ['anti_repeat']);
  assert.deepEqual(hit('other', on({ anti_repeat: { max_repeats: 3 } }), { recent, now }), []);
  assert.deepEqual(hit('same', on({ anti_flood: { max_messages: 5, window_seconds: 2 } }), { recent, now }), []);
});
test('admins and exempt users are never flagged', () => {
  const r = { ...on({ anti_link: {} }), admin_protection: { enabled: true, params: {} } };
  assert.equal(evaluateMessage({ text: 'http://a.com', isAdmin: true }, r).exempt, true);
  assert.equal(evaluateMessage({ text: 'http://a.com', exempt: true }, on({ anti_link: {} })).violations.length, 0);
  assert.equal(evaluateMessage({ text: 'http://a.com', isAdmin: true }, on({ anti_link: {} })).violations.length, 1);
});
test('validateParams rejects bad input', () => {
  assert.equal(validateParams('anti_link', { action: 'ban' }).ok, false);
  assert.equal(validateParams('anti_mention', { max_mentions: 0 }).ok, false);
  assert.equal(validateParams('anti_mention', { nope: 1 }).ok, false);
  assert.equal(validateParams('anti_mention', []).ok, false);
  assert.equal(validateParams('anti_mention', { max_mentions: 3 }).ok, true);
  assert.equal(validateParams('x', {}).ok, false);
});
test('default actions never include permanent ban', () => {
  for (const k of ['anti_spam', 'anti_link', 'profanity', 'scam_patterns']) assert.ok(['log', 'delete', 'warn', 'delete_warn'].includes(defaultParams(k).action));
});
test('escalation uses threshold and does not trigger below it', () => {
  const s = { warn_threshold: 3, warn_action: 'temp_ban', action_duration_minutes: 30 };
  assert.equal(escalation(2, s).triggered, false);
  assert.deepEqual(escalation(3, s), { triggered: true, action: 'temp_ban', duration_minutes: 30 });
  assert.equal(escalation(9, { ...s, warn_action: 'none' }).triggered, false);
});
test('join flood', () => {
  const now = 100000, ts = Array.from({ length: 12 }, (_, i) => now - i * 100);
  assert.equal(evaluateJoinFlood(ts, now, { enabled: true, params: { max_joins: 10, window_seconds: 60 } }).rule, 'join_flood');
  assert.equal(evaluateJoinFlood(ts, now, { enabled: false }), null);
});
test('renderTemplate only substitutes known placeholders', () => assert.equal(renderTemplate('hi {name} {x} {group}', { name: 'A', group: 'G' }), 'hi A {x} G'));
