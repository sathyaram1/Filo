// Verifica locale di «aspetta #N», giro 2, rilievo 1: chi ha il ramo in revisione e aspetta un feedback chiuso senza
// fusione deve tornare all'owner con la domanda, come chi è in coda; oggi resta fermo fra quelli che aspettano.
// Codice vero del server (filo-security accanto a questo repo); senza il server la prova si dichiara saltata.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NOME = ROOT.replace(/\\/g, '/').split('/').pop();
const FUNZIONI = [
  process.env.FILO_SERVER_REPO || '',
  resolve(ROOT, '..', '..', '..', '..', 'filo-security', '.claude', 'worktrees', NOME),
  resolve(ROOT, '..', 'filo-security'),
  resolve(ROOT, '..', '..', '..', '..', 'filo-security'),
].filter(Boolean).map((d) => resolve(d, 'functions')).find((f) => existsSync(resolve(f, 'src', 'routine', 'waits.js'))) || '';

test('r1 un ramo in revisione che aspetta un feedback archiviato senza fusione torna all\'owner con la domanda', async () => {
  test.skip(!FUNZIONI, 'repo del server assente');
  const req = createRequire(resolve(FUNZIONI, 'package.json'));
  const scritture = [];
  const fs = req('./src/data/firestore.js');
  fs.db = () => ({ __finto: true });
  const fbDocs = req('./src/data/feedbackDocs.js');
  fbDocs.feedbackCol = () => ({ doc: (id) => ({ id }) });
  fbDocs.setFeedback = async (ref, data) => { scritture.push({ id: ref.id, data }); };
  const store = req('./src/routine/store.js');
  store.liveLeaseFeedbackIds = async () => new Set();
  const A = {
    _id: 'aaaa1', seq: 950, subSeq: 0, status: 'revision_capability', branch: 'claude/prova',
    waitsFor: [{ id: 'bbbb1', num: '951' }],
  };
  const queue = req('./src/routine/queue.js');
  queue.readFeedback = async (id) => (id === A._id ? Object.assign({}, A) : null);
  const deliver = req('./src/routine/deliver.js');
  const stati = [];
  deliver.applyStatus = async (id, doc, to, extra) => { stati.push({ id, from: doc.status, to, reason: extra && extra.reason }); return { ok: true }; };
  const waitsIo = req('./src/routine/waits.js');

  const waited = new Map([['bbbb1', { _id: 'bbbb1', status: 'archived', resolvedInVersion: '' }]]);
  const r = await waitsIo.settleBrokenWaits([A], waited, { nowMs: Date.now() });

  expect(r.moved.map((m) => m.id)).toEqual(['aaaa1']);
  expect(stati).toEqual([expect.objectContaining({ id: 'aaaa1', to: 'design' })]);
});
