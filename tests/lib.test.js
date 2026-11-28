import test from 'node:test';
import assert from 'node:assert/strict';
import { calc, convert, weatherLabel, checkRiddle, RIDDLES, rpsResult, guessHint, randInt, persianDate, normalizeDigits, CITIES } from '../assets/lib.js';

test('calculator evaluates precedence, powers, percent, functions, Persian digits', () => {
  assert.equal(calc('2+3*4'), 14);
  assert.equal(calc('(2+3)*4'), 20);
  assert.equal(calc('2^3^2'), 512);
  assert.equal(calc('-2^2'), -4);
  assert.equal(calc('50%'), 0.5);
  assert.equal(calc('sqrt(16)+abs(-3)'), 7);
  assert.equal(calc('۲×۳'), 6);
  assert.equal(calc('0.1+0.2'), 0.3);
  assert.equal(calc('pi'), 3.141592653590);
});
test('calculator rejects code, junk and non-finite results', () => {
  for (const bad of ['', '1/0', '2+', '(1', 'alert(1)', 'process.exit()', '1;2', 'constructor', '2**3x', 'a'.repeat(300)]) assert.throws(() => calc(bad), undefined, bad);
});
test('unit conversion', () => {
  assert.equal(convert('length', 'km', 'm', 1.5), 1500);
  assert.equal(convert('temperature', 'c', 'f', 100), 212);
  assert.equal(convert('temperature', 'k', 'c', 273.15), 0);
  assert.equal(convert('mass', 'lb', 'kg', 1), 0.45359237);
  assert.throws(() => convert('length', 'km', 'kg', 1));
  assert.throws(() => convert('nope', 'a', 'b', 1));
  assert.throws(() => convert('length', 'km', 'm', NaN));
});
test('weather codes map to categories', () => {
  assert.equal(weatherLabel(0), 'clear'); assert.equal(weatherLabel(61), 'rain'); assert.equal(weatherLabel(95), 'storm'); assert.equal(weatherLabel(999), 'unknown');
});
test('riddle checking ignores case/spacing/arabic letters', () => {
  assert.equal(checkRiddle(RIDDLES[3], ' فردا '), true);
  assert.equal(checkRiddle(RIDDLES[3], 'Tomorrow'), true);
  assert.equal(checkRiddle(RIDDLES[3], 'دیروز'), false);
});
test('rock paper scissors and guess hints', () => {
  assert.equal(rpsResult('rock', 'scissors'), 'win'); assert.equal(rpsResult('rock', 'paper'), 'lose'); assert.equal(rpsResult('paper', 'paper'), 'draw');
  assert.equal(guessHint(50, 30), 'higher'); assert.equal(guessHint(50, 70), 'lower'); assert.equal(guessHint(50, 50), 'correct');
});
test('randInt stays in range and covers values', () => {
  const seen = new Set(); for (let i = 0; i < 300; i++) { const v = randInt(3); assert.ok(v >= 0 && v < 3); seen.add(v); } assert.equal(seen.size, 3);
});
test('persian date is rendered in the Persian calendar', () => {
  const s = persianDate(new Date('2026-03-21T12:00:00Z'), 'en');
  assert.match(s, /Farvardin|1405|AP/i);
  assert.ok(persianDate(new Date(), 'fa').length > 5);
});
test('city table is sane', () => { for (const c of CITIES) { assert.ok(Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180); new Intl.DateTimeFormat('en', { timeZone: c.tz }); } assert.equal(normalizeDigits('٣'), '3'); });
