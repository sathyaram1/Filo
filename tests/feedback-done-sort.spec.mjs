// La tab "Risolti" ordina i feedback per numero (#1, #2, … #22.1, #22.2),
// non per priorità/data come le altre tab. I dati vengono iniettati stubbando
// SN_FEEDBACK.list nella pagina: niente Firestore live, l'asserzione è
// sull'ordine di rendering vero.

import { test, expect } from './fixtures/electron.mjs';

// Ordinati per data DESC (come li consegna SN_FEEDBACK.list vero) e con
// priorità/date "sbagliate" rispetto al numero, così l'unico modo di vederli
// nell'ordine giusto è ordinare per numero: senza il fix questo test fallisce.
const FAKE = [
  {
    _id: 'd-sub2', text: 'Sub due', name: 'sub due',
    seq: 22, subSeq: 2, status: 'done', priority: 3,
    createdAt: '2026-06-12T13:00:00Z',
  },
  {
    _id: 'd-3', text: 'Numero tre', name: 'tre',
    seq: 3, subSeq: 0, status: 'done', priority: 0,
    createdAt: '2026-06-12T12:00:00Z',
  },
  {
    _id: 'd-sub10', text: 'Sub dieci', name: 'sub dieci',
    seq: 22, subSeq: 10, status: 'done', priority: 1,
    createdAt: '2026-06-12T11:00:00Z',
  },
  {
    _id: 'd-1', text: 'Numero uno', name: 'uno',
    seq: 1, subSeq: 0, status: 'done', priority: 2,
    createdAt: '2026-06-12T10:00:00Z',
  },
  {
    _id: 'd-none', text: 'Senza numero', name: 'senza numero',
    status: 'done', priority: 3,
    createdAt: '2026-06-12T14:00:00Z',
  },
];

test('tab Risolti: ordine per numero (#1, #3, #22.2, #22.10, poi senza numero)', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined');
  await page.evaluate((items) => { SN_FEEDBACK.list = async () => items; }, FAKE);
  await page.click('#refresh');

  // Passa alla tab "Risolti".
  await page.click('[data-tab="resolved"]');
  await expect(page.locator('.fb-card')).toHaveCount(5);

  // Atteso: #1, #3, #22.2, #22.10 (numerico: 2 < 10), e i senza-numero in coda.
  const titles = page.locator('.fb-card .fb-title');
  await expect(titles.nth(0)).toContainText('#1');
  await expect(titles.nth(1)).toContainText('#3');
  await expect(titles.nth(2)).toContainText('#22.2');
  await expect(titles.nth(3)).toContainText('#22.10');
  // L'ultimo (senza numero) finisce in coda: la sua card non ha .fb-title.
  const lastCard = page.locator('.fb-card').nth(4);
  await expect(lastCard).toContainText('senza numero');

  await page.screenshot({ path: 'tests/.shots/feedback-done-sort.png' }).catch(() => {});
});
