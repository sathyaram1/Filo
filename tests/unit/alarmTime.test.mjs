// Unit test per la risoluzione dell'orario delle sveglie (#322).
//
// L'azione SVEGLIA ora programma una scadenza REALE (entra nella lista timer
// con kind 'alarm' e riusa il flusso ringing/suoneria). Il cuore testabile in
// puro Node è la conversione "orario chiesto" → timestamp assoluto:
//   - "HH:MM" → prossima occorrenza (oggi se futura, altrimenti domani);
//   - ISO → quel momento esatto, MAI nel passato;
//   - input non interpretabile → null (l'azione fallisce invece di fingere).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

require(join(root, 'src', 'shared', 'constants.js'));
require(join(root, 'src', 'shared', 'filoMemory.js'));

const M = globalThis.SN_FILO_MEMORY;
const DAY = 24 * 60 * 60 * 1000;

// "now" fisso e riproducibile: oggi alle 12:00 locali.
const now = new Date();
now.setHours(12, 0, 0, 0);
const nowMs = now.getTime();

function at(h, m, dayOffset = 0) {
  const d = new Date(nowMs);
  d.setHours(h, m, 0, 0);
  return d.getTime() + dayOffset * DAY;
}

test('il modulo espone resolveAlarmTime e addAlarm', () => {
  assert.equal(typeof M.resolveAlarmTime, 'function');
  assert.equal(typeof M.addAlarm, 'function');
});

test('HH:MM futuro oggi → oggi', () => {
  assert.equal(M.resolveAlarmTime('18:30', nowMs), at(18, 30));
});

test('HH:MM già passato oggi → domani (sveglia alle 7 chiesta a mezzogiorno)', () => {
  assert.equal(M.resolveAlarmTime('07:00', nowMs), at(7, 0, 1));
});

test('HH:MM esattamente adesso → domani (mai nel passato/istantanea)', () => {
  assert.equal(M.resolveAlarmTime('12:00', nowMs), at(12, 0, 1));
});

test('varianti di formato: "7", "7:30", "7.30", "07:00"', () => {
  assert.equal(M.resolveAlarmTime('7', nowMs), at(7, 0, 1));
  assert.equal(M.resolveAlarmTime('18:5' , nowMs), null); // minuti a 1 cifra: non ambiguo ma fuori formato
  assert.equal(M.resolveAlarmTime('7.30', nowMs), at(7, 30, 1));
  assert.equal(M.resolveAlarmTime(' 18:30 ', nowMs), at(18, 30));
});

test('ISO nel futuro → quel momento esatto', () => {
  const target = new Date(nowMs + 3 * 60 * 60 * 1000); // tra 3 ore
  assert.equal(M.resolveAlarmTime(target.toISOString(), nowMs), target.getTime());
});

test('ISO nel passato → null (niente sveglie già scadute)', () => {
  const past = new Date(nowMs - 60 * 1000);
  assert.equal(M.resolveAlarmTime(past.toISOString(), nowMs), null);
});

test('input non interpretabili → null', () => {
  assert.equal(M.resolveAlarmTime('', nowMs), null);
  assert.equal(M.resolveAlarmTime(null, nowMs), null);
  assert.equal(M.resolveAlarmTime('boh', nowMs), null);
  assert.equal(M.resolveAlarmTime('25:00', nowMs), null);
  assert.equal(M.resolveAlarmTime('12:75', nowMs), null);
});

// ─── addAlarm: entry persistita con scadenza assoluta ───────────────────────

function stubChrome() {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) { return { [key]: store[key] }; },
        async set(obj) { Object.assign(store, obj); },
      },
    },
  };
  return store;
}

test('addAlarm crea una entry kind=alarm con endsAt = orario chiesto', async () => {
  stubChrome();
  const entry = await M.addAlarm({ label: 'lavoro', time: '07:00', nowMs });
  assert.ok(entry);
  assert.equal(entry.kind, 'alarm');
  assert.equal(entry.label, 'lavoro');
  assert.equal(new Date(entry.endsAt).getTime(), at(7, 0, 1));
  assert.equal(entry.paused, false);
  // Persistita nella stessa lista dei timer → eredita gcTimers/ringing.
  const list = await M.listTimers();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, entry.id);
});

test('addAlarm con orario non interpretabile → null e niente entry', async () => {
  stubChrome();
  const entry = await M.addAlarm({ label: 'x', time: 'boh', nowMs });
  assert.equal(entry, null);
  assert.equal((await M.listTimers()).length, 0);
});
