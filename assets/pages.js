import { S, R, el, t, api, apiConfigured, cfg, toast, errMsg, guarded, confirmDialog, chip, unavailableBox, capReason, empty, toggle, fmtDate, fmtNum, refreshCore, refreshHealth, setGroup, setSession, signOutLocal, setLang, setTheme, ApiError } from './core.js';

// ---------- shared ----------
function loginPanel() {
  const pw = el('input', { type: 'password', id: 'pw', autocomplete: 'current-password', maxlength: '256', required: true });
  const form = el('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    await guarded(btn, async () => {
      const r = await api('/api/auth/login', { method: 'POST', body: { password: pw.value }, auth: false });
      pw.value = '';
      setSession(r.token);
      toast(t('signed_in'));
      await refreshCore();
    });
  } },
    el('h2', {}, t('login_title')), el('p', { class: 'sub' }, t('login_body')),
    el('label', { for: 'pw' }, t('password')), pw,
    el('div', { style: 'margin-top:14px' }, el('button', { class: 'btn primary', type: 'submit' }, t('sign_in'))));
  return form;
}
function notConfiguredPanel() {
  return el('div', { class: 'panel stack' }, el('div', { class: 'row', style: 'border:0;padding:0' }, chip('not_configured'), el('b', {}, t('nc_title'))),
    el('p', { class: 'sub' }, t('nc_body')), el('code', {}, 'assets/config.js → API_BASE_URL'), el('p', { class: 'sub' }, t('nc_hint')));
}
function backendDownPanel() {
  return el('div', { class: 'panel stack' }, el('div', { class: 'row', style: 'border:0;padding:0' }, chip('error'), el('b', {}, t('be_down_title'))), el('p', { class: 'sub' }, t('be_down_body')),
    el('button', { class: 'btn', onclick: refreshCore }, t('retry')));
}
export function gate() {
  if (!apiConfigured()) return notConfiguredPanel();
  if (S.apiState === 'error') return backendDownPanel();
  if (!S.session) return loginPanel();
  return null;
}
function needBot() {
  if (S.bot?.status === 'connected') return null;
  return el('div', { class: 'note warn' }, t('need_bot_a'), ' ', el('button', { class: 'btn sm', onclick: () => R.go('connection') }, t('go_connection')));
}
function groupPicker() {
  if (!S.groups.length) return empty('no_groups', 'no_groups_body', el('button', { class: 'btn', onclick: () => R.go('groups') }, t('go_groups')));
  const sel = el('select', { id: 'gp', 'aria-label': t('group'), onchange: (e) => setGroup(e.target.value) }, S.groups.map((g) => el('option', { value: g.chat_id, selected: g.chat_id === S.group ? true : null }, (g.title || g.chat_id))));
  return el('div', { class: 'panel' }, el('label', { for: 'gp', style: 'margin-top:0' }, t('group')), sel);
}
const msg = (k) => el('div', { class: 'skeleton', 'aria-label': t(k || 'loading') });

// ---------- dashboard ----------
export function dashboard() {
  const g = gate();
  const stepsData = [
    [apiConfigured(), 'step_config', null],
    [S.apiState === 'connected', 'step_reach', 'settings'],
    [!!S.session, 'step_login', 'access'],
    [S.bot?.status === 'connected', 'step_bot', 'connection'],
    [S.groups.length > 0, 'step_group', 'groups'],
  ];
  const firstOpen = stepsData.findIndex((x) => !x[0]);
  const steps = el('ol', { class: 'steps' }, stepsData.map(([done, key, page], i) => el('li', { class: done ? 'done' : '' }, el('span', { class: 'tick', 'aria-hidden': 'true' }, done ? '✓' : ''),
    el('div', { class: 'grow', style: 'flex:1' }, el('b', {}, t(key)), el('div', { class: 'd sub', style: 'margin:0' }, done ? t('step_done') : t(key + '_d'))),
    !done && page && i === firstOpen ? el('button', { class: 'btn sm primary', onclick: () => R.go(page) }, t('step_go')) : null)));
  const out = el('div', { class: 'stack' },
    g, // login form / not-configured / backend-down panel, shown right on the first page
    el('div', { class: 'panel' }, el('h2', {}, t('dash_status')), el('p', { class: 'sub' }, t('dash_status_d')), signalRows()),
    el('div', { class: 'panel' }, el('h2', {}, t('dash_next')), steps));
  if (!g && S.summary) {
    const s = S.summary;
    out.append(el('div', { class: 'panel' }, el('h2', {}, t('dash_numbers')), el('p', { class: 'sub' }, t('dash_numbers_d')),
      el('div', { class: 'kv' },
        [['groups', s.groups], ['active_warnings', s.active_warnings], ['violations_30d', s.violations_30d], ['open_reports', s.open_reports], ['deleted_30d', s.messages_deleted_30d]]
          .map(([k, v]) => el('div', {}, el('b', {}, fmtNum(v)), el('span', {}, t('m_' + k)))))),
      unavailableBox('m_messages_checked', capReason('message_ingestion')));
  }
  return out;
}
export function signalRows() {
  const rows = [
    ['sig_backend', S.apiState, S.apiState === 'connected' ? (S.health?.status === 'degraded' ? t('degraded') : t('reachable_l')) : null],
    ['sig_session', S.session ? 'connected' : apiConfigured() ? 'disconnected' : 'not_configured', S.session ? t('signed_in_l') : null],
    ['sig_bot', S.bot ? S.bot.status : (S.session ? 'connecting' : 'not_configured'), S.bot?.bot?.username ? '@' + S.bot.bot.username : null],
    ['sig_stream', 'unavailable', null],
  ];
  return el('div', {}, rows.map(([k, st, extra]) => el('div', { class: 'row' }, el('i', { class: 'lamp ' + st, 'aria-hidden': 'true' }), el('div', { class: 'grow' }, el('div', { class: 'k' }, t(k)), el('div', { class: 'd' }, t(k + '_d'))), extra ? el('span', { class: 'd ltr' }, extra) : null, chip(st))));
}

