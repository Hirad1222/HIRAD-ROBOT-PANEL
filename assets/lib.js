// Pure, DOM-free helpers for the Tools page (unit-tested in Node).

// ---------- calculator: recursive-descent parser, never uses eval/Function ----------
const FN = { sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, round: Math.round, floor: Math.floor, ceil: Math.ceil };
const CONST = { pi: Math.PI, e: Math.E };
export function normalizeDigits(s) {
  return String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[×✕]/g, '*').replace(/[÷]/g, '/').replace(/٫/g, '.').replace(/[−–]/g, '-');
}
export function calc(input) {
  const src = normalizeDigits(input).toLowerCase().replace(/\s+/g, '');
  if (!src) throw new Error('empty');
  if (src.length > 200) throw new Error('too long');
  let i = 0;
  const peek = () => src[i];
  function num() {
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(src.slice(i));
    if (!m) throw new Error('number expected');
    i += m[0].length; return parseFloat(m[0]);
  }
  function primary() {
    const c = peek();
    if (c === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error('missing )'); i++; return v; }
    if (/[a-z]/.test(c || '')) {
      const m = /^[a-z]+/.exec(src.slice(i))[0]; i += m.length;
      if (m in CONST && peek() !== '(') return CONST[m];
      if (m in FN && peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error('missing )'); i++; return FN[m](v); }
      throw new Error('unknown name');
    }
    return num();
  }
  function unary() { if (peek() === '-') { i++; return -unary(); } if (peek() === '+') { i++; return unary(); } return power(); }
  function power() { const b = primary(); if (peek() === '^') { i++; return Math.pow(b, unary()); } return postfix(b); }
  function postfix(v) { while (peek() === '%') { i++; v /= 100; } return v; }
  function term() { let v = unary(); while (peek() === '*' || peek() === '/') { const o = src[i++]; const r = unary(); v = o === '*' ? v * r : v / r; } return v; }
  function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const o = src[i++]; const r = term(); v = o === '+' ? v + r : v - r; } return v; }
  const v = expr();
  if (i < src.length) throw new Error('unexpected ' + src[i]);
  if (!Number.isFinite(v)) throw new Error('not finite');
  return Math.round(v * 1e12) / 1e12;
}

// ---------- units ----------
export const UNITS = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mile: 1609.344, yard: 0.9144, foot: 0.3048, inch: 0.0254 },
  mass: { kg: 1, g: 0.001, mg: 1e-6, tonne: 1000, lb: 0.45359237, oz: 0.028349523125 },
  volume: { l: 1, ml: 0.001, m3: 1000, gallon: 3.785411784, cup: 0.2365882365 },
  speed: { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, knot: 0.514444444 },
  area: { m2: 1, km2: 1e6, ha: 1e4, acre: 4046.8564224, ft2: 0.09290304 },
  temperature: { c: 1, f: 1, k: 1 },
};
export function convert(cat, from, to, value) {
  const u = UNITS[cat];
  if (!u || !(from in u) || !(to in u) || !Number.isFinite(value)) throw new Error('invalid');
  if (cat === 'temperature') {
    const c = from === 'c' ? value : from === 'f' ? (value - 32) * 5 / 9 : value - 273.15;
    const r = to === 'c' ? c : to === 'f' ? c * 9 / 5 + 32 : c + 273.15;
    return Math.round(r * 1e8) / 1e8;
  }
  return Math.round((value * u[from] / u[to]) * 1e10) / 1e10;
}

