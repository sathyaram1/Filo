// Verifica giro 3 (#914): un derivato d'utente segue l'origine fino alla coda. Codice vero del server
// (filo-security accanto al repo, o FILO_SECURITY_DIR), Firestore, stato e giudice di priorità finti.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SU = resolve(ROOT, '..', '..', '..', '..');
const SRC = [
  process.env.FILO_SECURITY_DIR ? resolve(process.env.FILO_SECURITY_DIR, 'src') : '',
  resolve(SU, 'filo-security', '.claude', 'worktrees', basename(ROOT), 'functions', 'src'),
  resolve(ROOT, '..', 'filo-security', 'functions', 'src'),
  resolve(SU, 'filo-security', 'functions', 'src'),
].find((d) => d && existsSync(resolve(d, 'origine.js'))) || '';

function server() {
  const require = createRequire(resolve(SRC, 'x.js'));
  const docs = new Map();
  const priorita = [];
  const fakeDb = {
    collection: () => ({
      doc: (id) => ({ get: async () => ({ id, exists: docs.has(id), data: () => docs.get(id) }) }),
      where: (campo, _op, val) => ({
        limit: () => ({
          get: async () => ({
            docs: [...docs].filter(([, d]) => d[campo] === val).map(([id, d]) => ({ id, data: () => d })),
          }),
        }),
      }),
    }),
    doc: (p) => ({ set: async (v) => { const id = p.split('/')[1]; docs.set(id, Object.assign({}, docs.get(id), v)); } }),
  };
  const stub = (rel, over) => {
    const p = require.resolve(resolve(SRC, rel));
    delete require.cache[p];
    const real = require(p);
    require.cache[p].exports = Object.assign({}, real, over);
  };
  for (const k of Object.keys(require.cache)) if (k.startsWith(SRC)) delete require.cache[k];
  stub('data/firestore.js', { db: () => fakeDb });
  stub('feedbackDecrypt.js', { decryptFeedbackFields: async (x) => x });
  stub('data/feedbackState.js', {
    recordDecision: async (id, { status, statusReason }) => {
      const d = Object.assign({}, docs.get(id));
      if (status) d.status = status;
      if (typeof statusReason === 'string') d.statusReason = statusReason;
      docs.set(id, d);
    },
    recordPriority: async (id, p) => { priorita.push([id, p]); docs.set(id, Object.assign({}, docs.get(id), { priority: String(p) })); },
  });
  stub('priority/judge.js', { buildPriorityJudge: () => ({ run: async () => 1 }) });
  const origine = require(resolve(SRC, 'origine.js'));
  return { docs, priorita, origine };
}

// L'origine cambia stato: il trigger vero chiama seguiOrigine con i documenti prima e dopo.
async function cambia(s, id, status, statusReason = '') {
  const prima = Object.assign({ _id: id }, s.docs.get(id));
  s.docs.set(id, Object.assign({}, s.docs.get(id), { status, statusReason }));
  await s.origine.seguiOrigine(id, prima, Object.assign({ _id: id }, s.docs.get(id)));
}

const utente = (status) => ({ clientId: 'utente-1', status, statusReason: '', seq: 500, subSeq: 0 });
const derivato = (over) => Object.assign({
  clientId: 'routine:residuo', senderProof: 'server', origineId: 'orig', status: 'unlabeled',
  statusReason: 'attesa_origine', parentId: 'orig', priority: '2', priorityManual: true,
}, over);

test.skip(!SRC, 'filo-security non trovato accanto al repo');

test('r1: l’owner dà il via libera al cancello di fusione e l’origine si fonde: il derivato entra in coda', async () => {
  const s = server();
  s.docs.set('orig', utente('revision_security'));
  s.docs.set('der', derivato());
  await cambia(s, 'orig', 'design', 'l5');
  expect(s.docs.get('der').statusReason).toBe('origine_bloccata');
  await cambia(s, 'orig', 'done');
  expect(s.docs.get('der').status).toBe('todo');
});

test('r1: l’owner salta la sicurezza, il lavoro riparte e si fonde: il derivato entra in coda', async () => {
  const s = server();
  s.docs.set('orig', utente('revision_security'));
  s.docs.set('der', derivato());
  await cambia(s, 'orig', 'design', 'secaudit');
  await cambia(s, 'orig', 'todo');
  await cambia(s, 'orig', 'done');
  expect(s.docs.get('der').status).toBe('todo');
});

test('r3: un ritrovamento che aspettava l’origine entra in coda con la priorità del giudice, come se nascesse dopo', async () => {
  const s = server();
  s.docs.set('orig', utente('working'));
  s.docs.set('rit', derivato({ clientId: 'routine:fix', priority: '0', priorityManual: undefined, parentId: '' }));
  await cambia(s, 'orig', 'done');
  expect(s.docs.get('rit').status).toBe('todo');
  expect(s.priorita.map(([id]) => id)).toContain('rit');
});