// ---------- connection ----------
export function connection() {
  const g = gate(); if (g) return g;
  const root = el('div', { class: 'stack' });
  const b = S.bot;
  const status = el('div', { class: 'panel' }, el('h2', {}, t('bot_status')),
    el('div', { class: 'row' }, chip(b.status), el('div', { class: 'grow' }, b.bot ? el('div', {}, el('b', {}, b.bot.name || '—'), ' ', el('span', { class: 'ltr d' }, b.bot.username ? '@' + b.bot.username : '')) : el('span', { class: 'd' }, t('bot_none')),
      b.last_error ? el('div', { class: 'note bad', style: 'margin-top:8px' }, b.last_error) : null,
      el('div', { class: 'd' }, t('last_check') + ': ' + fmtDate(b.last_checked_at)))),
    b.source ? el('div', { class: 'd' }, t('token_source') + ': ' + t('src_' + b.source)) : null,
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' },
      b.status !== 'disconnected' ? el('button', { class: 'btn', onclick: (e) => guarded(e.currentTarget, async () => { S.bot = await api('/api/bot/check', { method: 'POST' }); toast(S.bot.status === 'connected' ? t('check_ok') : t('check_fail'), S.bot.status !== 'connected'); await refreshCore(); }) }, t('check_now')) : null,
      b.status !== 'disconnected' ? el('button', { class: 'btn danger', onclick: async (e) => { const btn = e.currentTarget; if (await confirmDialog({ title: t('disc_title'), body: t('disc_body'), confirm: t('disconnect'), danger: true })) guarded(btn, async () => { const r = await api('/api/bot/disconnect', { method: 'POST' }); if (r.note) toast(r.note); await refreshCore(); }); } }, t('disconnect')) : null));
  const tok = el('input', { type: 'password', id: 'tok', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '256', required: true });
  const form = el('form', { class: 'panel', onsubmit: (e) => {
    e.preventDefault();
    guarded(form.querySelector('button[type=submit]'), async () => {
      const value = tok.value; tok.value = '';
      S.bot = { ...S.bot, status: 'connecting' }; render();
      try { await api('/api/bot/connect', { method: 'POST', body: { token: value } }); toast(t('connected_ok')); }
      finally { await refreshCore(); }
    });
  } },
    el('h2', {}, t('token_title')), el('p', { class: 'sub' }, t('token_body')),
    !b.encryption_configured && !b.source ? el('div', { class: 'note warn' }, t('no_enc')) : null,
    el('label', { for: 'tok' }, t('token_label')), tok,
    el('div', { style: 'margin-top:14px' }, el('button', { class: 'btn primary', type: 'submit' }, b.status === 'connected' ? t('replace_token') : t('connect'))),
    el('div', { class: 'note', style: 'margin-top:14px' }, t('token_privacy')));
  const render = () => { root.replaceChildren(status, form, unavailableBox('cap_group_discovery_t', capReason('group_discovery'))); };
  render();
  return root;
}