// ---------- weather codes (WMO) ----------
export function weatherLabel(code) {
  if (code === 0) return 'clear';
  if (code >= 1 && code <= 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'storm';
  return 'unknown';
}

// ---------- games ----------
export const RIDDLES = [
  { fa: 'چیست که هرچه از آن بیشتر برداری، بزرگ‌تر می‌شود؟', en: 'The more you take from it, the bigger it gets. What is it?', a: ['چاله', 'حفره', 'گودال', 'hole', 'a hole'] },
  { fa: 'چیست که پا دارد ولی راه نمی‌رود؟', en: 'What has legs but cannot walk?', a: ['میز', 'صندلی', 'table', 'chair', 'a table', 'a chair'] },
  { fa: 'چیست که دندان دارد ولی گاز نمی‌گیرد؟', en: 'What has teeth but cannot bite?', a: ['شانه', 'چرخ دنده', 'چرخدنده', 'comb', 'a comb', 'gear', 'a gear'] },
  { fa: 'چیست که همیشه می‌آید ولی هرگز نمی‌رسد؟', en: 'What always comes but never arrives?', a: ['فردا', 'tomorrow'] },
  { fa: 'چیست که شهر دارد ولی خانه ندارد؟', en: 'What has cities but no houses?', a: ['نقشه', 'map', 'a map'] },
  { fa: 'چیست که با خوردنش گرسنه‌تر می‌شوی؟', en: 'What gets wetter the more it dries?', a: ['حوله', 'towel', 'a towel'] },
];
export function checkRiddle(r, answer) {
  const n = (s) => normalizeDigits(s).trim().toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[‌\s]+/g, ' ');
  return r.a.some((x) => n(x) === n(answer));
}
export function randInt(n) { const b = new Uint32Array(1); const lim = Math.floor(0x100000000 / n) * n; do { crypto.getRandomValues(b); } while (b[0] >= lim); return b[0] % n; }
export const RPS = ['rock', 'paper', 'scissors'];
export function rpsResult(player, bot) {
  if (player === bot) return 'draw';
  return (player === 'rock' && bot === 'scissors') || (player === 'paper' && bot === 'rock') || (player === 'scissors' && bot === 'paper') ? 'win' : 'lose';
}
export function guessHint(secret, g) { return g === secret ? 'correct' : g < secret ? 'higher' : 'lower'; }
export const FACTS = [
  { fa: 'عسل تقریباً هرگز فاسد نمی‌شود؛ در مقبره‌های مصر باستان عسل چندهزارساله‌ی خوراکی پیدا شده است.', en: 'Honey almost never spoils; edible honey thousands of years old has been found in ancient Egyptian tombs.' },
  { fa: 'اختاپوس سه قلب دارد.', en: 'An octopus has three hearts.' },
  { fa: 'روز در سیاره‌ی زهره (یک دور چرخش به دور خود) از سال آن (یک دور گردش به دور خورشید) طولانی‌تر است.', en: 'A day on Venus (one rotation) is longer than its year (one orbit of the Sun).' },
  { fa: 'نور خورشید حدود ۸ دقیقه و ۲۰ ثانیه طول می‌کشد تا به زمین برسد.', en: 'Sunlight takes about 8 minutes and 20 seconds to reach Earth.' },
  { fa: 'از نظر گیاه‌شناسی، موز یک «توت» است.', en: 'Botanically, a banana is a berry.' },
  { fa: 'واژه‌ی «الگوریتم» از نام خوارزمی، دانشمند ایرانی، گرفته شده است.', en: 'The word "algorithm" comes from the name of al-Khwarizmi, the Persian scholar.' },
  { fa: 'قله‌ی دماوند با حدود ۵٬۶۰۰ متر ارتفاع بلندترین قله‌ی ایران است.', en: 'Mount Damavand, at about 5,600 metres, is the highest peak in Iran.' },
  { fa: 'ساخت تخت جمشید حدود ۵۱۸ سال پیش از میلاد آغاز شد.', en: 'Construction of Persepolis began around 518 BCE.' },
];
export const CITIES = [
  { id: 'tehran', fa: 'تهران', en: 'Tehran', tz: 'Asia/Tehran', lat: 35.69, lon: 51.39 },
  { id: 'mashhad', fa: 'مشهد', en: 'Mashhad', tz: 'Asia/Tehran', lat: 36.30, lon: 59.61 },
  { id: 'isfahan', fa: 'اصفهان', en: 'Isfahan', tz: 'Asia/Tehran', lat: 32.65, lon: 51.67 },
  { id: 'shiraz', fa: 'شیراز', en: 'Shiraz', tz: 'Asia/Tehran', lat: 29.59, lon: 52.58 },
  { id: 'tabriz', fa: 'تبریز', en: 'Tabriz', tz: 'Asia/Tehran', lat: 38.08, lon: 46.29 },
  { id: 'kabul', fa: 'کابل', en: 'Kabul', tz: 'Asia/Kabul', lat: 34.53, lon: 69.17 },
  { id: 'dubai', fa: 'دبی', en: 'Dubai', tz: 'Asia/Dubai', lat: 25.20, lon: 55.27 },
  { id: 'istanbul', fa: 'استانبول', en: 'Istanbul', tz: 'Europe/Istanbul', lat: 41.01, lon: 28.98 },
  { id: 'moscow', fa: 'مسکو', en: 'Moscow', tz: 'Europe/Moscow', lat: 55.76, lon: 37.62 },
  { id: 'london', fa: 'لندن', en: 'London', tz: 'Europe/London', lat: 51.51, lon: -0.13 },
  { id: 'newyork', fa: 'نیویورک', en: 'New York', tz: 'America/New_York', lat: 40.71, lon: -74.01 },
  { id: 'tokyo', fa: 'توکیو', en: 'Tokyo', tz: 'Asia/Tokyo', lat: 35.68, lon: 139.69 },
];
export const persianDate = (d, lang = 'fa') => new Intl.DateTimeFormat((lang === 'fa' ? 'fa-IR' : 'en-US') + '-u-ca-persian', { dateStyle: 'full', timeZone: 'Asia/Tehran' }).format(d);
