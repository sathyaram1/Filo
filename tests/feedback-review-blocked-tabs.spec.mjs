// I nuovi stati del cancello di merge delle routine — `review` (fix pronto su un
// branch, in attesa di verifica avversariale) e `blocked` (in pausa, decide
// l'utente) — hanno due tab dedicati nella dashboard ("In revisione" e
// "Bloccati"), col conteggio, e mostrano il branch del fix sulle card.
//
// I dati arrivano stubbando SN_FEEDBACK.list (niente Firestore live): si
// asserisce il rendering vero dei tab e del badge branch. Senza il fix R1 i due
// stati cadevano nel tab "Ricevuti" (statusOf → 'inbox') e il branch non veniva
// mai mostrato: questi assert diventano rossi se quella logica regredisce.

import { test, expect } from './fixtures/electron.mjs';

const FAKE = [
  {
    _id: 'rev', text: 'Fix pronto, da verificare', name: 'in revisione',
    seq: 40, subSeq: 0, status: 'review', branch: 'worker/40',
    createdAt: '2026-06-22T11:00:00Z',
  },
  {
    _id: 'blk', text: 'Fix in pausa dopo 3 loop', name: 'bloccato',
    seq: 41, subSeq: 0, status: 'blocked', branch: 'worker/41.2',
    createdAt: '2026-06-22T10:30:00Z',
  },
  {
    _id: 'td', text: 'Feedback ancora da risolvere', name: 'da fare',
    seq: 42, subSeq: 0, status: 'todo',
    createdAt: '2026-06-22T10:00:00Z',
  },
];

test('dashboard: tab "In revisione" e "Bloccati" col branch del fix', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined');
  await page.evaluate((items) => { SN_FEEDBACK.list = async () => items; }, FAKE);
  await page.click('#refresh');

  // I due tab esistono col conteggio corretto (uno per stato).
  const reviewTab = page.locator('[data-tab="review"]');
  const blockedTab = page.locator('[data-tab="blocked"]');
  await expect(reviewTab).toHaveText(/In revisione \(1\)/);
  await expect(blockedTab).toHaveText(/Bloccati \(1\)/);

  // Tab "In revisione": una sola card, quella in `review`, che mostra il branch.
  await reviewTab.click();
  await expect(page.locator('.fb-card')).toHaveCount(1);
  const revCard = page.locator('.fb-card', { hasText: 'in revisione' });
  await expect(revCard).toHaveCount(1);
  await expect(revCard.locator('.fb-branch')).toHaveText(/worker\/40/);
  await page.screenshot({ path: 'tests/.shots/feedback-review-tab.png' }).catch(() => {});

  // Tab "Bloccati": una sola card, in `blocked`, col suo branch.
  await blockedTab.click();
  await expect(page.locator('.fb-card')).toHaveCount(1);
  const blkCard = page.locator('.fb-card', { hasText: 'bloccato' });
  await expect(blkCard).toHaveCount(1);
  await expect(blkCard.locator('.fb-branch')).toHaveText(/worker\/41\.2/);

  // I nuovi stati NON inquinano più "Ricevuti" (regressione del fix R1).
  await page.click('[data-tab="inbox"]');
  await expect(page.locator('.fb-card', { hasText: 'in revisione' })).toHaveCount(0);
  await expect(page.locator('.fb-card', { hasText: 'bloccato' })).toHaveCount(0);
});
