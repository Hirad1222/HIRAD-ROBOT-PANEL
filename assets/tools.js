import { S, el, t, toast, chip, unavailableBox, fmtNum } from './core.js';
import { normalizeDigits, calc, convert, UNITS, weatherLabel, RIDDLES, checkRiddle, randInt, RPS, rpsResult, guessHint, FACTS, CITIES, persianDate } from './lib.js';

const city = (c) => (S.lang === 'fa' ? c.fa : c.en);
const section = (title, sub, ...kids) => el('section', { class: 'panel stack' }, el('div', {}, el('h2', {}, title), sub ? el('p', { class: 'sub', style: 'margin:0' }, sub) : null), ...kids);

function calculator() {
  const inp = el('input', { type: 'text', id: 'calc-in', class: 'ltr', inputmode: 'decimal', autocomplete: 'off', 'aria-label': t('tool_calc'), placeholder: '(12+8)*3%' });
  const out = el('div', { class: 'big ltr', 'aria-live': 'polite' }, '—');
  const run = () => { try { out.textContent = String(calc(inp.value)); out.style.color = ''; } catch { out.textContent = t('calc_invalid'); out.style.color = 'var(--bad)'; } };
  inp.addEventListener('keydown', (e) => e.key === 'Enter' && run());
  const keys = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '(', ')', '+', '^', '%', 'C'];
  return section(t('tool_calc'), t('tool_calc_d'), inp, el('div', { class: 'calc' }, keys.map((k) => el('button', { class: 'btn', type: 'button', onclick: () => { if (k === 'C') { inp.value = ''; out.textContent = '—'; } else { inp.value += k; } inp.focus(); } }, k)), el('button', { class: 'btn primary', style: 'grid-column:span 4', type: 'button', onclick: run }, '=')), out);
}
function units() {
  const cat = el('select', { id: 'u-cat', 'aria-label': t('category') }, Object.keys(UNITS).map((c) => el('option', { value: c }, t('uc_' + c))));
  const from = el('select', { id: 'u-from', 'aria-label': t('from') }), to = el('select', { id: 'u-to', 'aria-label': t('to') });
  const val = el('input', { type: 'number', id: 'u-val', value: '1', step: 'any', class: 'ltr', 'aria-label': t('value') });
  const out = el('div', { class: 'big ltr', 'aria-live': 'polite' });
  const fill = () => { for (const s of [from, to]) s.replaceChildren(...Object.keys(UNITS[cat.value]).map((u) => el('option', { value: u }, u))); to.selectedIndex = Math.min(1, to.options.length - 1); run(); };
  const run = () => { try { out.textContent = `${convert(cat.value, from.value, to.value, Number(val.value))} ${to.value}`; } catch { out.textContent = '—'; } };
  cat.onchange = fill; for (const x of [from, to, val]) x.oninput = run; fill();
  return section(t('tool_units'), null, el('div', { class: 'cols' }, cat, val), el('div', { class: 'cols' }, from, to), out);
}
function dates() {
  const a = el('div', { class: 'big', style: 'font-size:18px' }), b = el('div', { class: 'd ltr' });
  const tick = () => { const n = new Date(); a.textContent = persianDate(n, S.lang); b.textContent = n.toLocaleDateString('en-GB', { dateStyle: 'full' }); };
  tick(); return section(t('tool_date'), t('tool_date_d'), a, b);
}
function worldClock() {
  const rows = CITIES.map((c) => ({ c, time: el('b', { class: 'ltr' }), day: el('span', { class: 'd' }) }));
  const tick = () => { const n = new Date(); for (const r of rows) { r.time.textContent = new Intl.DateTimeFormat('en-GB', { timeStyle: 'medium', timeZone: r.c.tz }).format(n); r.day.textContent = new Intl.DateTimeFormat(S.lang === 'fa' ? 'fa-IR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: r.c.tz }).format(n); } };
  tick(); const id = setInterval(() => { if (!rows[0].time.isConnected) clearInterval(id); else tick(); }, 1000);
  return section(t('tool_clock'), t('tool_clock_d'), rows.map((r) => el('div', { class: 'row', style: 'padding:8px 0' }, el('div', { class: 'grow' }, city(r.c), ' ', r.day), r.time)));
}
function weather() {
  const sel = el('select', { id: 'w-city', 'aria-label': t('city') }, CITIES.map((c) => el('option', { value: c.id }, city(c))));
  const out = el('div', { class: 'stack', 'aria-live': 'polite' });
  const load = async () => {
    const c = CITIES.find((x) => x.id === sel.value);
    out.replaceChildren(chip('connecting'));
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,wind_speed_10m,weather_code&timezone=auto`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error('http');
      const j = await r.json(); const cur = j.current; if (!cur || typeof cur.temperature_2m !== 'number') throw new Error('shape');
      out.replaceChildren(el('div', { class: 'big' }, `${fmtNum(cur.temperature_2m)}°C`, ' ', el('span', { class: 'd' }, t('w_' + weatherLabel(cur.weather_code)))),
        el('div', { class: 'd' }, `${t('wind')}: ${fmtNum(cur.wind_speed_10m)} km/h`),
        el('div', { class: 'd' }, `${t('source')}: `, el('a', { href: 'https://open-meteo.com/', target: '_blank', rel: 'noopener noreferrer' }, 'Open-Meteo'), ` · ${t('observed')}: `, el('span', { class: 'ltr' }, String(cur.time).replace('T', ' ')), ` (${j.timezone_abbreviation || j.timezone || ''})`));
    } catch { out.replaceChildren(el('div', { class: 'note bad' }, t('w_fail'))); }
  };
  sel.onchange = load; load();
  return section(t('tool_weather'), t('tool_weather_d'), sel, out);
}
const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'TRY', 'CAD', 'AUD', 'CHF', 'JPY', 'CNY', 'SAR', 'INR', 'RUB'];
let ratesCache = null; // { base, at(ms), data }
async function fetchRates(base) {
  if (ratesCache && ratesCache.base === base && Date.now() - ratesCache.at < 3600e3) return ratesCache.data;
  const r = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('http');
  const j = await r.json();
  if (j.result !== 'success' || !j.rates || typeof j.rates !== 'object') throw new Error('shape');
  ratesCache = { base, at: Date.now(), data: j };
  return j;
}
function currency() {
  const amount = el('input', { id: 'cur-amt', type: 'text', inputmode: 'decimal', value: '1', 'aria-label': t('cur_amount'), class: 'ltr' });
  const opt = (c, sel) => el('option', { value: c, selected: sel ? true : null }, c);
  const from = el('select', { id: 'cur-from', 'aria-label': t('cur_from') }, CURRENCIES.map((c) => opt(c, c === 'USD')));
  const to = el('select', { id: 'cur-to', 'aria-label': t('cur_to') }, CURRENCIES.map((c) => opt(c, c === 'EUR')));
  const out = el('div', { class: 'stack', 'aria-live': 'polite' });
  const run = async () => {
    out.replaceChildren(chip('connecting'));
    try {
      const v = parseFloat(normalizeDigits(amount.value));
      if (!Number.isFinite(v)) throw new Error('amount');
      const j = await fetchRates(from.value);
      const rate = j.rates[to.value];
      if (typeof rate !== 'number') throw new Error('shape');
      const res = Math.round(v * rate * 1e6) / 1e6;
      out.replaceChildren(el('div', { class: 'big ltr' }, `${fmtNum(v)} ${from.value} = ${fmtNum(res)} ${to.value}`),
        el('div', { class: 'd' }, `${t('cur_rate')}: `, el('span', { class: 'ltr' }, `1 ${from.value} = ${rate} ${to.value}`)),
        el('div', { class: 'd' }, `${t('source')}: `, el('a', { href: 'https://www.exchangerate-api.com', target: '_blank', rel: 'noopener noreferrer' }, 'Rates By Exchange Rate API'), ` · ${t('cur_updated')}: `, el('span', { class: 'ltr' }, String(j.time_last_update_utc || '—')),
          j.time_next_update_utc ? ` · ${t('cur_next')}: ` : null, j.time_next_update_utc ? el('span', { class: 'ltr' }, String(j.time_next_update_utc)) : null));
    } catch { out.replaceChildren(el('div', { class: 'note bad' }, t('cur_fail'))); }
  };
  amount.onchange = run; from.onchange = run; to.onchange = run; run();
  return section(t('tool_currency'), t('tool_currency_d'), el('div', { class: 'cols' }, amount, from, to), out);
}
function riddles() {
  let i = randInt(RIDDLES.length);
  const q = el('div', { class: 'big', style: 'font-size:17px' }), ans = el('input', { type: 'text', id: 'r-ans', 'aria-label': t('answer'), autocomplete: 'off' }), fb = el('div', { 'aria-live': 'polite' });
  const show = () => { q.textContent = RIDDLES[i][S.lang]; ans.value = ''; fb.textContent = ''; };
  const check = () => { const ok = checkRiddle(RIDDLES[i], ans.value); fb.replaceChildren(ok ? chip('ok', t('correct')) : chip('error', t('try_again'))); };
  ans.addEventListener('keydown', (e) => e.key === 'Enter' && check()); show();
  return section(t('tool_riddle'), null, q, ans, el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, el('button', { class: 'btn primary', onclick: check }, t('check')), el('button', { class: 'btn', onclick: () => { fb.textContent = RIDDLES[i].a[0]; } }, t('reveal')), el('button', { class: 'btn', onclick: () => { i = (i + 1 + randInt(RIDDLES.length - 1)) % RIDDLES.length; show(); } }, t('next'))), fb);
}
function guessGame() {
  let secret = 1 + randInt(100), tries = 0;
  const inp = el('input', { type: 'number', id: 'g-in', min: '1', max: '100', class: 'ltr', 'aria-label': t('guess') }), fb = el('div', { 'aria-live': 'polite' });
  const go = () => { const g = Number(inp.value); if (!Number.isInteger(g) || g < 1 || g > 100) { fb.textContent = t('guess_range'); return; } tries++; const h = guessHint(secret, g); fb.replaceChildren(chip(h === 'correct' ? 'ok' : 'warn', h === 'correct' ? t('guess_win', { n: fmtNum(tries) }) : t('guess_' + h))); if (h === 'correct') { secret = 1 + randInt(100); tries = 0; } };
  return section(t('tool_guess'), t('tool_guess_d'), inp, el('button', { class: 'btn primary', onclick: go }, t('guess')), fb);
}
function rps() {
  const fb = el('div', { 'aria-live': 'polite' }); let w = 0, l = 0, d = 0; const score = el('div', { class: 'd' });
  const play = (p) => { const b = RPS[randInt(3)]; const r = rpsResult(p, b); if (r === 'win') w++; else if (r === 'lose') l++; else d++; fb.replaceChildren(el('b', {}, `${t('rps_' + p)} ⟷ ${t('rps_' + b)}`), ' ', chip(r === 'win' ? 'ok' : r === 'lose' ? 'error' : 'warn', t('rps_' + r))); score.textContent = `${t('rps_win')}: ${fmtNum(w)} · ${t('rps_lose')}: ${fmtNum(l)} · ${t('rps_draw')}: ${fmtNum(d)}`; };
  return section(t('tool_rps'), null, el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, RPS.map((x) => el('button', { class: 'btn', onclick: () => play(x) }, t('rps_' + x)))), fb, score);
}
function facts() {
  let i = randInt(FACTS.length); const p = el('p', { style: 'margin:0' });
  const show = () => { p.textContent = FACTS[i][S.lang]; }; show();
  return section(t('tool_facts'), t('tool_facts_d'), p, el('button', { class: 'btn', onclick: () => { i = (i + 1 + randInt(FACTS.length - 1)) % FACTS.length; show(); } }, t('next')));
}
export function tools() {
  return el('div', { class: 'stack' },
    el('div', { class: 'note' }, t('tools_offline')),
    el('div', { class: 'cols' }, calculator(), units()), el('div', { class: 'cols' }, dates(), worldClock()), weather(), currency(),
    unavailableBox('tool_prices', t('cap_live_prices')),
    el('div', { class: 'cols' }, riddles(), guessGame(), rps(), facts()),
    unavailableBox('cap_levels_leaderboard_t', t('cap_levels_leaderboard')));
}
