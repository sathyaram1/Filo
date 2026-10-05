// Verifica locale letture-delta, giro 3, rilievo 1: con l'orologio del PC avanti di tre minuti, una scrittura
// fatta DURANTE la lettura completa su un feedback già letto non arriva coi giri del minuto, se dopo di lei
// un altro feedback, letto in una pagina successiva, è stato scritto. Senza rete: Firestore finto a pagine.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
require(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'shared', 'feedbackLive.js'));
const LIVE = globalThis.SN_FEEDBACK_LIVE;

test('orologio avanti di tre minuti: una scrittura durante la lettura completa arriva al giro dopo', async () => {
  let reale = Date.parse('2026-10-05T10:00:00Z');
  const scarto = 3 * 60e3;
  const docs = new Map();
  for (let i = 0; i < 30; i += 1) {
    const id = `d${String(i).padStart(2, '0')}`;
    const vecchia = new Date(reale - 3600e3).toISOString();
    docs.set(id, { _id: id, _updateTime: vecchia, updatedAt: vecchia });
  }
  const scrivi = (id) => {
    reale += 1;
    const t = new Date(reale).toISOString();
    docs.set(id, { _id: id, _updateTime: t, updatedAt: t });
  };
  const w = LIVE.makeWatcher({
    now: () => reale + scarto,
    listVersions: async () => ({ versions: [...docs.values()], complete: true, readTime: new Date(reale).toISOString() }),
    listChangedSince: async ({ since }) => {
      reale += 50;
      return {
        rows: [...docs.values()].filter((d) => Date.parse(d.updatedAt) > Date.parse(since)).map((d) => ({ ...d })),
        complete: true,
        readTime: new Date(reale).toISOString(),
      };
    },
  });

  // La lettura completa, a pagine da dieci: dopo la prima pagina il server scrive d03 (già letto) e poi d25.
  const inizio = reale + scarto;
  const ids = [...docs.keys()].sort();
  const righe = [];
  for (let p = 0; p < 3; p += 1) {
    for (const id of ids.slice(p * 10, p * 10 + 10)) righe.push({ ...docs.get(id) });
    reale += 4000;
    if (p === 0) { scrivi('d03'); reale += 1000; scrivi('d25'); }
  }
  w.allineato(inizio, righe);

  const arrivati = new Set();
  for (let k = 0; k < 3; k += 1) {
    reale += 60e3;
    // eslint-disable-next-line no-await-in-loop
    const giro = await w.tick({ force: true });
    for (const r of giro.rows || []) arrivati.add(r._id);
  }
  expect([...arrivati]).toContain('d03');
});
