// Il giro dei cambiati della Gestione (#676) prende il confine dall'ora del server, non da quella del PC: con
// l'orologio avanti di tre minuti non vedeva più niente. E il margine riletto non torna come cambiamento. Senza rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared');
require(join(SRC, 'feedbackLive.js'));
const LIVE = globalThis.SN_FEEDBACK_LIVE;

// Firestore finto: `_updateTime` è il commit, con l'ora del server (Date.now() vero); `readTime` l'ora della lettura.
// Le ore crescono sempre, come i microsecondi di Firestore: al millesimo una scrittura subito dopo la lettura
// prendeva la stessa ora della lettura e la prova diventava rossa a caso.
function firestore({ conReadTime = false } = {}) {
  const docs = new Map();
  let ultima = 0;
  const istante = () => { ultima = Math.max(Date.now(), ultima + 1); return ultima; };
  const ora = () => new Date(istante()).toISOString();
  for (let i = 0; i < 4; i += 1) docs.set(`d${i}`, { _id: `d${i}`, _updateTime: new Date(Date.now() - 3600e3).toISOString() });
  return {
    scrivi(id) { docs.set(id, { _id: id, _updateTime: ora() }); },
    listVersions: async () => ({ versions: [...docs.values()], complete: true }),
    listChangedSince: async ({ since }) => ({
      rows: [...docs.values()].filter((d) => Date.parse(d._updateTime) > Date.parse(since)).map((d) => ({ ...d })),
      complete: true,
      ...(conReadTime ? { readTime: ora() } : {}),
    }),
  };
}

const ids = (giro) => giro.rows.map((r) => r._id).sort();

for (const conReadTime of [false, true]) {
  for (const scarto of [-5 * 60e3, 0, 3 * 60e3, 60 * 60e3]) {
    test(`orologio del PC spostato di ${scarto / 60e3} minuti${conReadTime ? ', con l\'ora della lettura' : ''}: le scritture del server arrivano tutte`, async () => {
      const fs = firestore({ conReadTime });
      const w = LIVE.makeWatcher({ ...fs, now: () => Date.now() + scarto, pollMs: 1000, reconcileMs: 3600e3 });
      assert.equal((await w.tick({ force: true })).kind, 'reconcile');
      fs.scrivi('d2');
      fs.scrivi('nuovo');
      assert.deepEqual(ids(await w.tick({ force: true })), ['d2', 'nuovo']);
      fs.scrivi('d0');
      assert.deepEqual(ids(await w.tick({ force: true })), ['d0'], 'il margine riletto non torna come cambiamento');
      assert.deepEqual(ids(await w.tick({ force: true })), []);
    });
  }
}

test('dopo una lettura completa della pagina il primo giro prende l\'ora del server dalle righe lette', async () => {
  const fs = firestore();
  const w = LIVE.makeWatcher({ ...fs, now: () => Date.now() + 3 * 60e3, pollMs: 1000, reconcileMs: 3600e3 });
  const { versions } = await fs.listVersions();
  w.allineato(Date.now() + 3 * 60e3, versions);
  fs.scrivi('d1');
  assert.deepEqual(ids(await w.tick({ force: true })), ['d1']);
});

test('orologio del PC avanti: una scrittura firmata da un orologio dieci secondi indietro arriva al giro dopo', async () => {
  let ora = Date.parse('2026-10-04T10:00:00Z');
  const iso = (ms) => new Date(ms).toISOString();
  const docs = new Map([['d0', { _id: 'd0', ut: ora - 3600e3, upd: ora - 3600e3 }]]);
  const riga = (d) => ({ _id: d._id, _updateTime: iso(d.ut), updatedAt: iso(d.upd) });
  const w = LIVE.makeWatcher({
    listVersions: async () => ({ versions: [...docs.values()].map(riga), complete: true, readTime: iso(ora) }),
    listChangedSince: async ({ since }) => ({ rows: [...docs.values()].filter((d) => d.upd > Date.parse(since)).map(riga), complete: true, readTime: iso(ora) }),
    now: () => ora + 3 * 60e3, pollMs: 1000, reconcileMs: 3600e3,
  });
  assert.equal((await w.tick({ force: true })).kind, 'reconcile');
  ora += 5000;
  docs.set('d1', { _id: 'd1', ut: ora, upd: ora - 10000 });
  ora += 55000;
  assert.deepEqual(ids(await w.tick({ force: true })), ['d1']);
});

