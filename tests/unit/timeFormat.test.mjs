// Unit test per src/shared/timeFormat.js (#323).
//
// Due formattatori dei tempi:
//   - fmtCountdown: conto alla rovescia "da orologio". Sotto l'ora M:SS, da
//     un'ora in su H:MM:SS. Il bug era che un timer di ore restava in minuti
//     totali ("120:00" per 2 ore) senza mai passare alle ore.
//   - fmtDurationLabel: etichetta umana per il chip di conferma. Il bug era
//     l'arrotondamento ai minuti che etichettava "0 min" un timer di 30 secondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

require(join(root, 'src', 'shared', 'timeFormat.js'));
const T = globalThis.SN_TIME;

test('si registra su globalThis con la sua API', () => {
  assert.ok(T, 'SN_TIME assente');
  assert.equal(typeof T.fmtCountdown, 'function');
  assert.equal(typeof T.fmtDurationLabel, 'function');
});

// ─── fmtCountdown ───────────────────────────────────────────────────────────

test('countdown sotto l\'ora resta M:SS', () => {
  assert.equal(T.fmtCountdown(0), '0:00');
  assert.equal(T.fmtCountdown(5), '0:05');
  assert.equal(T.fmtCountdown(65), '1:05');
  assert.equal(T.fmtCountdown(59 * 60 + 59), '59:59');
});

test('countdown da un\'ora in su passa a H:MM:SS (il bug di #323)', () => {
  // 2 ore: prima usciva "120:00", ora "2:00:00".
  assert.equal(T.fmtCountdown(7200), '2:00:00');
  assert.equal(T.fmtCountdown(3600), '1:00:00');
  assert.equal(T.fmtCountdown(3661), '1:01:01');
  // 8 ore: prima "480:00".
  assert.equal(T.fmtCountdown(8 * 3600), '8:00:00');
  assert.equal(T.fmtCountdown(2 * 3600 + 5 * 60 + 9), '2:05:09');
});

test('countdown: negativi e valori sporchi → 0:00', () => {
  assert.equal(T.fmtCountdown(-10), '0:00');
  assert.equal(T.fmtCountdown(NaN), '0:00');
  assert.equal(T.fmtCountdown('abc'), '0:00');
});

// ─── fmtDurationLabel ───────────────────────────────────────────────────────

test('label sotto il minuto resta in secondi (niente "0 min")', () => {
  assert.equal(T.fmtDurationLabel(30), '30 sec');
  assert.equal(T.fmtDurationLabel(1), '1 sec');
  assert.equal(T.fmtDurationLabel(59), '59 sec');
});

test('label in minuti, con secondi solo se presenti', () => {
  assert.equal(T.fmtDurationLabel(60), '1 min');
  assert.equal(T.fmtDurationLabel(300), '5 min');
  assert.equal(T.fmtDurationLabel(90), '1 min 30 sec');
});

test('label in ore, con minuti solo se presenti', () => {
  assert.equal(T.fmtDurationLabel(7200), '2 h');
  assert.equal(T.fmtDurationLabel(3600), '1 h');
  assert.equal(T.fmtDurationLabel(3600 + 30 * 60), '1 h 30 min');
  assert.equal(T.fmtDurationLabel(8 * 3600), '8 h');
});

test('label: valori sporchi → 0 sec', () => {
  assert.equal(T.fmtDurationLabel(NaN), '0 sec');
  assert.equal(T.fmtDurationLabel(-5), '0 sec');
});
