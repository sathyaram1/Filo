// Audit prober — appunti (note) di Filo: salvati ma non visibili.
//
// Filo salva appunti tramite l'azione SALVA_APPUNTO (ad es. "prendi nota che…"),
// e li usa come contesto nel prompt della dashboard. Ma non esiste alcun pannello
// UI che mostri all'utente quali appunti ha accumulato, né un modo per cancellarli.
//
// Questo test verifica che:
// (a) Un appunto si possa salvare via IPC (FILO_ADD_NOTE) — il meccanismo funziona.
// (b) L'appunto NON compare da nessuna parte nella dashboard (né nella colonna
//     sinistra, né in quella destra, né nella home): la mancanza di visibilità è
//     confermata.
// (c) FILO_GET_NOTES restituisce l'appunto salvato — i dati ci sono, manca solo la UI.

import { test, expect } from './fixtures/electron.mjs';

// Trova la Page della newtab (dashboard), aspettando fino a 10s.
async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) {
      await win.waitForLoadState('domcontentloaded');
      return win;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test('appunti salvati via SALVA_APPUNTO non sono visibili nella dashboard', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  expect(page, 'newtab deve essere aperta').toBeTruthy();

  // (a) Salva un appunto tramite il canale IPC diretto.
  const NOTE_TEXT = 'AUDIT_TEST_NOTE_CONTENUTO_UNIVOCO_12345';
  const addResult = await page.evaluate(async (text) => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: window.SN_MSG.MSG.FILO_ADD_NOTE, text, context: 'test-audit' },
        (r) => resolve(r),
      );
    });
  }, NOTE_TEXT);

  expect(addResult?.ok, 'FILO_ADD_NOTE deve rispondere ok:true').toBe(true);
  expect(addResult?.note?.text, 'il testo dell\'appunto deve essere salvato').toBe(NOTE_TEXT);

  // (c) FILO_GET_NOTES restituisce l'appunto (i dati ci sono).
  const getResult = await page.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: window.SN_MSG.MSG.FILO_GET_NOTES },
        (r) => resolve(r),
      );
    });
  });
  expect(getResult?.ok, 'FILO_GET_NOTES deve rispondere ok:true').toBe(true);
  const saved = getResult?.notes || [];
  const found = saved.find((n) => n.text === NOTE_TEXT);
  expect(found, 'l\'appunto deve essere recuperabile via FILO_GET_NOTES').toBeTruthy();

  // (b) L'appunto NON è visibile da nessuna parte nella dashboard.
  // Aspettiamo un po' per dare tempo alla dashboard di aggiornarsi.
  await page.waitForTimeout(1000);

  // Cerca il testo dell'appunto ovunque nel DOM della dashboard.
  const visibleInDom = await page.evaluate((text) => {
    return document.body.textContent.includes(text);
  }, NOTE_TEXT);

  // Il test DOCUMENTA il comportamento attuale: l'appunto NON è visibile.
  // Quando il bug viene fixato questo test dovrà essere aggiornato.
  expect(visibleInDom,
    'BUG CONFERMATO: gli appunti salvati tramite SALVA_APPUNTO non sono visibili nella dashboard — ' +
    'l\'utente non può vedere né cancellare i propri appunti'
  ).toBe(false);
});
