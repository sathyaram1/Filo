// Pagina "Feedback alpha" (filo://feedback): i numeri accanto alle sezioni non
// devono affermare un totale che la pagina non conosce (#495).
//
// La pagina carica al massimo SN_FEEDBACK.LIST_PAGE_SIZE feedback, dal più
// recente al più vecchio. Fin sotto quella soglia il numero È il totale e si
// scrive "(24)". Appena il caricamento tocca il tetto i più vecchi restano
// fuori: il numero diventa un minimo e si scrive "(24+)", con l'hover che dice
// quanti se ne sono caricati.
//
// Precondizione senza il fix: la sezione diceva "(499)" anche col tetto toccato,
// senza hover → l'assert sul "+" e quello sul title diventano rossi.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://feedback/feedback.html';

// `status: 'new'` → sezione "Ricevuti" (statusOf). Il clientId non è quello di
// un agente, altrimenti i feedback finirebbero nella sezione "Agente".

test('#495 — al tetto del caricamento i numeri delle sezioni diventano un minimo', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined' && window.__fbTest);

  const CAP = await page.evaluate(() => SN_FEEDBACK.LIST_PAGE_SIZE);
  const inbox = page.locator('[data-tab="inbox"]');

  // Uno in meno del tetto: il caricamento ha visto tutto, il numero è il totale.
  await page.evaluate((cap) => {
    const items = [];
    for (let i = 0; i < cap - 1; i++) {
      items.push({
        _id: `c${i}`, text: `segnalazione ${i}`, name: `segnalazione ${i}`,
        seq: i + 1, subSeq: 0, status: 'new', clientId: 'tester@example.com',
        createdAt: '2026-06-20T10:00:00Z', images: [],
      });
    }
    window.__fbTest.setData(items);
  }, CAP);
  await expect(inbox).toHaveText(`Ricevuti (${CAP - 1})`);
  await expect(inbox).not.toHaveAttribute('title', /./);

  // Tetto toccato: lo stesso numero smette di affermare un totale, e l'hover
  // spiega il "+" invece di lasciarlo come enigma.
  await page.evaluate((cap) => {
    const items = [];
    for (let i = 0; i < cap; i++) {
      items.push({
        _id: `c${i}`, text: `segnalazione ${i}`, name: `segnalazione ${i}`,
        seq: i + 1, subSeq: 0, status: 'new', clientId: 'tester@example.com',
        createdAt: '2026-06-20T10:00:00Z', images: [],
      });
    }
    window.__fbTest.setData(items);
  }, CAP);
  await expect(inbox).toHaveText(`Ricevuti (${CAP}+)`);

  const hint = await page.evaluate(() => SN_FEEDBACK.COUNT_CAP_HINT);
  expect(hint).toContain(String(CAP));
  await expect(inbox).toHaveAttribute('title', hint);

  // Una sezione vuota al tetto non è vuota davvero: nemmeno lo zero afferma.
  await expect(page.locator('[data-tab="done"]')).toHaveText('Risolti (0+)');
});
