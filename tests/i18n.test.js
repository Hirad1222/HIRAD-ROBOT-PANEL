import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DICT } from '../assets/i18n.js';

const src = readdirSync(new URL('../assets/', import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'i18n.js' && f !== 'config.js').map((f) => readFileSync(new URL('../assets/' + f, import.meta.url), 'utf8')).join('\n');

test('fa and en define the same keys', () => {
  const fa = Object.keys(DICT.fa).filter((k) => !k.startsWith('e_')), en = Object.keys(DICT.en);
  assert.deepEqual(en.filter((k) => !fa.includes(k)), []);
  assert.deepEqual(fa.filter((k) => !en.includes(k) && !k.startsWith('cap_') ), []);
});
test('every static t("key") used in code exists in both languages', () => {
  const keys = new Set([...src.matchAll(/\bt\('([a-z0-9_]+)'(?!\s*\+)/g)].map((m) => m[1]));
  for (const k of keys) { assert.ok(k in DICT.en, 'en missing ' + k); assert.ok(k in DICT.fa, 'fa missing ' + k); }
});
test('dynamic key families are complete', () => {
  const fams = {
    st_: ['connected', 'disconnected', 'connecting', 'error', 'not_configured', 'unavailable', 'reachable', 'unreachable', 'unknown', 'ok', 'warn', 'bad'],
    nav_: ['dashboard', 'connection', 'groups', 'guard', 'welcome', 'moderation', 'tools', 'analytics', 'logs', 'settings', 'access'],
    rule_: ['anti_spam', 'anti_flood', 'anti_link', 'anti_ads', 'profanity', 'anti_repeat', 'anti_mention', 'anti_emoji', 'join_flood', 'scam_patterns', 'long_message', 'admin_protection'],
    p_: ['max_char_run', 'max_lines', 'action', 'allowed_domains', 'extra_phrases', 'extra_words', 'max_messages', 'window_seconds', 'max_repeats', 'max_mentions', 'max_emojis', 'max_joins', 'extra_patterns', 'max_length'],
    act_: ['log', 'delete', 'warn', 'delete_warn'], wa_: ['none', 'review', 'mute', 'temp_ban', 'ban'], tab_: ['test', 'warnings', 'exempt', 'violations', 'reports', 'actions'],
    exempt_: ['admin_protection', 'user_exempt'], kind_: ['user', 'admin'], rs_: ['open', 'resolved', 'dismissed'], an_: ['warnings', 'violations', 'messages_deleted', 'welcome_tests'],
    col_: ['when', 'action', 'target', 'details'], src_: ['secret', 'encrypted_d1'], sig_: ['backend', 'session', 'bot', 'stream'], step_: ['config', 'reach', 'login', 'bot', 'group'],
    m_: ['groups', 'active_warnings', 'violations_30d', 'open_reports', 'deleted_30d', 'messages_checked'], uc_: ['length', 'mass', 'volume', 'speed', 'area', 'temperature'],
    w_: ['clear', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'storm', 'unknown'], rps_: ['rock', 'paper', 'scissors', 'win', 'lose', 'draw'], guess_: ['higher', 'lower'], theme_: ['light', 'dark'],
    cfg_: ['admin_password', 'session_secret', 'token_encryption', 'allowed_origins'], acc_: ['1', '2', '3', '4'],
  };
  for (const [p, list] of Object.entries(fams)) for (const k of list) for (const l of ['en', 'fa']) assert.ok(`${p}${k}` in DICT[l], `${l} missing ${p}${k}`);
  for (const k of ['sig_backend', 'sig_session', 'sig_bot', 'sig_stream', 'step_config', 'step_reach', 'step_login', 'step_bot', 'step_group']) for (const l of ['en', 'fa']) assert.ok(`${k}_d` in DICT[l], `${l} missing ${k}_d`);
  for (const k of ['rule_anti_spam', 'rule_anti_flood', 'rule_anti_link', 'rule_anti_ads', 'rule_profanity', 'rule_anti_repeat', 'rule_anti_mention', 'rule_anti_emoji', 'rule_join_flood', 'rule_scam_patterns', 'rule_long_message', 'rule_admin_protection']) assert.ok(`${k}_d` in DICT.fa && `${k}_d` in DICT.en);
  const caps = ['bot_connect', 'manual_group_add', 'send_message', 'delete_message', 'group_discovery', 'ban_member', 'mute_member', 'slow_mode', 'media_link_lock', 'member_list', 'message_ingestion', 'welcome_delivery', 'live_prices', 'levels_leaderboard'];
  for (const c of caps) for (const l of ['en', 'fa']) assert.ok(`cap_${c}_t` in DICT[l], `${l} missing cap_${c}_t`);
  for (const c of caps.filter((c) => !['bot_connect', 'manual_group_add', 'send_message', 'delete_message'].includes(c))) assert.ok(`cap_${c}` in DICT.fa, 'fa reason ' + c);
});
