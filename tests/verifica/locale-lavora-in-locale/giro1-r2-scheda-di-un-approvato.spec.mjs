// Verifica locale, giro 1, rilievo 2: il feedback di un utente approvato come lavoro locale, una volta risolto,
// deve avere la sua scheda pubblica: è da lì che chi l'ha mandato vede la risoluzione e riceve l'annuncio.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

test('utente approvato come lavoro locale, risolto: la scheda per chi l’ha mandato c’è', async () => {
  test.fail(true, 'rilievo 2 aperto: il segno locale toglie la scheda anche ai feedback degli utenti');
  for (const m of ['feedbackStatus', 'manageReview', 'feedbackPublicView']) require(resolve('src/shared', `${m}.js`));
  const V = globalThis.SN_FEEDBACK_PUBLIC_VIEW;
  const segno = { by: 'owner@esempio', at: 1790000000000 };
  const base = { _id: 'u-1', name: 'Il terminale non parte', seq: 950, subSeq: 0, status: 'done', statusPublic: 'closed', clientId: 'utente-7', createdAt: '2026-10-01T07:00:00Z' };
  expect(V.cardFor(base)).not.toBeNull();
  expect(V.cardFor({ ...base, localOnly: segno, localApproval: segno })).not.toBeNull();
});
