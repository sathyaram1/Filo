// Prova del giro 2, rilievo 4 (verifica locale, letture-delta): con l'orologio del PC avanti, una scrittura
// firmata da un'altra macchina con l'orologio pochi secondi indietro deve arrivare al giro dopo, come succede
// con l'orologio giusto. Non apre Filo: Firestore è una mappa che filtra per `updatedAt` come la domanda vera.

import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function firestoreFinto() {
  const docs = new Map();
  let orologio = Date.parse('2026-10-04T10:00:00Z');
  const iso = (ms) => new Date(ms).toISOString();
  for (let i = 0; i < 3; i += 1) docs.set(`d${i}`, { _id: `d${i}`, ut: orologio - 3600e3, upd: orologio - 3600e3 });
  const riga = (d) => ({ _id: d._id, _updateTime: iso(d.ut), updatedAt: iso(d.upd) });
  return {
    ora: () => orologio,
    avanza(ms) { orologio += ms; },
    // `firma`: l'ora scritta da chi scrive col suo orologio; `_updateTime` resta quella del server.
    scrivi(id, firma) { orologio += 1; docs.set(id, { _id: id, ut: orologio, upd: firma }); },
    listVersions: async () => ({ versions: [...docs.values()].map(riga), complete: true, readTime: iso(orologio) }),
    listChangedSince: async ({ since }) => ({
      rows: [...docs.values()].filter((d) => d.upd > Date.parse(since)).map(riga),
      complete: true,
      readTime: iso(orologio),
    }),
  };
}

for (const [nome, avanti] of [['orologio giusto', 0], ['orologio del PC avanti di tre minuti', 3 * 60e3]]) {
  test(`${nome}: una scrittura firmata con dieci secondi di ritardo arriva al giro dopo`, async () => {
    await import(pathToFileURL(resolve(ROOT, 'src/shared/feedbackLive.js')).href);
    const LIVE = globalThis.SN_FEEDBACK_LIVE;
    const fs = firestoreFinto();
    const w = LIVE.makeWatcher({ ...fs, now: () => fs.ora() + avanti, pollMs: 1000, reconcileMs: 3600e3 });
    expect((await w.tick({ force: true })).kind).toBe('reconcile');
    fs.avanza(5000);
    fs.scrivi('d1', fs.ora() - 10000);
    fs.avanza(55000);
    const giro = await w.tick({ force: true });
    expect(giro.rows.map((r) => r._id)).toEqual(['d1']);
  });
}
