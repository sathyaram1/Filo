// VERIFIER (#379) — stress test adversariale dell'annulla-eliminazione documento.
// I test del risolutore coprono l'undo di un file NON attivo e dell'ultimo file.
// Qui verifico i casi non coperti, dal SINTOMO utente ("un tocco per sbaglio
// cancella l'intero documento, senza modo di annullare"):
//   1. eliminare il file ATTIVO (con altri presenti) e annullare → torna e
//      ridiventa quello aperto, col suo testo; l'altro file non si perde;
//   2. eliminare dal TASTO DESTRO ("Elimina file") → l'annulla funziona uguale
//      (parità tra i due cammini di eliminazione);
//   3. testo con caratteri speciali/lungo preservato identico dopo il ripristino.

import { test, expect } from './fixtures/electron.mjs';

async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

test('annulla eliminazione del file ATTIVO: torna, è di nuovo aperto, l\'altro resta', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');

  // File 1 = ALFA.
  await page.click('#doc');
  await setDocText(page, 'contenuto ALFA');
  // File 2 = BETA (diventa l'attivo).
  await page.click('#docSwitch');
  await page.click('#docNew');
  await setDocText(page, 'contenuto BETA');

  // Elimina il file ATTIVO (BETA) dal menu.
  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item')).toHaveCount(2);
  await page.locator('.ed-doc-item').nth(1).locator('.ed-doc-del').click();
  await expect(page.locator('.ed-doc-item')).toHaveCount(1);
  // Non si resta senza documento aperto: mostra l'altro (ALFA), non BETA.
  await expect(page.locator('#doc')).toHaveText('contenuto ALFA');

  // Annulla: BETA torna ed è di nuovo il documento aperto.
  await page.click('.ed-toast-action');
  await expect(page.locator('#doc')).toHaveText('contenuto BETA');
  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item')).toHaveCount(2);
  // ALFA è ancora lì col suo testo.
  await page.locator('.ed-doc-item').nth(0).click();
  await expect(page.locator('#doc')).toHaveText('contenuto ALFA');
});

test('annulla eliminazione fatta dal tasto destro ("Elimina file")', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  await setDocText(page, 'testo da salvare');

  // Apri il menu del tasto destro sulla docbar e scegli "Elimina file".
  await page.locator('#docbar').click({ button: 'right' });
  const del = page.locator('.ed-title-ctxmenu .sn-select-option', { hasText: 'Elimina file' });
  await expect(del).toBeVisible();
  await del.click();
  // Era l'unico file → resta un foglio vuoto (contenuto sparito).
  await expect(page.locator('#doc')).not.toContainText('testo da salvare');

  // Il toast "Annulla" compare anche per questo cammino e ripristina il testo.
  await expect(page.locator('.ed-toast-action')).toBeVisible();
  await page.click('.ed-toast-action');
  await expect(page.locator('#doc')).toHaveText('testo da salvare');
});

test('il ripristino conserva testo lungo e caratteri speciali identici', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');

  const tricky = 'Riga con emoji 😀 e simboli <b>&amp;</b> àèìòù — ' + 'x'.repeat(500);
  await page.click('#doc');
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.textContent = t; // textContent: niente parsing HTML, resta letterale
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, tricky);

  // Secondo file così eliminiamo il primo senza cadere nel caso "ultimo file".
  await page.click('#docSwitch');
  await page.click('#docNew');
  await setDocText(page, 'altro');

  await page.click('#docSwitch');
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
  await page.click('.ed-toast-action');
  await page.click('#docSwitch');
  await page.locator('.ed-doc-item').nth(0).click();
  await expect(page.locator('#doc')).toHaveText(tricky);
});
