// Unit test per pausa/ripresa dei timer (#260).
//
// Prima di questo fix il campo `paused` era codice morto: la struttura dati e il
// rendering ("(in pausa)") lo prevedevano, ma non esisteva alcuna funzione per
// portarlo a true. Qui verifichiamo il comportamento REALE:
//   - pauseTimer congela il tempo rimanente (remainingMs) e marca paused:true;
//   - il tempo rimanente NON scorre mentre è in pausa (l'avanzare del "now" non
//     lo scala);
//   - resumeTimer ricalcola endsAt = adesso + remainingMs (riparte da dov'era) e
//     rimuove il campo temporaneo;
//   - le sveglie (kind:'alarm') NON sono mettibili in pausa (orario assoluto).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

// Mock minimale di chrome.storage.local (in-memory) PRIMA di caricare il modulo.
const store = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (typeof key === 'string') return { [key]: store[key] };
        return { ...store };
      },
      async set(obj) { Object.assign(store, obj); },
    },
  },
};

require(join(root, 'src', 'shared', 'constants.js'));
require(join(root, 'src', 'shared', 'filoMemory.js'));

const M = globalThis.SN_FILO_MEMORY;
const KEYS = globalThis.SN_CONST.STORAGE_KEYS;

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

test('il modulo espone pauseTimer e resumeTimer', () => {
  assert.equal(typeof M.pauseTimer, 'function');
  assert.equal(typeof M.resumeTimer, 'function');
});

test('pauseTimer porta paused a true e congela il tempo rimanente', async () => {
  const t = await M.addTimer({ label: 'Pasta', seconds: 600 });
  assert.equal(t.paused, false, 'un timer nuovo non è in pausa');

  await M.pauseTimer(t.id);
  const [pausedTimer] = await M.listTimers();
  assert.equal(pausedTimer.paused, true, 'dopo pauseTimer il campo paused è true');
  assert.ok(Number.isFinite(pausedTimer.remainingMs), 'salva il tempo rimanente');
  // ~600s residui (tolleranza generosa per il tempo di esecuzione del test).
  assert.ok(pausedTimer.remainingMs > 590_000 && pausedTimer.remainingMs <= 600_000,
    `remainingMs (${pausedTimer.remainingMs}) coerente coi ~600s residui`);
});

test('il tempo rimanente NON scorre mentre il timer è in pausa', async () => {
  const t = await M.addTimer({ label: 'x', seconds: 300 });
  await M.pauseTimer(t.id);
  const before = (await M.listTimers())[0].remainingMs;
  await new Promise((r) => setTimeout(r, 60));
  const after = (await M.listTimers())[0].remainingMs;
  assert.equal(before, after, 'in pausa il tempo residuo resta invariato');
});

test('resumeTimer riporta paused a false, ricalcola la scadenza e pulisce remainingMs', async () => {
  const t = await M.addTimer({ label: 'x', seconds: 120 });
  await M.pauseTimer(t.id);
  await new Promise((r) => setTimeout(r, 50)); // attesa in pausa: non deve rubare tempo
  await M.resumeTimer(t.id);

  const [resumed] = await M.listTimers();
  assert.equal(resumed.paused, false, 'dopo resume non è più in pausa');
  assert.equal(resumed.remainingMs, undefined, 'il campo temporaneo è rimosso');
  const remaining = new Date(resumed.endsAt).getTime() - Date.now();
  // Riparte dai ~120s congelati, non da 120 - (tempo passato in pausa).
  assert.ok(remaining > 118_000 && remaining <= 120_000,
    `alla ripresa restano ~120s (${Math.round(remaining / 1000)}s), non scalati dall'attesa in pausa`);
});

test('gcTimers non fa scattare (ringing) un timer in pausa anche se la scadenza originale è passata', async () => {
  const t = await M.addTimer({ label: 'x', seconds: 1 });
  await M.pauseTimer(t.id);
  await new Promise((r) => setTimeout(r, 1100)); // supera la scadenza originale
  const list = await M.gcTimers();
  const g = list.find((x) => x.id === t.id);
  assert.equal(g.paused, true);
  assert.ok(!g.ringing, 'un timer in pausa non suona');
});

test('addTimer rifiuta una durata non positiva o non interpretabile e non crea nulla', async () => {
  // Regressione #245: prima un Math.max(1, …) forzava il minimo a 1s, rendendo la
  // guardia `if (sec <= 0) return null` irraggiungibile — un input malformato
  // creava un timer di 1s che suonava subito, invece di essere scartato.
  for (const bad of [0, -5, NaN, undefined, null, 'ciao', {}]) {
    const t = await M.addTimer({ label: 'x', seconds: bad });
    assert.equal(t, null, `seconds=${JSON.stringify(bad)} non deve creare un timer`);
    assert.deepEqual(await M.listTimers(), [], 'nessun timer fasullo salvato in storage');
  }
});

test('addTimer crea il timer per una durata valida (>= 1s)', async () => {
  const t = await M.addTimer({ label: 'Pasta', seconds: 90 });
  assert.ok(t && t.id, 'una durata valida produce un timer');
  const remaining = new Date(t.endsAt).getTime() - Date.now();
  assert.ok(remaining > 88_000 && remaining <= 90_000, `~90s residui (${Math.round(remaining / 1000)}s)`);
  const [stored] = await M.listTimers();
  assert.equal(stored.id, t.id, 'il timer è persistito');
});

test('le sveglie (kind alarm) non sono mettibili in pausa', async () => {
  const a = await M.addAlarm({ label: 'sveglia', time: '23:59' });
  assert.ok(a && a.kind === 'alarm');
  await M.pauseTimer(a.id);
  const [stored] = await M.listTimers();
  assert.equal(stored.paused, false, 'una sveglia resta non in pausa');
});
