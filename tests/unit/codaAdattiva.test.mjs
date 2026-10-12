// La coda dei lavori in parallelo (#1118): tutti i lavori si fanno, non più di N insieme; un 429 abbassa il tetto e
// il lavoro si riprova; un guasto passeggero si riprova; uno del singolo lavoro si salta; uno definitivo ferma tutto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/codaAdattiva.js');
const { esegui } = globalThis.SN_CODA_ADATTIVA;

const ritardo = (ms) => new Promise((ok) => setTimeout(ok, ms));
const errore = (status, extra = {}) => Object.assign(new Error(`HTTP ${status}`), { status }, extra);
const classifica = (e) => (e.status === 429 ? 'lento' : e.status >= 500 ? 'passeggero' : e.status === 400 ? 'scarta' : 'fatale');

test('fa tutti i lavori, mai più del tetto insieme, e dice ognuno appena è fatto', async () => {
  let attivi = 0;
  let picco = 0;
  const visti = [];
  const r = await esegui(Array.from({ length: 30 }, (_, i) => i), async (x) => {
    attivi++; picco = Math.max(picco, attivi);
    await ritardo(5);
    attivi--;
    return x * 2;
  }, { parallelo: 4, suEsito: (ris, lavoro, i) => visti.push([ris, lavoro, i]) });
  assert.equal(r.fatti, 30);
  assert.equal(r.fermo, null);
  assert.equal(picco, 4);
  assert.equal(visti.length, 30);
  assert.ok(visti.every(([ris, lavoro, i]) => ris === lavoro * 2 && lavoro === i));
});

test('un 429 dimezza il tetto, il lavoro si rifà dopo l\'attesa, e passata la raffica il tetto torna su', async () => {
  let attivi = 0;
  const picchi = [];
  let colpito = false;
  let dopo = false;
  const partenze = [];
  const r = await esegui(Array.from({ length: 60 }, (_, i) => i), async (x) => {
    attivi++;
    if (colpito) partenze.push(attivi);
    try {
      await ritardo(4);
      if (x === 0 && !colpito) { colpito = true; throw errore(429, { retryAfterMs: 1 }); }
      if (colpito) { dopo = true; picchi.push(attivi); }
      return x;
    } finally { attivi--; }
  }, { parallelo: 8, classifica, attesa: () => 1 });
  assert.equal(r.fatti, 60, 'il lavoro rallentato si rifà, non si perde');
  assert.deepEqual(r.scartati, []);
  assert.ok(dopo);
  assert.ok(Math.min(...partenze) <= 4, 'subito dopo il 429 i lavori nuovi partono con un tetto più basso');
  assert.equal(Math.max(...picchi.slice(-12)), 8, 'in coda alla corsa si torna al tetto pieno');
});

test('troppe richieste di continuo: finiti i tentativi di un lavoro si ferma tutto, senza rifare la scala per ogni lavoro', async () => {
  const partiti = new Set();
  const r = await esegui(Array.from({ length: 40 }, (_, i) => i), async (x) => {
    partiti.add(x);
    await ritardo(2);
    throw errore(429);
  }, { parallelo: 4, classifica, tentativi: 3, attesa: () => 1 });
  assert.equal(r.fermo.status, 429);
  assert.equal(r.fatti, 0);
  assert.ok(partiti.size <= 4, `partiti ${partiti.size} lavori: oltre la prima ondata non ne parte nessuno`);
});

test('un guasto passeggero si riprova; finiti i tentativi il lavoro si salta e gli altri continuano', async () => {
  const prove = new Map();
  const r = await esegui(['a', 'b', 'c'], async (x) => {
    prove.set(x, (prove.get(x) || 0) + 1);
    if (x === 'a' && prove.get(x) < 3) throw errore(503);
    if (x === 'b') throw errore(502);
    return x;
  }, { parallelo: 2, classifica, tentativi: 3, attesa: () => 1 });
  assert.equal(prove.get('a'), 3);
  assert.equal(prove.get('b'), 4, 'una volta più i tentativi');
  assert.equal(r.fatti, 2);
  assert.deepEqual(r.scartati.map((s) => s.indice), [1]);
  assert.equal(r.fermo, null);
});

test('un errore del singolo lavoro lo salta; uno definitivo ferma i lavori non ancora partiti', async () => {
  const r1 = await esegui([1, 2, 3], async (x) => { if (x === 2) throw errore(400); return x; }, { parallelo: 1, classifica });
  assert.equal(r1.fatti, 2);
  assert.deepEqual(r1.scartati.map((s) => s.indice), [1]);

  const partiti = [];
  const r2 = await esegui(Array.from({ length: 20 }, (_, i) => i), async (x) => {
    partiti.push(x);
    if (x === 0) throw errore(401);
    await ritardo(2);
    return x;
  }, { parallelo: 2, classifica });
  assert.equal(r2.fermo.status, 401);
  assert.ok(partiti.length < 20, 'dopo un errore definitivo non parte più niente');
});

test('interrotta da fuori si ferma, anche mentre aspetta di riprovare', async () => {
  const ctl = new AbortController();
  const t0 = Date.now();
  const r = await esegui([1, 2, 3, 4], async () => {
    setTimeout(() => ctl.abort(), 5);
    throw errore(429);
  }, { parallelo: 1, classifica, attesa: () => 10000, signal: ctl.signal });
  assert.equal(r.interrotto, true);
  assert.ok(Date.now() - t0 < 2000, 'l\'attesa si rompe con l\'interruzione');
});

test('l\'attesa predefinita segue quella chiesta dal server, con un tetto', () => {
  const { attesaPredefinita, ATTESA_MAX_MS } = globalThis.SN_CODA_ADATTIVA;
  assert.ok(attesaPredefinita(1, { retryAfterMs: 2000 }) >= 2000);
  assert.ok(attesaPredefinita(1, { retryAfterMs: 120000 }) <= ATTESA_MAX_MS);
  assert.ok(attesaPredefinita(3, {}) >= 2000);
});
