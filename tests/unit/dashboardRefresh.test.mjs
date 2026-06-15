// Unit test per src/shared/dashboardRefresh.js (#155).
//
// È il cuore della logica che evita di rigenerare la home (con l'LLM) a ogni
// apertura di scheda. Due cose da garantire:
//   1) la FIRMA cambia quando cambiano gli input "veri" (lezioni/memorie/appunti/
//      salvati/notifiche/timer/n.tab) e NON cambia per i campi temporali;
//   2) lo SCHEDULER ricalcola al massimo una volta ogni intervallo, accorpando
//      tutte le richieste nel mezzo (coalesce) e tenendo il contesto più recente.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'dashboardRefresh.js'));

const D = globalThis.SN_DASHBOARD_REFRESH;

test('il modulo espone la sua API', () => {
  assert.ok(D);
  assert.equal(typeof D.computeSignature, 'function');
  assert.equal(typeof D.createScheduler, 'function');
});

// ─── firma ──────────────────────────────────────────────────────────────────

const baseInputs = {
  profilo: 'PM di Filo',
  preferenze: 'risposte brevi',
  espansioni: '',
  lezioni: 'lezione A',
  noteIds: ['n1', 'n2'],
  notificaIds: ['x1'],
  salvatiUrls: ['https://a.com', 'https://b.com'],
  timerIds: ['t1:pranzo:0'],
  openTabsCount: 2,
};

test('stessi input → stessa firma (stabile e deterministica)', () => {
  assert.equal(D.computeSignature(baseInputs), D.computeSignature({ ...baseInputs }));
});

test('cambiano le lezioni → la firma cambia (si ricalcola)', () => {
  const a = D.computeSignature(baseInputs);
  const b = D.computeSignature({ ...baseInputs, lezioni: 'lezione A + B' });
  assert.notEqual(a, b);
});

test('cambiano memoria / appunti / salvati / notifiche / timer / n.tab → firma diversa', () => {
  const a = D.computeSignature(baseInputs);
  assert.notEqual(a, D.computeSignature({ ...baseInputs, profilo: 'altro' }));
  assert.notEqual(a, D.computeSignature({ ...baseInputs, noteIds: ['n1', 'n2', 'n3'] }));
  assert.notEqual(a, D.computeSignature({ ...baseInputs, salvatiUrls: ['https://a.com'] }));
  assert.notEqual(a, D.computeSignature({ ...baseInputs, notificaIds: [] }));
  assert.notEqual(a, D.computeSignature({ ...baseInputs, timerIds: ['t1:cena:0'] }));
  assert.notEqual(a, D.computeSignature({ ...baseInputs, openTabsCount: 3 }));
});

test('campi temporali NON fanno parte della firma (niente ricalcoli a vuoto)', () => {
  // computeSignature ignora qualunque chiave non elencata: passare un "ora" che
  // cambia non deve cambiare la firma.
  const a = D.computeSignature({ ...baseInputs, ora: '10:00', countdown: 120 });
  const b = D.computeSignature({ ...baseInputs, ora: '10:01', countdown: 5 });
  assert.equal(a, b);
});

// ─── scheduler: orologio + timer finti ───────────────────────────────────────

function fakeHarness() {
  let now = 1000;
  let nextId = 1;
  const timers = new Map(); // id -> { at, fn }
  const runs = [];          // contesti passati a run(), in ordine
  const sched = D.createScheduler({
    minIntervalMs: 100,
    now: () => now,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    run: async (ctx) => { runs.push(ctx); },
  });
  // Avanza l'orologio e fa scattare i timer scaduti (uno alla volta, in ordine).
  async function advance(ms) {
    now += ms;
    let fired = true;
    while (fired) {
      fired = false;
      for (const [id, t] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) { timers.delete(id); fired = true; await t.fn(); break; }
      }
    }
  }
  return { sched, advance, runs, setNow: (v) => { now = v; }, getNow: () => now };
}

test('la PRIMA richiesta parte subito (nessun run precedente)', async () => {
  const h = fakeHarness();
  h.sched.request('ctx0');
  await h.advance(0); // il timer è armato a wait=0
  assert.deepEqual(h.runs, ['ctx0']);
});

test('più richieste ravvicinate → UN solo run, col contesto più recente (coalesce)', async () => {
  const h = fakeHarness();
  h.sched.markRan();            // un run è appena avvenuto: parte il throttle
  h.sched.request('a');
  h.sched.request('b');
  h.sched.request('c');         // tutte entro la finestra di 100ms
  await h.advance(50);
  assert.deepEqual(h.runs, [], 'non deve ancora aver girato (throttle)');
  await h.advance(60);          // ora sono passati >100ms dal markRan
  assert.deepEqual(h.runs, ['c'], 'un solo run, con l’ultimo contesto');
});

test('rispetta il tetto: due ondate separate → due run distanziati di >= intervallo', async () => {
  const h = fakeHarness();
  h.sched.request('uno');       // primo run subito
  await h.advance(0);
  assert.deepEqual(h.runs, ['uno']);

  h.sched.request('due');       // subito dopo: deve aspettare l'intervallo
  await h.advance(30);
  assert.deepEqual(h.runs, ['uno'], 'troppo presto: ancora un solo run');
  await h.advance(80);          // totale ~110ms dal primo run
  assert.deepEqual(h.runs, ['uno', 'due']);
});

test('una richiesta arrivata DURANTE un run produce un run successivo', async () => {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const runs = [];
  let sched;
  sched = D.createScheduler({
    minIntervalMs: 100,
    now: () => now,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id) => timers.delete(id),
    run: async (ctx) => {
      runs.push(ctx);
      // Simula una modifica agli input mentre il ricalcolo è in corso.
      if (runs.length === 1) sched.request('secondo');
    },
  });
  async function advance(ms) {
    now += ms;
    let fired = true;
    while (fired) {
      fired = false;
      for (const [id, t] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) { timers.delete(id); fired = true; await t.fn(); break; }
      }
    }
  }
  sched.request('primo');
  await advance(0);             // run('primo'); durante il run arriva 'secondo'
  assert.deepEqual(runs, ['primo'], 'il secondo non parte mentre il primo gira');
  await advance(200);           // passato l'intervallo: parte il run accodato
  assert.deepEqual(runs, ['primo', 'secondo']);
});