// ---------- groups ----------
export function groups() {
  const g = gate(); if (g) return g;
  const nb = needBot();
  const idIn = el('input', { type: 'text', id: 'cid', class: 'ltr', maxlength: '128', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', required: true });
  const add = el('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); guarded(add.querySelector('button'), async () => { await api('/api/groups', { method: 'POST', body: { chat_id: idIn.value.trim() } }); idIn.value = ''; toast(t('group_added')); await refreshCore(); }); } },
    el('h2', {}, t('add_group')), el('p', { class: 'sub' }, t('add_group_d')), el('label', { for: 'cid' }, t('chat_id')), idIn,
    el('div', { style: 'margin-top:14px' }, el('button', { class: 'btn primary', type: 'submit', disabled: nb ? true : null }, t('add'))));
  const list = el('div', { class: 'panel' }, el('h2', {}, t('your_groups')),
    S.groups.length ? S.groups.map((x) => el('div', { class: 'row' }, el('div', { class: 'grow' }, el('div', { class: 'k' }, x.title || t('untitled')), el('div', { class: 'd ltr' }, x.chat_id), x.last_error ? el('div', { class: 'd' }, x.last_error) : null, el('div', { class: 'd' }, t('last_check') + ': ' + fmtDate(x.last_checked_at))),
      chip(x.status),
      el('button', { class: 'btn sm', onclick: (e) => guarded(e.currentTarget, async () => { await api(`/api/groups/${encodeURIComponent(x.chat_id)}/refresh`, { method: 'POST' }); await refreshCore(); }) }, t('refresh')),
      el('button', { class: 'btn sm danger', onclick: async (e) => { const b = e.currentTarget; if (await confirmDialog({ title: t('rm_group'), body: t('rm_group_d'), confirm: t('remove'), danger: true })) guarded(b, async () => { await api(`/api/groups/${encodeURIComponent(x.chat_id)}`, { method: 'DELETE' }); toast(t('removed')); await refreshCore(); }); } }, t('remove'))))
      : empty('no_groups', S.bot?.status === 'connected' ? 'no_groups_connected' : 'no_groups_disc'));
  return el('div', { class: 'stack' }, nb, add, list, unavailableBox('cap_group_discovery_t', capReason('group_discovery')), unavailableBox('cap_member_list_t', capReason('member_list')));
}

// ---------- settings loader shared by guard + welcome ----------
const cache = { id: null, data: null };
async function loadSettings(id, force) {
  if (!force && cache.id === id && cache.data) return cache.data;
  cache.data = await api(`/api/groups/${encodeURIComponent(id)}/settings`); cache.id = id; return cache.data;
}
function pageWithGroup(build) {
  const g = gate(); if (g) return g;
  const gp = groupPicker();
  const root = el('div', { class: 'stack' }, gp);
  if (!S.group) return root;
  const body = el('div', {}, msg()); root.append(body);
  loadSettings(S.group).then((data) => body.replaceChildren(build(data))).catch((e) => body.replaceChildren(el('div', { class: 'note bad' }, errMsg(e))));
  return root;
}

// ---------- guard ----------
const ACTIONS = ['log', 'delete', 'warn', 'delete_warn'];
const STATEFUL = ['anti_flood', 'anti_repeat', 'join_flood'];
const RULE_ORDER = ['anti_spam', 'anti_flood', 'anti_link', 'anti_ads', 'profanity', 'anti_repeat', 'anti_mention', 'anti_emoji', 'join_flood', 'scam_patterns', 'long_message', 'admin_protection'];
export function guard() {
  return pageWithGroup((data) => {
    const id = S.group;
    const draft = JSON.parse(JSON.stringify({ rules: data.rules, group: data.group }));
    const rules = el('div', { class: 'panel' }, el('h2', {}, t('guard_rules')), el('p', { class: 'sub' }, t('guard_rules_d')), el('div', { class: 'note', style: 'margin-bottom:6px' }, t('guard_engine')),
      RULE_ORDER.map((k) => {
        const r = draft.rules[k];
        const params = Object.entries(r.params);
        const det = params.length ? el('details', { style: 'width:100%' }, el('summary', { class: 'd', style: 'cursor:pointer;min-height:32px' }, t('rule_options')),
          params.map(([name, val]) => paramField(k, name, val, r))) : null;
        return el('div', { class: 'row' }, el('div', { class: 'grow' }, el('div', { class: 'k' }, t('rule_' + k)), el('div', { class: 'd' }, t('rule_' + k + '_d')),
          STATEFUL.includes(k) ? el('div', { class: 'd' }, el('span', { class: 'chip unavailable' }, t('needs_stream'))) : null),
          toggle(r.enabled, (v) => { r.enabled = v; }, t('rule_' + k), k === 'admin_protection' && false), det);
      }));
    const pol = el('div', { class: 'panel' }, el('h2', {}, t('policy')), el('p', { class: 'sub' }, t('policy_d')),
      el('label', { for: 'wt' }, t('warn_threshold')), el('input', { id: 'wt', type: 'number', min: '1', max: '20', value: draft.group.warn_threshold, oninput: (e) => { draft.group.warn_threshold = Number(e.target.value); } }),
      el('label', { for: 'wa' }, t('warn_action')),
      el('select', { id: 'wa', onchange: (e) => { draft.group.warn_action = e.target.value; } }, ['none', 'review', 'mute', 'temp_ban', 'ban'].map((a) => el('option', { value: a, selected: draft.group.warn_action === a ? true : null }, t('wa_' + a)))),
      el('div', { class: 'note warn', style: 'margin-top:10px' }, t('warn_action_note')),
      el('label', { for: 'wd' }, t('action_minutes')), el('input', { id: 'wd', type: 'number', min: '1', max: '525600', value: draft.group.action_duration_minutes, oninput: (e) => { draft.group.action_duration_minutes = Number(e.target.value); } }),
      el('label', { for: 'rt' }, t('group_rules_text')), el('textarea', { id: 'rt', maxlength: '2000', oninput: (e) => { draft.group.rules_text = e.target.value; } }, draft.group.rules_text));
    const stored = el('div', { class: 'panel stack' }, el('h2', {}, t('stored_only')), el('p', { class: 'sub' }, t('stored_only_d')),
      ['slow_mode', 'media_link_lock'].map((k) => unavailableBox('cap_' + k + '_t', capReason(k))));
    const save = el('button', { class: 'btn primary', onclick: (e) => guarded(e.currentTarget, async () => {
      const body = { group: { warn_threshold: draft.group.warn_threshold, warn_action: draft.group.warn_action, action_duration_minutes: draft.group.action_duration_minutes, rules_text: draft.group.rules_text }, rules: {} };
      for (const k of RULE_ORDER) body.rules[k] = { enabled: draft.rules[k].enabled, params: draft.rules[k].params };
      cache.data = await api(`/api/groups/${encodeURIComponent(id)}/settings`, { method: 'PUT', body }); cache.id = id; toast(t('saved'));
    }) }, t('save_changes'));
    return el('div', { class: 'stack' }, rules, pol, stored, save);
  });
}
function paramField(rule, name, val, r) {
  const fid = `p_${rule}_${name}`;
  const label = el('label', { for: fid }, t('p_' + name));
  if (name === 'action') return el('div', {}, label, el('select', { id: fid, onchange: (e) => { r.params[name] = e.target.value; } }, ACTIONS.map((a) => el('option', { value: a, selected: val === a ? true : null }, t('act_' + a)))));
  if (Array.isArray(val)) return el('div', {}, label, el('textarea', { id: fid, class: 'ltr', onchange: (e) => { r.params[name] = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); } }, val.join('\n')), el('div', { class: 'd' }, t('one_per_line')));
  return el('div', {}, label, el('input', { id: fid, type: 'number', value: val, oninput: (e) => { r.params[name] = Number(e.target.value); } }));
}

// ---------- welcome ----------
export function welcome() {
  return pageWithGroup((data) => {
    const id = S.group; const w = { ...data.welcome };
    const mk = (kind) => el('div', { class: 'panel' }, el('div', { class: 'row', style: 'border:0;padding:0' }, el('h2', { class: 'grow', style: 'margin:0' }, t(kind + '_msg')), toggle(w[kind + '_enabled'], (v) => { w[kind + '_enabled'] = v; }, t(kind + '_msg'))),
      el('label', { for: kind + 't' }, t('msg_text')), el('textarea', { id: kind + 't', maxlength: '1000', oninput: (e) => { w[kind + '_text'] = e.target.value; } }, w[kind + '_text']),
      el('p', { class: 'd' }, t('placeholders')),
      el('button', { class: 'btn sm', onclick: (e) => guarded(e.currentTarget, async () => {
        if (!(await confirmDialog({ title: t('send_test'), body: t('send_test_d'), confirm: t('send') }))) return;
        await api(`/api/groups/${encodeURIComponent(id)}/welcome/test`, { method: 'POST', body: { kind: kind === 'leave' ? 'leave' : 'welcome' } }); toast(t('test_sent')); }) }, t('send_test')));
    const save = el('button', { class: 'btn primary', onclick: (e) => guarded(e.currentTarget, async () => { cache.data = await api(`/api/groups/${encodeURIComponent(id)}/settings`, { method: 'PUT', body: { welcome: w } }); cache.id = id; toast(t('saved')); }) }, t('save_changes'));
    return el('div', { class: 'stack' }, el('div', { class: 'note' }, t('welcome_note')), mk('welcome'), mk('leave'), unavailableBox('cap_welcome_delivery_t', capReason('welcome_delivery')), save);
  });
}

// ---------- moderation ----------
let modTab = 'test';
export function moderation() {
  const g = gate(); if (g) return g;
  const root = el('div', { class: 'stack' }, groupPicker());
  if (!S.group) return root;
  const id = S.group, base = `/api/groups/${encodeURIComponent(id)}`;
  const tabs = ['test', 'warnings', 'exempt', 'violations', 'reports', 'actions'];
  const body = el('div', {});
  const bar = el('div', { class: 'tabs', role: 'tablist' }, tabs.map((k) => el('button', { class: 'tab', role: 'tab', 'aria-selected': String(k === modTab), onclick: () => { modTab = k; R.go('moderation'); } }, t('tab_' + k))));
  root.append(bar, body);
  const F = { test: tTest, warnings: tWarnings, exempt: tExempt, violations: tViolations, reports: tReports, actions: tActions }[modTab];
  F(body, id, base);
  return root;
}
const field = (id, label, input) => el('div', {}, el('label', { for: id }, label), input);
function listLoader(body, path, key, render) {
  const box = el('div', { class: 'panel' }, msg()); body.append(box);
  const load = () => api(path).then((d) => box.replaceChildren(render(d[key], load))).catch((e) => box.replaceChildren(el('div', { class: 'note bad' }, errMsg(e))));
  load(); return load;
}
function tTest(body, id, base) {
  const text = el('textarea', { id: 'tt', maxlength: '8000' }), uid = el('input', { type: 'text', id: 'tu', class: 'ltr', maxlength: '128' }), adm = el('input', { type: 'checkbox', id: 'ta' });
  const out = el('div', { class: 'stack' });
  body.append(el('div', { class: 'panel' }, el('h2', {}, t('tab_test')), el('p', { class: 'sub' }, t('test_d')), field('tt', t('message_text'), text), field('tu', t('user_id_opt'), uid),
    el('label', { for: 'ta', style: 'display:flex;gap:8px;align-items:center' }, adm, t('is_admin')),
    el('div', { style: 'margin-top:12px' }, el('button', { class: 'btn primary', onclick: (e) => guarded(e.currentTarget, async () => {
      const b = { text: text.value, is_admin: adm.checked }; if (uid.value.trim()) b.user_id = uid.value.trim();
      const r = await api(base + '/moderation/test', { method: 'POST', body: b });
      out.replaceChildren(r.exempt ? el('div', { class: 'note' }, t('exempt_' + (r.reason || 'user_exempt'))) : r.violations.length ? r.violations.map((v) => el('div', { class: 'note warn' }, el('b', {}, t('rule_' + v.rule)), ' — ', v.reason, ' · ', t('would_do') + ': ' + t('act_' + v.action))) : el('div', { class: 'note' }, t('no_violation')),
        el('div', { class: 'd' }, t('dry_run_note')));
    }) }, t('run_test'))), out));
}
function tWarnings(body, id, base) {
  const u = el('input', { type: 'text', id: 'wu', class: 'ltr', maxlength: '128', required: true }), r = el('input', { type: 'text', id: 'wr', maxlength: '500' }), n = el('input', { type: 'checkbox', id: 'wn' });
  const out = el('div', {});
  let reload;
  const form = el('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); guarded(form.querySelector('button'), async () => {
    const res = await api(base + '/warnings', { method: 'POST', body: { user_id: u.value.trim(), reason: r.value, notify: n.checked } });
    toast(t('warn_issued', { n: fmtNum(res.active_warnings), m: fmtNum(res.threshold) }));
    if (n.checked && res.notified === false) toast(t('notify_failed'), true);
    out.replaceChildren(res.escalation.triggered ? el('div', { class: 'note ' + (res.escalation.supported ? 'warn' : 'bad') }, el('b', {}, t('threshold_reached')), ' ', res.escalation.message) : '');
    reload?.();
  }); } }, el('h2', {}, t('issue_warning')), field('wu', t('user_id'), u), field('wr', t('reason'), r),
    el('label', { for: 'wn', style: 'display:flex;gap:8px;align-items:center' }, n, t('notify_group')), el('div', { style: 'margin-top:12px' }, el('button', { class: 'btn primary', type: 'submit' }, t('issue'))), out);
  body.append(form);
  reload = listLoader(body, base + '/warnings', 'warnings', (rows, load) => el('div', {}, el('h2', {}, t('tab_warnings')), rows.length ? rows.map((w) => el('div', { class: 'row' }, el('div', { class: 'grow' }, el('span', { class: 'ltr k' }, w.user_id), el('div', { class: 'd' }, w.reason || '—', ' · ', fmtDate(w.created_at))),
    w.revoked_at ? chip('unavailable', t('revoked')) : el('button', { class: 'btn sm', onclick: (e) => guarded(e.currentTarget, async () => { await api(`${base}/warnings/${w.id}`, { method: 'DELETE' }); toast(t('revoked')); load(); }) }, t('revoke')))) : empty('none_yet', null)));
}
function tExempt(body, id, base) {
  const u = el('input', { type: 'text', id: 'eu', class: 'ltr', maxlength: '128', required: true }), k = el('select', { id: 'ek' }, el('option', { value: 'user' }, t('kind_user')), el('option', { value: 'admin' }, t('kind_admin'))), note = el('input', { type: 'text', id: 'en', maxlength: '200' });
  let reload;
  const form = el('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); guarded(form.querySelector('button'), async () => { await api(base + '/exemptions', { method: 'POST', body: { user_id: u.value.trim(), kind: k.value, note: note.value } }); u.value = ''; note.value = ''; toast(t('saved')); reload?.(); }); } },
    el('h2', {}, t('tab_exempt')), el('p', { class: 'sub' }, t('exempt_d')), field('eu', t('user_id'), u), field('ek', t('kind'), k), field('en', t('note'), note), el('div', { style: 'margin-top:12px' }, el('button', { class: 'btn primary', type: 'submit' }, t('add'))));
  body.append(form);
  reload = listLoader(body, base + '/exemptions', 'exemptions', (rows, load) => rows.length ? el('div', {}, rows.map((x) => el('div', { class: 'row' }, el('div', { class: 'grow' }, el('span', { class: 'ltr k' }, x.user_id), el('div', { class: 'd' }, t('kind_' + x.kind), x.note ? ' · ' + x.note : '')), el('button', { class: 'btn sm', onclick: (e) => guarded(e.currentTarget, async () => { await api(`${base}/exemptions/${encodeURIComponent(x.user_id)}`, { method: 'DELETE' }); load(); }) }, t('remove'))))) : empty('none_yet', null));
}
function tViolations(body, id, base) {
  const u = el('input', { type: 'text', id: 'vu', class: 'ltr', maxlength: '128', required: true }), r = el('select', { id: 'vr' }, RULE_ORDER.map((k) => el('option', { value: k }, t('rule_' + k)))), ex = el('input', { type: 'text', id: 've', maxlength: '200' });
  let reload;
  const form = el('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); guarded(form.querySelector('button'), async () => { await api(base + '/violations', { method: 'POST', body: { user_id: u.value.trim(), rule_key: r.value, excerpt: ex.value || undefined, action_taken: 'logged' } }); toast(t('saved')); reload?.(); }); } },
    el('h2', {}, t('record_violation')), el('p', { class: 'sub' }, t('record_violation_d')), field('vu', t('user_id'), u), field('vr', t('rule'), r), field('ve', t('excerpt'), ex), el('div', { style: 'margin-top:12px' }, el('button', { class: 'btn primary', type: 'submit' }, t('record'))));
  body.append(form);
  reload = listLoader(body, base + '/violations', 'violations', (rows) => rows.length ? el('div', {}, el('h2', {}, t('tab_violations')), rows.map((v) => el('div', { class: 'row' }, el('div', { class: 'grow' }, el('span', { class: 'ltr k' }, v.user_id), ' · ', t('rule_' + v.rule_key), v.excerpt ? el('div', { class: 'd' }, v.excerpt) : null, el('div', { class: 'd' }, fmtDate(v.created_at))), chip('unknown', v.action_taken)))) : empty('none_yet', null));
}
function tReports(body, id, base) {
  const u = el('input', { type: 'text', id: 'ru', class: 'ltr', maxlength: '128', required: true }), m = el('input', { type: 'text', id: 'rm', class: 'ltr', maxlength: '128' }), r = el('input', { type: 'text', id: 'rr', maxlength: '500' });
  let reload;
  const form = el('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); guarded(form.querySelector('button'), async () => { const b = { reported_user_id: u.value.trim(), reason: r.value }; if (m.value.trim()) b.message_id = m.value.trim(); await api(base + '/reports', { method: 'POST', body: b }); toast(t('saved')); reload?.(); }); } },
    el('h2', {}, t('new_report')), field('ru', t('reported_user'), u), field('rm', t('message_id_opt'), m), field('rr', t('reason'), r), el('div', { style: 'margin-top:12px' }, el('button', { class: 'btn primary', type: 'submit' }, t('add'))));
  body.append(form);
  reload = listLoader(body, base + '/reports', 'reports', (rows, load) => rows.length ? el('div', {}, el('h2', {}, t('tab_reports')), rows.map((x) => el('div', { class: 'row' }, el('div', { class: 'grow' }, el('span', { class: 'ltr k' }, x.reported_user_id), el('div', { class: 'd' }, x.reason || '—', ' · ', fmtDate(x.created_at))), chip(x.status === 'open' ? 'warn' : 'ok', t('rs_' + x.status)),
    x.status === 'open' ? [['resolved', 'resolve'], ['dismissed', 'dismiss']].map(([st, lab]) => el('button', { class: 'btn sm', onclick: (e) => guarded(e.currentTarget, async () => { await api(`${base}/reports/${x.id}`, { method: 'PATCH', body: { status: st } }); load(); }) }, t(lab))) : null))) : empty('none_yet', null));
}
function tActions(body, id, base) {
  const m = el('input', { type: 'text', id: 'dm', class: 'ltr', maxlength: '128', required: true });
  const form = el('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); guarded(form.querySelector('button'), async () => {
    if (!(await confirmDialog({ title: t('delete_msg'), body: t('delete_msg_d'), confirm: t('delete'), danger: true }))) return;
    await api(base + '/messages/delete', { method: 'POST', body: { message_id: m.value.trim(), confirm: true } }); m.value = ''; toast(t('deleted')); }); } },
    el('h2', {}, t('delete_msg')), el('p', { class: 'sub' }, t('delete_msg_hint')), field('dm', t('message_id'), m), el('div', { style: 'margin-top:12px' }, el('button', { class: 'btn danger', type: 'submit' }, t('delete'))));
  body.append(form, el('div', { class: 'stack', style: 'margin-top:14px' }, ['ban_member', 'mute_member'].map((k) => unavailableBox('cap_' + k + '_t', capReason(k)))));
}

