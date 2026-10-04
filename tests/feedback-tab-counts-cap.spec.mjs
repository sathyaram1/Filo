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

// `status: 'unlabeled'` → sezione "Ricevuti" (macchina a stati, #509).

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
        seq: i + 1, subSeq: 0, status: 'unlabeled', clientId: 'tester@example.com',
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
        seq: i + 1, subSeq: 0, status: 'unlabeled', clientId: 'tester@example.com',
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
  await expect(page.locator('[data-tab="resolved"]')).toHaveText('Risolti (0+)');
});

// ── Caricamento fallito: un numero è un'affermazione ─────────────────────────
// Senza rete la pagina mostra l'errore e il tasto "Riprova", e le sezioni
// restano giustamente senza numero. Ma basta cliccare una sezione — la prima
// cosa che uno fa — perché il re-render scriva "(0)" su tutte: uno zero dice
// "qui non c'è niente", mentre la verità è che non lo sappiamo. E lo stesso
// re-render sostituiva l'errore con "Nessun feedback in arrivo.", portandosi via
// l'unico tasto per riprovare.
//
// Precondizione senza il fix: dopo il click le sezioni dicono "(0)" e il tasto
// Riprova sparisce → entrambi gli assert diventano rossi.
test('#495 — caricamento fallito: nessun numero, e l\'errore con "Riprova" resta', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.SN_FEEDBACK && window.__fbTest && document.getElementById('refresh'));

  // Rete assente: la lista rigetta come fa il fetch del renderer offline.
  await page.evaluate(() => {
    window.SN_FEEDBACK.list = () => Promise.reject(new TypeError('Failed to fetch'));
  });
  await page.locator('#refresh').click();
  await expect(page.locator('.fb-load-retry')).toBeVisible({ timeout: 15_000 });

  const sezioni = page.locator('#tabs [data-tab]');
  for (const t of await sezioni.allInnerTexts()) {
    expect(t, `sezione "${t}" subito dopo il fallimento`).not.toMatch(/\(/);
  }

  // L'utente prova un'altra sezione.
  await page.locator('[data-tab="queue"]').click();
  for (const t of await sezioni.allInnerTexts()) {
    expect(t, `sezione "${t}" dopo un click a caricamento fallito`).not.toMatch(/\(/);
  }
  // La via d'uscita è ancora lì, con la sua spiegazione.
  await expect(page.locator('.fb-load-error-msg')).toBeVisible();
  await expect(page.locator('.fb-load-retry')).toBeVisible();

  // Rete tornata: da qui i numeri si sanno, e si scrivono.
  await page.evaluate(() => {
    window.SN_FEEDBACK.list = () => Promise.resolve([
      { _id: 'r1', text: 'uno', name: 'uno', seq: 1, subSeq: 0, status: 'unlabeled',
        clientId: 'tester@example.com', createdAt: '2026-06-20T10:00:00Z', images: [] },
      { _id: 'r2', text: 'due', name: 'due', seq: 2, subSeq: 0, status: 'todo',
        clientId: 'tester@example.com', createdAt: '2026-06-20T10:00:00Z', images: [] },
    ]);
  });
  await page.locator('.fb-load-retry').click();
  await expect(page.locator('[data-tab="inbox"]')).toHaveText('Ricevuti (1)');
  await expect(page.locator('[data-tab="queue"]')).toHaveText('In coda (1)');
  await expect(page.locator('[data-tab="resolved"]')).toHaveText('Risolti (0)');
  await expect(page.locator('.fb-load-retry')).toBeHidden();
});
