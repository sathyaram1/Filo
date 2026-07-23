// Appunti di Filo: visibili e cancellabili dalla dashboard (#240).
//
// Filo salva appunti tramite l'azione SALVA_APPUNTO ("prendi nota che…") e li
// usa come contesto. Questo spec verifica che ora esista una UI per vederli e
// gestirli: l'icona "Appunti" in alto a destra apre un pannello con tutte le
// note, ciascuna cancellabile con la ×, più "Cancella tutti".
//
// Prima del fix questo test falliva: non c'era né l'icona né il pannello.

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm } from './helpers/confirm.mjs';

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

async function addNote(page, text, context) {
  return page.evaluate(([t, c]) => new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: window.SN_MSG.MSG.FILO_ADD_NOTE, text: t, context: c },
      (r) => resolve(r),
    );
  }), [text, context]);
}

test('gli appunti salvati sono visibili nel pannello e cancellabili', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  expect(page, 'newtab deve essere aperta').toBeTruthy();

  const NOTE_A = 'AUDIT_NOTE_A_riunione_alle_10';
  const NOTE_B = 'AUDIT_NOTE_B_comprare_il_latte';
  const addA = await addNote(page, NOTE_A, 'test-audit');
  const addB = await addNote(page, NOTE_B, '');
  expect(addA?.ok && addB?.ok, 'i due appunti si devono salvare').toBe(true);

  // Il pulsante "Appunti" esiste tra i controlli in alto a destra.
  const notesBtn = page.locator('.dash-ctrl[data-command="notes"]');
  await expect(notesBtn).toHaveCount(1);

  // Aprendo il pannello, entrambi gli appunti sono visibili.
  await notesBtn.click();
  const panel = page.locator('.dash-notes-box');
  await expect(panel).toBeVisible();
  const list = page.locator('.dash-notes-list .dash-notes-item');
  await expect(list).toHaveCount(2);
  await expect(panel).toContainText(NOTE_A);
  await expect(panel).toContainText(NOTE_B);

  // Cancellazione di UN appunto: sparisce, l'altro resta.
  const itemA = page.locator(`.dash-notes-item:has-text("${NOTE_A}")`);
  await itemA.locator('.dash-notes-del').click();
  await expect(list).toHaveCount(1);
  await expect(panel).not.toContainText(NOTE_A);
  await expect(panel).toContainText(NOTE_B);

  // Verifica lato dati: FILO_GET_NOTES non contiene più NOTE_A.
  const afterDel = await page.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.FILO_GET_NOTES }, (r) => resolve(r));
  }));
  expect((afterDel?.notes || []).some((n) => n.text === NOTE_A)).toBe(false);
  expect((afterDel?.notes || []).some((n) => n.text === NOTE_B)).toBe(true);

  // "Cancella tutti" (con conferma) svuota gli appunti → stato vuoto.
  await page.locator('.dash-notes-clear').click();
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dash-notes-empty')).toBeVisible();
  await expect(list).toHaveCount(0);

  const afterClear = await page.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.FILO_GET_NOTES }, (r) => resolve(r));
  }));
  expect((afterClear?.notes || []).length).toBe(0);
});
