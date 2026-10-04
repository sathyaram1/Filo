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
function firestore({ conReadTime = false } = {}) {
  const docs = new Map();
  const ora = () => new Date().toISOString();
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
