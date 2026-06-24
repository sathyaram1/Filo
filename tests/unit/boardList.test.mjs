// Unit test per il filtro della bacheca utente (DC1): SN_MANAGE_REVIEW.listBoardTab.
// La bacheca è la superficie a permessi ridotti: deve mostrare SOLO i fix già in
// produzione (done/verified + spediti, DB3) e MAI nulla del red-team (qualsiasi
// feedback con un blocco nel pipeline va escluso, anche se per qualche motivo è
// finito in `done`). Gira via `npm run test:unit` senza Electron né rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'manageReview.js'));

const MR = globalThis.SN_MANAGE_REVIEW;

const ids = (list) => list.map((f) => f._id);

test('espone listBoardTab', () => {
  assert.equal(typeof MR.listBoardTab, 'function');
});

test('mostra solo done/verified spediti; esclude todo/new/review/clarify', () => {
  const fbs = [
    { _id: 'done-shipped', status: 'done', resolvedInVersion: '0.2.70', createdAt: '2026-06-20' },
    { _id: 'verified-shipped', status: 'verified', resolvedInVersion: '0.2.71', createdAt: '2026-06-21' },
    { _id: 'todo', status: 'todo', createdAt: '2026-06-22' },
    { _id: 'new', status: 'new', createdAt: '2026-06-22' },
    { _id: 'review', status: 'review', createdAt: '2026-06-22' },
    { _id: 'clarify', status: 'clarify', createdAt: '2026-06-22' },
    { _id: 'archived', status: 'archived', createdAt: '2026-06-22' },
    { _id: 'ignored', status: 'ignored', createdAt: '2026-06-22' },
  ];
  const out = MR.listBoardTab(fbs, { releasedVersion: '0.2.71' });
  assert.deepEqual(ids(out).sort(), ['done-shipped', 'verified-shipped']);
});

test('esclude un fix chiuso ma NON ancora rilasciato (resolvedInVersion futura)', () => {
  const fbs = [
    { _id: 'done-future', status: 'done', resolvedInVersion: '0.2.99', createdAt: '2026-06-22' },
    { _id: 'done-now', status: 'done', resolvedInVersion: '0.2.71', createdAt: '2026-06-22' },
  ];
  const out = MR.listBoardTab(fbs, { releasedVersion: '0.2.71' });
  assert.deepEqual(ids(out), ['done-now']);
});

test('SICUREZZA: esclude qualsiasi feedback con blocco nel pipeline, anche se done+spedito', () => {
  const fbs = [
    { _id: 'attack', status: 'done', resolvedInVersion: '0.2.70', createdAt: '2026-06-22',
      pipeline: { action: 'block_attack', l2Class: 'attack' } },
    { _id: 'spam', status: 'done', resolvedInVersion: '0.2.70', createdAt: '2026-06-22',
      pipeline: { l2Class: 'spam' } },
    { _id: 'design', status: 'done', resolvedInVersion: '0.2.70', createdAt: '2026-06-22',
      pipeline: { l2Class: 'design' } },
    { _id: 'clean', status: 'done', resolvedInVersion: '0.2.70', createdAt: '2026-06-22' },
  ];
  const out = MR.listBoardTab(fbs, { releasedVersion: '0.2.71' });
  assert.deepEqual(ids(out), ['clean']);
});

test('un blocco accettato dall\'owner NON è più un blocco → torna visibile', () => {
  const fbs = [
    { _id: 'accepted', status: 'done', resolvedInVersion: '0.2.70', createdAt: '2026-06-22',
      reviewDecision: 'accepted', pipeline: { action: 'block_attack' } },
  ];
  const out = MR.listBoardTab(fbs, { releasedVersion: '0.2.71' });
  assert.deepEqual(ids(out), ['accepted']);
});

test('senza releasedVersion il gate è inattivo: i done storici restano visibili', () => {
  const fbs = [
    { _id: 'legacy', status: 'done', createdAt: '2026-06-22' },
    { _id: 'todo', status: 'todo', createdAt: '2026-06-22' },
  ];
  const out = MR.listBoardTab(fbs, {});
  assert.deepEqual(ids(out), ['legacy']);
});
