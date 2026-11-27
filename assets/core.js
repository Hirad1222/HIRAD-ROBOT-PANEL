// Core: DOM builder, i18n, API client, state, toasts, modal. No innerHTML anywhere: all text goes through textContent.
import { DICT } from './i18n.js';

export const cfg = window.HIRAD_CONFIG || {};
export const R = { go: () => {} };
export const S = { lang: 'fa', session: null, health: null, bot: null, summary: null, groups: [], group: null, caps: null, apiState: 'unknown', listeners: new Set() };

// ---- storage (preferences only; never tokens/secrets) ----
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* ignore */ } } };
export { ls };

// ---- DOM builder ----
export function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'text') n.textContent = v;
    else if (k === 'style') n.style.cssText = v; // CSSOM: allowed under a strict CSP (unlike a style attribute)
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
export const $ = (s, r = document) => r.querySelector(s);

// ---- i18n ----
export function t(key, vars) {
  let s = DICT[S.lang]?.[key] ?? DICT.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}
export function setLang(l) {
  S.lang = l === 'en' ? 'en' : 'fa';
  ls.set('hirad_lang', S.lang);
  document.documentElement.lang = S.lang;
  document.documentElement.dir = S.lang === 'fa' ? 'rtl' : 'ltr';
  document.title = t('app_title');
}
export function setTheme(th) {
  const v = th === 'dark' ? 'dark' : 'light';
  ls.set('hirad_theme', v);
  document.documentElement.dataset.theme = v;
  const m = $('meta[name=theme-color]'); if (m) m.content = v === 'dark' ? '#0C1020' : '#EEF1F6';
}
export function initPrefs() {
  setLang(ls.get('hirad_lang') || 'fa');
  const saved = ls.get('hirad_theme');
  setTheme(saved || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
}
export const fmtDate = (iso) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString(S.lang === 'fa' ? 'fa-IR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }); };
export const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString(S.lang === 'fa' ? 'fa-IR' : 'en-US'));

// ---- toasts + modal ----
export function toast(msg, bad = false) {
  const box = $('#toasts');
  const n = el('div', { class: 'toast' + (bad ? ' bad' : ''), role: bad ? 'alert' : 'status', text: msg });
  box.append(n);
  setTimeout(() => n.remove(), bad ? 6000 : 3200);
}
export function confirmDialog({ title, body, confirm, danger = false }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const done = (v) => { back.remove(); prev?.focus?.(); resolve(v); };
    const ok = el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => done(true) }, confirm || t('confirm'));
    const cancel = el('button', { class: 'btn', onclick: () => done(false) }, t('cancel'));
    const back = el('div', { class: 'modal-back', onclick: (e) => e.target === back && done(false), onkeydown: (e) => e.key === 'Escape' && done(false) },
      el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mt' }, el('h2', { id: 'mt' }, title), el('p', { class: 'sub' }, body), el('div', { class: 'acts' }, cancel, ok)));
    document.body.append(back);
    cancel.focus();
  });
}

// ---- API ----
export const apiConfigured = () => { const u = String(cfg.API_BASE_URL || '').trim(); return /^https:\/\/[^\s/]+/.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(u); };
const baseUrl = () => cfg.API_BASE_URL.trim().replace(/\/+$/, '');
export class ApiError extends Error { constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; } }

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  if (!apiConfigured()) throw new ApiError(0, 'not_configured', t('err_not_configured'));
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && S.session) headers.Authorization = 'Bearer ' + S.session;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  let res;
  try {
    res = await fetch(baseUrl() + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal, credentials: 'omit' });
  } catch {
    S.apiState = 'error'; notify();
    throw new ApiError(0, 'network', t('err_network'));
  } finally { clearTimeout(timer); }
  let j = null;
  try { j = await res.json(); } catch { /* non-JSON */ }
  if (S.apiState !== 'connected') { S.apiState = 'connected'; }
  if (!res.ok || !j || j.ok === false) {
    const e = j?.error || {};
    if (res.status === 401 && auth) { signOutLocal(); }
    throw new ApiError(res.status, e.code || 'error', errText(e.code, e.message, res.status), e.details);
  }
  return j.data;
}
function errText(code, message, status) {
  const k = 'e_' + code;
  return DICT[S.lang]?.[k] || message || ('HTTP ' + status);
}
export const errMsg = (e) => (e instanceof ApiError ? e.message : t('err_generic'));

// ---- session ----
export function loadSession() { S.session = ss.get('hirad_session'); }
export function setSession(tok) { S.session = tok; ss.set('hirad_session', tok); notify(); }
export function signOutLocal() { S.session = null; ss.set('hirad_session', null); S.summary = null; S.bot = null; S.groups = []; S.group = null; notify(); }

export function onChange(fn) { S.listeners.add(fn); }
export function notify() { for (const f of S.listeners) f(); }

// ---- shared refresh ----
export async function refreshHealth() {
  if (!apiConfigured()) { S.apiState = 'not_configured'; S.health = null; notify(); return; }
  S.apiState = 'connecting'; notify();
  try { S.health = await api('/api/health', { auth: false }); S.apiState = 'connected'; }
  catch { S.apiState = 'error'; S.health = null; }
  notify();
}
export async function refreshCore() {
  await refreshHealth();
  if (!S.session || S.apiState !== 'connected') return;
  try {
    const [bot, groups, summary] = await Promise.all([api('/api/bot'), api('/api/groups'), api('/api/summary')]);
    S.bot = bot; S.groups = groups.groups; S.groupsInfo = groups; S.summary = summary; S.caps = summary.capabilities;
    if (!S.groups.find((g) => g.chat_id === S.group)) S.group = S.groups[0]?.chat_id ?? null;
  } catch { /* api() already recorded the state */ }
  notify();
}
export function setGroup(id) { S.group = id; notify(); }

// ---- shared components ----
export function chip(state, label) { return el('span', { class: 'chip ' + state }, el('i', { class: 'lamp ' + state, 'aria-hidden': 'true' }), label ?? t('st_' + state)); }
export function unavailableBox(titleKey, reason) {
  return el('div', { class: 'unavail', role: 'note' }, el('div', { class: 'k' }, el('b', {}, t(titleKey)), chip('unavailable')), reason ? el('div', { class: 'd' }, reason) : null);
}
export function capReason(key) { const c = S.caps?.[key]; return c && !c.available ? (S.lang === 'fa' ? (DICT.fa['cap_' + key] || c.reason) : c.reason) : ''; }
export function empty(titleKey, bodyKey, ...actions) { return el('div', { class: 'empty' }, el('b', {}, t(titleKey)), bodyKey ? el('p', {}, t(bodyKey)) : null, ...actions); }
export function toggle(checked, onchange, label, disabled = false) {
  return el('label', { class: 'sw', style: 'margin:0' }, el('input', { type: 'checkbox', checked: checked ? true : null, disabled: disabled || null, 'aria-label': label, onchange: (e) => onchange(e.target.checked) }), el('span'));
}
export async function guarded(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { toast(errMsg(e), true); } finally { btn.disabled = false; }
}