// ---------- analytics ----------
export function analytics() {
  const g = gate(); if (g) return g;
  const root = el('div', { class: 'stack' });
  const days = el('select', { id: 'ad', 'aria-label': t('period'), onchange: load }, [7, 30, 90].map((d) => el('option', { value: d, selected: d === 30 ? true : null }, t('days', { n: fmtNum(d) }))));
  const scope = el('select', { id: 'as', 'aria-label': t('scope'), onchange: load }, el('option', { value: '*' }, t('all_groups')), S.groups.map((x) => el('option', { value: x.chat_id }, x.title || x.chat_id)));
  const out = el('div', { class: 'stack' }, msg());
  root.append(el('div', { class: 'panel cols' }, el('div', {}, el('label', { for: 'as', style: 'margin-top:0' }, t('scope')), scope), el('div', {}, el('label', { for: 'ad', style: 'margin-top:0' }, t('period')), days)), out, unavailableBox('m_messages_checked', capReason('message_ingestion')), unavailableBox('cap_levels_leaderboard_t', capReason('levels_leaderboard')));
  function load() {
    api(`/api/analytics?days=${days.value}&group_id=${encodeURIComponent(scope.value)}`).then((d) => {
      const metrics = ['warnings', 'violations', 'messages_deleted', 'welcome_tests'];
      const byDay = {}; for (const r of d.series) (byDay[r.metric] ||= {})[r.day] = r.value;
      const dayList = []; for (let i = d.days - 1; i >= 0; i--) dayList.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
      out.replaceChildren(metrics.map((m) => { const vals = dayList.map((x) => byDay[m]?.[x] || 0); const max = Math.max(1, ...vals); const total = vals.reduce((a, b) => a + b, 0);
        return el('div', { class: 'panel' }, el('div', { class: 'row', style: 'border:0;padding:0' }, el('h2', { class: 'grow', style: 'margin:0' }, t('an_' + m)), el('b', {}, fmtNum(total))),
          total ? el('div', { class: 'bars', role: 'img', 'aria-label': t('an_' + m) + ': ' + fmtNum(total) }, vals.map((v, i) => el('i', { style: `height:${Math.round((v / max) * 100)}%`, title: dayList[i] + ': ' + v }))) : el('p', { class: 'd' }, t('no_data_period'))); }), el('div', { class: 'note' }, t('analytics_note')));
    }).catch((e) => out.replaceChildren(el('div', { class: 'note bad' }, errMsg(e))));
  }
  load();
  return root;
}

