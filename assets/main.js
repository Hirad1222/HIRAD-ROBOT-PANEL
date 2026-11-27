import { S, R, el, $, t, initPrefs, setLang, setTheme, loadSession, refreshCore, onChange, apiConfigured } from './core.js';
import * as P from './pages.js';
import { tools } from './tools.js';

const ICONS = {
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  connection: 'M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0V8zM12 17v5',
  groups: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21a8 8 0 0 1 16 0',
  guard: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5l8-3z',
  welcome: 'M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z',
  moderation: 'M14 4l6 6-9 9H5v-6l9-9zM3 21h18',
  tools: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.7 2.7-2.4-.6-.6-2.4 2.7-2.7z',
  analytics: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  logs: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  access: 'M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 21v-1a7 7 0 0 1 14 0v1M17 14l2 2 3-3',
  menu: 'M3 6h18M3 12h18M3 18h18',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  lang: 'M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6',
};
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.9'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[name]); s.append(p); return s;
}
const PAGES = { dashboard: P.dashboard, connection: P.connection, groups: P.groups, guard: P.guard, welcome: P.welcome, moderation: P.moderation, tools, analytics: P.analytics, logs: P.logs, settings: P.settings, access: P.access };
const NAV = Object.keys(PAGES);
const BAR = ['dashboard', 'groups', 'guard', 'moderation'];
let current = 'dashboard';

function pageFromHash() { const p = location.hash.replace(/^#\/?/, ''); return NAV.includes(p) ? p : 'dashboard'; }
R.go = (page, force) => { if (location.hash === '#/' + page) { if (force) render(); } else location.hash = '#/' + page; };

function closeRail() { $('#rail').classList.remove('open'); $('#scrim')?.remove(); }
function openRail() { $('#rail').classList.add('open'); if (!$('#scrim')) document.body.append(el('div', { class: 'scrim', id: 'scrim', onclick: closeRail })); }

function signals() {
  const items = [
    ['sig_backend', S.apiState], ['sig_session', S.session ? 'connected' : (apiConfigured() ? 'disconnected' : 'not_configured')],
    ['sig_bot', S.bot ? S.bot.status : 'not_configured'], ['sig_stream', 'unavailable'],
  ];
  return el('div', { class: 'signals', role: 'group', 'aria-label': t('signals') }, items.map(([k, st]) => el('span', { class: 'sig', title: t(k) + ': ' + t('st_' + st) }, el('i', { class: 'lamp ' + st, 'aria-hidden': 'true' }), el('span', { class: 't' }, t(k)), el('span', { class: 'sr' }, t('st_' + st)))));
}

function shell() {
  const rail = el('nav', { class: 'rail', id: 'rail', 'aria-label': t('main_nav') },
    el('div', { class: 'brand' }, el('i', { 'aria-hidden': 'true' }, 'H'), el('div', {}, 'HIRAD ROBOT PANEL', el('small', {}, t('tagline')))),
    NAV.map((p) => el('button', { class: 'nav-btn', 'data-page': p, 'aria-current': p === current ? 'page' : null, onclick: () => { R.go(p); closeRail(); } }, icon(p), t('nav_' + p))));
  const top = el('header', { class: 'top' },
    el('button', { class: 'btn sm menu-btn', 'aria-label': t('menu'), onclick: openRail }, icon('menu')),
    el('h1', { id: 'h1', tabindex: '-1' }, t('nav_' + current)), signals(),
    el('button', { class: 'btn sm', 'aria-label': t('toggle_theme'), onclick: () => { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); } }, icon('sun')),
    el('button', { class: 'btn sm', 'aria-label': t('toggle_lang'), onclick: () => { setLang(S.lang === 'fa' ? 'en' : 'fa'); render(); } }, icon('lang'), S.lang === 'fa' ? 'EN' : 'فا'));
  const bar = el('nav', { class: 'bar', 'aria-label': t('main_nav') }, BAR.map((p) => el('button', { 'aria-current': p === current ? 'page' : null, onclick: () => R.go(p) }, icon(p), t('nav_' + p))), el('button', { onclick: openRail }, icon('menu'), t('more')));
  return [rail, el('div', { class: 'main' }, top, el('main', { class: 'view', id: 'view' }), el('footer', { class: 'sub', style: 'margin-top:30px' }, 'HIRAD ROBOT PANEL v3.0 · ' + t('footer'))), bar];
}

let rendering = false;
export function render() {
  if (rendering) return; rendering = true;
  try {
    current = pageFromHash();
    const app = $('#app'); const focusId = document.activeElement?.id;
    app.replaceChildren(...shell());
    const view = $('#view');
    try { view.replaceChildren(PAGES[current]()); } catch (e) { console.error(e); view.replaceChildren(el('div', { class: 'note bad' }, t('err_generic'))); }
    if (focusId) $('#' + focusId)?.focus?.();
  } finally { rendering = false; }
}

// Settings changes (theme) need no re-render; language does.
window.addEventListener('hashchange', () => { render(); $('#h1')?.focus?.(); window.scrollTo(0, 0); });
let pending = false;
onChange(() => { if (pending) return; pending = true; queueMicrotask(() => { pending = false; render(); }); });

initPrefs(); loadSession(); render(); refreshCore();
