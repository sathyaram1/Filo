// Audit (prober): editor filo:// — titoli collassabili, stato freccia/contenuto
// fuori sincrono dopo una digitazione qualsiasi.
//
// Sospetto (da lettura di editor.js): ogni input sul documento chiama
// refreshCollapseToggles(), che RIMUOVE tutti i bottoni-freccia e li ricrea
// SENZA la classe `is-collapsed`, mentre i fratelli del titolo restano nascosti
// (`ed-hidden-by-collapse`). Risultato atteso dal bug:
//   1. collasso una sezione → contenuto nascosto, freccia ruotata (ok);
//   2. digito UN carattere (anche nel titolo stesso) → la freccia torna in
//      stato "aperto" ma il contenuto resta nascosto;
//   3. un click sulla freccia non riapre nulla (ri-"collassa" un collassato):
//      servono DUE click per rivedere il contenuto.
//
// Gli assert descrivono il comportamento ATTESO (freccia coerente, un solo
// click per riaprire): se il bug c'è sono rossi.
//
// test.fixme: repro VERIFICATA ROSSA (2026-07-10, senza fixme): dopo la
// digitazione la freccia perde `is-collapsed` (test 1) e il primo click non
// riapre la sezione (test 2, il paragrafo resta `ed-hidden-by-collapse`).
// Chi lavora il fix toglie `.fixme`.

import { test, expect } from './fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

async function setupDoc(page) {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
  // Contenuto: titolo + paragrafo. Setup programmatico (l'input event fa
  // partire refreshCollapseToggles come una digitazione reale).
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<h1>Titolo</h1><p id="par">contenuto della sezione</p>';
    doc.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await expect(page.locator('#doc h1 .ed-collapse-toggle')).toBeVisible();
}

test.fixme('titoli collassabili: dopo una digitazione la freccia resta coerente col contenuto nascosto', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await setupDoc(page);

  const toggle = page.locator('#doc h1 .ed-collapse-toggle');
  const par = page.locator('#doc #par');

  // 1) Collassa: contenuto nascosto, freccia in stato collassato.
  await toggle.click();
  await expect(par).toBeHidden();
  await expect(toggle).toHaveClass(/is-collapsed/);

  // 2) Digita un carattere in fondo al titolo (digitazione reale dell'utente).
  await page.locator('#doc h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('X');

  // Il contenuto resta nascosto (giusto)…
  await expect(par).toBeHidden();
  // …e la freccia DEVE ancora dire "collassato". (Col bug: classe sparita,
  // freccia in stato aperto su una sezione nascosta.)
  await expect(page.locator('#doc h1 .ed-collapse-toggle')).toHaveClass(/is-collapsed/);
});

test.fixme('titoli collassabili: dopo una digitazione UN click sulla freccia riapre la sezione', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await setupDoc(page);

  const par = page.locator('#doc #par');

  // Collassa, poi digita nel titolo.
  await page.locator('#doc h1 .ed-collapse-toggle').click();
  await expect(par).toBeHidden();
  await page.locator('#doc h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('X');
  await expect(par).toBeHidden();

  // Screenshot della situazione incoerente (freccia aperta + contenuto nascosto).
  await page.screenshot({ path: 'tests/.shots/audit-editor-collapse-desync.png' });

  // UN click sulla freccia (ricreata dopo l'input) deve riaprire la sezione.
  await page.locator('#doc h1 .ed-collapse-toggle').click();
  await expect(par).toBeVisible();
});
