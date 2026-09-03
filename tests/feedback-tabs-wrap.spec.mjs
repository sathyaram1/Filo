// La fila di schede in cima alla pagina dei feedback (Ricevuti, In coda,
// Risolti, Archiviati — le stesse della dashboard di gestione, #509) deve
// adattarsi alla larghezza della finestra: su finestre strette va a capo invece
// di sforare il bordo destro e trascinare TUTTA la pagina in uno scorrimento
// orizzontale. E ogni scheda resta di un pezzo solo: il numero non si stacca
// mai dal nome che qualifica.
//
// Pre-condizione che senza il fix fallirebbe: con `.fb-tabs` a `display:flex`
// senza `flex-wrap`, i bottoni restano su una riga sola, il contenitore sfora e
// `documentElement.scrollWidth` supera `clientWidth`; togliendo il
// `white-space: nowrap` dalla singola scheda, "In coda (0)" si spezza su tre
// righe e l'assert sull'altezza diventa rosso.
//
// Stub di SN_FEEDBACK.list per restare offline: il layout delle tab non dipende
// da Firestore né dallo stato admin.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

test('con finestra stretta le schede vanno a capo, la pagina non scorre di lato', async ({ app, openTab }) => {
  // Restringe la BrowserWindow al caso segnalato (~720 punti di larghezza).
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setContentSize(720, 800);
  });

  const page = await openTab(FEEDBACK_URL);
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined' && window.__fbTest);
  await page.evaluate(() => { SN_FEEDBACK.list = async () => []; });
  // Dati veri (vuoti) → le schede portano il loro numero: è la larghezza da
  // misurare, non quella dei soli nomi.
  await page.evaluate(() => window.__fbTest.setData([]));

  // Le quattro sezioni della macchina a stati.
  const tabs = page.locator('.fb-tab');
  await expect(tabs).toHaveCount(4);

  // Larghezza stretta davvero: qui le quattro schede NON stanno su una riga.
  await page.setViewportSize({ width: 360, height: 800 });

  // Il corpo della pagina NON produce scorrimento orizzontale.
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  const geo = await page.evaluate(() => {
    const list = [...document.querySelectorAll('.fb-tab')];
    const first = list[0].getBoundingClientRect();
    return {
      firstTop: first.top,
      clientWidth: document.documentElement.clientWidth,
      schede: list.map((el) => {
        const r = el.getBoundingClientRect();
        // Quante RIGHE DI TESTO occupa l'etichetta: un Range sul contenuto
        // torna un rettangolo per riga. 1 = il numero è ancora accanto al nome.
        const range = document.createRange();
        range.selectNodeContents(el);
        return {
          testo: el.textContent.trim(),
          top: r.top, right: r.right,
          righe: range.getClientRects().length,
          wrap: getComputedStyle(el).whiteSpace,
        };
      }),
    };
  });

  // Nessuna scheda finisce oltre il bordo destro visibile: se non ci stanno
  // tutte su una riga, la barra manda a capo le schede INTERE.
  for (const s of geo.schede) {
    expect(s.right, `scheda "${s.testo}" oltre il bordo`).toBeLessThanOrEqual(geo.clientWidth + 1);
    // Il nome e il suo numero restano sulla stessa riga (una riga di testo,
    // più il padding verticale): mai "In coda" / "(0)" spezzati.
    expect(s.wrap, `scheda "${s.testo}"`).toBe('nowrap');
    expect(s.righe, `scheda "${s.testo}" spezzata su più righe`).toBe(1);
  }
  // A questa larghezza almeno una scheda è andata a capo.
  expect(Math.max(...geo.schede.map((s) => s.top))).toBeGreaterThan(geo.firstTop);

  // L'ultima scheda è cliccabile e diventa attiva (prima era tagliata/fuori).
  await tabs.last().click();
  await expect(tabs.last()).toHaveClass(/fb-tab--active/);

  await page.screenshot({ path: 'tests/.shots/feedback-tabs-wrap.png' }).catch(() => {});
});