// Una lettura completa va a pagine lette in momenti diversi: una scrittura su un feedback già letto, seguita da una
// su uno letto dopo, non deve restare fuori dal giro (verifica locale, giro 3). Vale l'ora della prima pagina.
function letturaAPagine({ conReadTime, pausaMs }) {
  let reale = Date.parse('2026-10-05T10:00:00Z');
  const iso = (ms) => new Date(ms).toISOString();
  const docs = new Map();
  for (let i = 0; i < 30; i += 1) {
    const id = `d${String(i).padStart(2, '0')}`;
    docs.set(id, { _id: id, _updateTime: iso(reale - 3600e3), updatedAt: iso(reale - 3600e3) });
  }
  const scrivi = (id) => { reale += 1; docs.set(id, { _id: id, _updateTime: iso(reale), updatedAt: iso(reale) }); };
  const w = LIVE.makeWatcher({
    now: () => reale + 10 * 60e3,
    listVersions: async () => ({ versions: [...docs.values()], complete: true, readTime: iso(reale) }),
    listChangedSince: async ({ since }) => {
      reale += 50;
      return { rows: [...docs.values()].filter((d) => Date.parse(d.updatedAt) > Date.parse(since)).map((d) => ({ ...d })), complete: true, readTime: iso(reale) };
    },
  });
  const inizio = reale + 10 * 60e3;
  const primaPagina = iso(reale);
  const nomi = [...docs.keys()].sort();
  const righe = [];
  for (let p = 0; p < 3; p += 1) {
    for (const id of nomi.slice(p * 10, p * 10 + 10)) righe.push({ ...docs.get(id) });
    reale += pausaMs;
    if (p === 0) scrivi('d03');
    if (p === 1) scrivi('d25');
  }
  w.allineato(inizio, righe, conReadTime ? primaPagina : undefined);
  return async () => {
    const arrivati = new Set();
    for (let k = 0; k < 2; k += 1) {
      reale += 60e3;
      // eslint-disable-next-line no-await-in-loop
      for (const r of (await w.tick({ force: true })).rows || []) arrivati.add(r._id);
    }
    return arrivati;
  };
}

test('orologio del PC avanti: una scrittura durante la lettura completa, su un feedback già letto, arriva al giro dopo', async () => {
  const arrivati = await letturaAPagine({ conReadTime: false, pausaMs: 4000 })();
  assert.ok(arrivati.has('d03'), `arrivati: ${[...arrivati]}`);
});

test('una lettura completa più lunga del margine: il confine parte dall\'ora della prima pagina', async () => {
  const arrivati = await letturaAPagine({ conReadTime: true, pausaMs: 150e3 })();
  assert.ok(arrivati.has('d03'), `arrivati: ${[...arrivati]}`);
});

test('la lettura completa porta l\'ora della prima pagina', async () => {
  require(join(SRC, 'feedback.js'));
  const FB = globalThis.SN_FEEDBACK;
  const vera = FB.list;
  const pagine = [['a', 'b'], ['c']];
  const ore = ['2026-10-05T10:00:00.000001Z', '2026-10-05T10:01:30.000001Z'];
  let n = 0;
  FB.list = async () => {
    const i = n; n += 1;
    const righe = pagine[i].map((id) => ({ _id: id }));
    Object.defineProperty(righe, 'readTime', { value: ore[i], enumerable: false });
    return righe;
  };
  try {
    const out = await FB.listAllPaged({ pageSize: 2 });
    assert.equal(out.readTime, ore[0]);
  } finally { FB.list = vera; }
});
