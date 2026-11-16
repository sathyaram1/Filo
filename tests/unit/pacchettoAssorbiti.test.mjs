// #2270: in Gestione gli originali assorbiti in un pacchetto escono da liste e conteggi, e il pacchetto li elenca.
// Una regola sola (manageReview.assorbito) per le schede, i conteggi e gli Archiviati; la transizione della fusione.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const m of ['feedbackTransitions.js', 'feedbackStatus.js', 'domande.js', 'manageReview.js']) require(join(ROOT, 'src', 'shared', m));
const MR = globalThis.SN_MANAGE_REVIEW;
const FS = globalThis.SN_FB_STATUS;

const fb = (id, status, extra = {}) => ({ _id: id, seq: Number(id.replace(/\D/g, '')) || 1, subSeq: 0, name: `T ${id}`, status, createdAt: '2026-11-10T10:00:00Z', ...extra });
const DATI = [
  fb('p3', 'todo', { unisce: [{ id: 'a1', num: '#1' }, { id: 'a2', num: '2' }, { id: 'via', num: '#9' }] }),
  fb('a1', 'archived', { unitoIn: 'p3' }),
  fb('a2', 'archived', { unitoIn: 'p3' }),
  fb('z4', 'archived'),
  fb('c5', 'done', { unitoIn: 'p6', resolvedInVersion: '0.0.1' }),
  fb('q7', 'todo', { unitoIn: 'p3' }),
];

test('un assorbito (archiviato o chiuso col rimando) non sta in nessuna lista né conteggio; rimesso in coda dall’owner sì', () => {
  assert.equal(MR.assorbito(DATI[1]), true);
  assert.equal(MR.assorbito(DATI[4]), true);
  assert.equal(MR.assorbito(DATI[3]), false);
  assert.equal(MR.assorbito(DATI[5]), false, 'ripristinato in coda: si vede, o sparirebbe per sempre');
  const conti = MR.manageTabCounts(DATI, { releasedVersion: '9.9.9' });
  assert.equal(conti.archived, 1);
  assert.equal(conti.resolved, 0);
  assert.equal(conti.queue, 2);
  assert.deepEqual(MR.listArchiveTab(DATI).map((f) => f._id), ['z4']);
  assert.deepEqual(MR.listForManageTab(DATI, 'queue').map((f) => f._id).sort(), ['p3', 'q7']);
  assert.equal(MR.manageTabFor(DATI[1]), 'archived', 'le azioni dell’owner restano quelle di un archiviato');
});

test('il pacchetto elenca i suoi originali nell’ordine, col titolo di quelli letti', () => {
  assert.deepEqual(MR.assorbitiDi(DATI[0], DATI), [
    { id: 'a1', num: '#1', titolo: 'T a1', presente: true },
    { id: 'a2', num: '#2', titolo: 'T a2', presente: true },
    { id: 'via', num: '#9', titolo: '', presente: false },
  ]);
  assert.deepEqual(MR.assorbitiDi(DATI[3], DATI), []);
});

test('archived→done è del solo server, alla fusione del pacchetto', () => {
  assert.equal(FS.canTransition('archived', 'done', 'pipeline'), true);
  assert.equal(FS.canTransition('archived', 'done', 'owner'), false);
  assert.equal(FS.canTransition('archived', 'done', 'routine'), false);
});