// ---------- logs ----------
export function logs() {
  const g = gate(); if (g) return g;
  const tbody = el('tbody'), more = el('button', { class: 'btn', hidden: true }, t('load_more')), status = el('div', {});
  let before = null;
  const filter = el('input', { type: 'search', id: 'lf', 'aria-label': t('filter'), placeholder: t('filter'), oninput: apply });
  function apply() { const q = filter.value.toLowerCase(); for (const tr of tbody.children) tr.hidden = q && !tr.textContent.toLowerCase().includes(q); }
  function load() {
    more.disabled = true;
    api('/api/audit-logs?limit=50' + (before ? '&before=' + before : '')).then((d) => {
      for (const l of d.logs) tbody.append(el('tr', {}, el('td', { class: 'mono' }, fmtDate(l.created_at)), el('td', {}, l.action), el('td', { class: 'mono' }, l.target || '—'), el('td', { class: 'mono' }, l.details_json || '')));
      before = d.next_before; more.hidden = !before; more.disabled = false; status.replaceChildren(tbody.children.length ? '' : empty('none_yet', null)); apply();
    }).catch((e) => status.replaceChildren(el('div', { class: 'note bad' }, errMsg(e))));
  }
  more.onclick = load; load();
  return el('div', { class: 'stack' }, el('div', { class: 'panel stack' }, el('h2', {}, t('audit_log')), el('p', { class: 'sub' }, t('audit_log_d')), filter,
    el('div', { class: 'scroll-x' }, el('table', {}, el('thead', {}, el('tr', {}, ['when', 'action', 'target', 'details'].map((k) => el('th', {}, t('col_' + k))))), tbody)), status, more));
}

