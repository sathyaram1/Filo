// #2470: quanto legge in un giorno il giro della Gestione aperta tutto il giorno, contato su un Firestore finto
// (una lettura per documento tornato, una per una domanda vuota, una ogni mille per il conto). Senza rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared');
require(join(SRC, 'feedbackLive.js'));
const LIVE = globalThis.SN_FEEDBACK_LIVE;

const iso = (ms) => new Date(ms).toISOString();

function mondo({ n = 2300, seguiti = 30 } = {}) {
  let ora = Date.parse('2026-11-14T00:00:00Z');
  const docs = new Map();
  for (let i = 0; i < n; i += 1) docs.set(`d${i}`, { _id: `d${i}`, _updateTime: iso(ora - 86400e3), updatedAt: iso(ora - 86400e3) });
  const letture = { totale: 0, completi: 0, controlli: 0 };
  const leggi = (k) => { letture.totale += Math.max(1, k); };
  const seguitiIds = [...docs.keys()].slice(0, seguiti);
  const deps = {
    now: () => ora,
    seguiti: () => seguitiIds,
    listVersions: async () => { letture.completi += 1; leggi(docs.size); return { versions: [...docs.values()].map((d) => ({ ...d })), complete: true, readTime: iso(ora) }; },
    listChangedSince: async ({ since }) => {
      const rows = [...docs.values()].filter((d) => d.updatedAt > since).map((d) => ({ ...d }));
      leggi(rows.length);
      return { rows, complete: true, readTime: iso(ora) };
    },
    versionsOf: async (ids) => { leggi(ids.length); return ids.filter((id) => docs.has(id)).map((id) => ({ _id: id, _updateTime: docs.get(id)._updateTime })); },
    readRows: async (ids) => { leggi(ids.length); return ids.filter((id) => docs.has(id)).map((id) => ({ ...docs.get(id) })); },
    submissionCount: async () => { leggi(1); return null; },
    avviiRoutine: async () => { leggi(1); return []; },
    controlloLeggero: async () => {
      letture.controlli += 1;
      leggi(Math.ceil(docs.size / 1000) + 1);
      const ultimo = [...docs.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
      return { count: docs.size, ultimo: ultimo ? { _id: ultimo._id, _updateTime: ultimo._updateTime } : null };
    },
  };
  return {
    deps, letture, docs,
    avanza: (ms) => { ora += ms; },
    scrivi: (id, { firma = true } = {}) => {
      ora += 1;
      const prima = docs.get(id);
      docs.set(id, { _id: id, _updateTime: iso(ora), updatedAt: firma || !prima ? iso(ora) : prima.updatedAt });
    },
    cancella: (id) => { docs.delete(id); },
  };
}

async function unGiorno(m, w) {
  await w.tick({ force: true });
  for (let minuto = 1; minuto < 24 * 60; minuto += 1) {
    m.avanza(60e3);
    if (minuto % 5 === 0) m.scrivi(`d${minuto % 2000}`);
    // eslint-disable-next-line no-await-in-loop
    await w.tick();
  }
}

test('la Gestione aperta tutto il giorno legge meno di 25 mila documenti', async () => {
  const m = mondo();
  const w = LIVE.makeWatcher(m.deps);
  await unGiorno(m, w);
  assert.ok(m.letture.totale < 25_000, `letture in un giorno: ${m.letture.totale}`);
  assert.equal(m.letture.completi, 4, 'un riallineamento completo ogni sei ore');
  assert.ok(m.letture.controlli >= 40 && m.letture.controlli <= 48, `controlli leggeri: ${m.letture.controlli}`);
});

test('una cancellazione la vede il controllo leggero e fa riallineare', async () => {
  const m = mondo({ n: 50 });
  const w = LIVE.makeWatcher(m.deps);
  await w.tick({ force: true });
  m.cancella('d3');
  for (let i = 0; i < 29; i += 1) { m.avanza(60e3); await w.tick(); } // eslint-disable-line no-await-in-loop
  assert.equal(m.letture.completi, 1, 'prima della mezz\'ora nessun riallineamento');
  m.avanza(60e3);
  await w.tick();
  assert.equal(m.letture.controlli, 1);
  m.avanza(60e3);
  const r = await w.tick();
  assert.equal(r.kind, 'reconcile');
  assert.ok(!r.versions.some((v) => v._id === 'd3'), 'il riallineamento non lo porta più');
});

test('l\'ultimo cambiato senza firma nuova arriva dal controllo leggero', async () => {
  const m = mondo({ n: 50, seguiti: 0 });
  const w = LIVE.makeWatcher(m.deps);
  await w.tick({ force: true });
  m.scrivi('d7');
  m.avanza(60e3);
  await w.tick();
  m.scrivi('d7', { firma: false });
  const arrivati = [];
  for (let i = 0; i < 30; i += 1) {
    m.avanza(60e3);
    // eslint-disable-next-line no-await-in-loop
    for (const r of (await w.tick()).rows || []) arrivati.push(r._id);
  }
  assert.deepEqual(arrivati, ['d7']);
});

test('il margine rilegge un cambio al più due volte', async () => {
  const m = mondo({ n: 10, seguiti: 0 });
  let righe = 0;
  const cambiati = m.deps.listChangedSince;
  const w = LIVE.makeWatcher({ ...m.deps, controlloLeggero: null, listChangedSince: async (a) => { const r = await cambiati(a); righe += r.rows.length; return r; } });
  await w.tick({ force: true });
  m.avanza(50e3);
  m.scrivi('d1');
  for (let i = 0; i < 5; i += 1) { m.avanza(60e3); await w.tick(); } // eslint-disable-line no-await-in-loop
  assert.ok(righe <= 2, `d1 riletto ${righe} volte`);
});

test('i seguiti delle pagine si guardano ogni cinque minuti', async () => {
  const m = mondo({ n: 100, seguiti: 20 });
  const chieste = [];
  const vo = m.deps.versionsOf;
  const w = LIVE.makeWatcher({ ...m.deps, versionsOf: async (ids) => { chieste.push(ids.length); return vo(ids); } });
  await w.tick({ force: true });
  for (let i = 0; i < 10; i += 1) { m.avanza(60e3); await w.tick(); } // eslint-disable-line no-await-in-loop
  assert.deepEqual(chieste, [20, 20]);
});
