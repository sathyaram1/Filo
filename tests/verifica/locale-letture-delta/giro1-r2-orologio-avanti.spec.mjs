// Prova del giro 1 (verifica locale, letture-delta): con l'orologio del PC avanti di qualche minuto il giro dei
// cambiati non vede le scritture firmate dal server. Non apre Filo: Firestore è una mappa in memoria che filtra
// per `updatedAt` con l'ora del server, come la domanda vera.

import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function live() {
  await import(pathToFileURL(resolve(ROOT, 'src/shared/feedbackLive.js')).href);
  return globalThis.SN_FEEDBACK_LIVE;
}

// Il server firma con la SUA ora (Date.now() reale); il PC di chi guarda può essere avanti.
function firestoreFinto() {
  const docs = new Map();
  for (let i = 0; i < 5; i += 1) docs.set(`d${i}`, { _id: `d${i}`, updatedAtMs: Date.now() - 3600e3, v: 1 });
  const riga = (d) => ({ _id: d._id, _updateTime: `v${d.v}`, updatedAt: new Date(d.updatedAtMs).toISOString() });
  return {
    scriviDalServer(id) {
      const d = docs.get(id) || { _id: id, v: 0 };
      d.v += 1;
      d.updatedAtMs = Date.now();
      docs.set(id, d);
    },
    listVersions: async () => ({ versions: [...docs.values()].map(riga), complete: true }),
    listChangedSince: async ({ since }) => ({
      rows: [...docs.values()].filter((d) => d.updatedAtMs > Date.parse(since)).map(riga),
      complete: true,
    }),
  };
}

for (const [nome, avanti] of [['orologio giusto', 0], ['orologio del PC avanti di tre minuti', 3 * 60 * 1000]]) {
  test(`${nome}: una scrittura del server dopo il giro arriva al giro dopo`, async () => {
    const LIVE = await live();
    const fs = firestoreFinto();
    const w = LIVE.makeWatcher({
      listVersions: fs.listVersions,
      listChangedSince: fs.listChangedSince,
      now: () => Date.now() + avanti,
      pollMs: 1000,
      reconcileMs: 3600e3,
    });
    expect((await w.tick({ force: true })).kind).toBe('reconcile');
    fs.scriviDalServer('d3');
    fs.scriviDalServer('nuovo');
    const giro = await w.tick({ force: true });
    expect(giro.kind).toBe('changed');
    expect(giro.rows.map((r) => r._id).sort()).toEqual(['d3', 'nuovo']);
  });
}