// ---------- settings ----------
export function settings() {
  const feats = S.caps ? Object.entries(S.caps) : null;
  return el('div', { class: 'stack' },
    el('div', { class: 'panel' }, el('h2', {}, t('appearance')),
      el('label', { for: 'sl' }, t('language')), el('select', { id: 'sl', onchange: (e) => { setLang(e.target.value); R.go('settings', true); } }, el('option', { value: 'fa', selected: S.lang === 'fa' ? true : null }, 'فارسی'), el('option', { value: 'en', selected: S.lang === 'en' ? true : null }, 'English')),
      el('label', { for: 'st' }, t('theme')), el('select', { id: 'st', onchange: (e) => { setTheme(e.target.value); } }, ['light', 'dark'].map((v) => el('option', { value: v, selected: document.documentElement.dataset.theme === v ? true : null }, t('theme_' + v))))),
    el('div', { class: 'panel' }, el('h2', {}, t('backend')),
      el('div', { class: 'row' }, el('div', { class: 'grow' }, el('div', { class: 'k' }, t('backend_url')), el('div', { class: 'd ltr' }, apiConfigured() ? cfg.API_BASE_URL : t('st_not_configured'))), chip(S.apiState)),
      S.health ? el('div', { class: 'row' }, el('div', { class: 'grow' }, el('div', { class: 'k' }, t('server_version')), el('div', { class: 'd ltr' }, S.health.version)), chip(S.health.database ? 'ok' : 'error', S.health.database ? t('db_ok') : t('db_bad'))) : null,
      S.health ? Object.entries(S.health.configured).map(([k, v]) => el('div', { class: 'row' }, el('div', { class: 'grow' }, t('cfg_' + k)), chip(v ? 'ok' : 'warn', v ? t('set') : t('missing')))) : null,
      el('p', { class: 'sub', style: 'margin-top:10px' }, t('backend_url_hint'))),
    el('div', { class: 'panel' }, el('h2', {}, t('feature_table')), el('p', { class: 'sub' }, t('feature_table_d')),
      feats ? feats.map(([k, c]) => el('div', { class: 'row' + (c.available ? '' : ' unavail'), style: c.available ? '' : 'border-top:0;margin-top:8px' }, el('div', { class: 'grow' }, el('div', { class: 'k' }, t('cap_' + k + '_t')), c.available ? el('div', { class: 'd' }, c.basis) : el('div', { class: 'd' }, capReason(k))), chip(c.available ? 'ok' : 'unavailable', c.available ? t('available') : t('st_unavailable')))) : el('p', { class: 'd' }, t('sign_in_to_see'))));
}

// ---------- access ----------
export function access() {
  if (!apiConfigured()) return notConfiguredPanel();
  if (!S.session) return loginPanel();
  return el('div', { class: 'stack' },
    el('div', { class: 'panel' }, el('h2', {}, t('session')), el('div', { class: 'row' }, chip('connected', t('signed_in_l')), el('div', { class: 'grow d' }, t('session_d'))),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        el('button', { class: 'btn', onclick: () => { signOutLocal(); toast(t('signed_out')); R.go('dashboard'); } }, t('sign_out')),
        el('button', { class: 'btn danger', onclick: async (e) => { const b = e.currentTarget; if (await confirmDialog({ title: t('sign_out_all'), body: t('sign_out_all_d'), confirm: t('sign_out_all'), danger: true })) guarded(b, async () => { await api('/api/auth/logout-all', { method: 'POST' }); signOutLocal(); toast(t('signed_out')); R.go('dashboard'); }); } }, t('sign_out_all')))),
    el('div', { class: 'panel' }, el('h2', {}, t('access_model')), el('p', { class: 'sub' }, t('access_model_d')), el('ul', {}, ['acc_1', 'acc_2', 'acc_3', 'acc_4'].map((k) => el('li', {}, t(k))))));
}
