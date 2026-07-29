// Editor multi-file: creare più documenti, scriverci dentro, passare dall'uno
// all'altro e verificare che i contenuti restino SEPARATI e persistano dopo un
// reload. Copre anche la gestione (rinomina, elimina) e l'invariante "resta
// sempre almeno un file".
//
// Il test asserisce il SUCCESSO della feature (il testo giusto nel file giusto),
// non l'assenza di un errore: senza la collezione multi-file scriverebbe tutto
// in un unico documento e la separazione fallirebbe.

import { test, expect } from './fixtures/electron.mjs';

// Sostituisce il contenuto del foglio e notifica l'editor (come la digitazione).
async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

test('due file: contenuti separati, switch corretto e persistenza dopo reload', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');

  // File 1: scrivi.
  await page.click('#doc');
  await setDocText(page, 'contenuto ALFA');
  await expect(page.locator('#doc')).toHaveText('contenuto ALFA');

  // Crea un secondo documento dal menu.
  await page.click('#docSwitch');
  await page.click('#docNew');
  // Il nuovo file è vuoto: nessuna traccia di ALFA.
  await expect(page.locator('#doc')).not.toContainText('ALFA');
  await setDocText(page, 'contenuto BETA');
  await expect(page.locator('#doc')).toHaveText('contenuto BETA');

  // Ora ci sono due voci nel menu documenti.
  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item')).toHaveCount(2);

  // Torna al primo file: deve mostrare ALFA (non BETA).
  await page.locator('.ed-doc-item').nth(0).click();
  await expect(page.locator('#doc')).toHaveText('contenuto ALFA');

  // Passa di nuovo al secondo: BETA. Separazione confermata.
  await page.click('#docSwitch');
  await page.locator('.ed-doc-item').nth(1).click();
  await expect(page.locator('#doc')).toHaveText('contenuto BETA');

  // Forza il salvataggio e ricarica: la collezione e il file attivo persistono.
  await page.keyboard.press('Control+s');
  await expect(page.locator('.ed-save-state')).toHaveText('Salvato');
  await page.reload();
  await page.waitForSelector('#doc');
  // Riapre sull'ultimo file attivo (BETA)…
  await expect(page.locator('#doc')).toHaveText('contenuto BETA');
  // …e l'altro file è ancora lì col suo contenuto.
  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item')).toHaveCount(2);
  await page.locator('.ed-doc-item').nth(0).click();
  await expect(page.locator('#doc')).toHaveText('contenuto ALFA');
});

test('rinomina: il nome scelto compare nel selettore e nel menu', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#docSwitch');
  // Avvia la rinomina del file attivo (matita).
  await page.locator('.ed-doc-item').first().locator('.ed-doc-rename').click();
  const input = page.locator('.ed-doc-item-input');
  await input.fill('Capitolo 1');
  await input.press('Enter');
  // Il selettore mostra il nuovo nome.
  await expect(page.locator('#docTitle')).toHaveText('Capitolo 1');
  // E riaprendo il menu la voce ha il nuovo nome.
  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item-name').first()).toHaveText('Capitolo 1');
});

test('elimina: rimuove il file; eliminare l\'ultimo lascia comunque un foglio vuoto', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  await setDocText(page, 'da cancellare');

  // Crea un secondo file così ne restano due.
  await page.click('#docSwitch');
  await page.click('#docNew');
  await setDocText(page, 'resto io');

  // Elimina il primo file dal menu. Il menu resta aperto per gestirne altri.
  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item')).toHaveCount(2);
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
  await expect(page.locator('.ed-doc-item')).toHaveCount(1);

  // Elimina anche l'ultimo: invariante → resta un foglio vuoto, non zero file.
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
  await expect(page.locator('.ed-doc-item')).toHaveCount(1);
  await expect(page.locator('#doc')).not.toContainText('resto io');
});

test('annulla eliminazione: il file cancellato torna col suo contenuto', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');

  // File 1 = ALFA.
  await page.click('#doc');
  await setDocText(page, 'contenuto ALFA');

  // File 2 = BETA (attivo).
  await page.click('#docSwitch');
  await page.click('#docNew');
  await setDocText(page, 'contenuto BETA');

  // Elimina il file NON attivo (ALFA) dal menu.
  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item')).toHaveCount(2);
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
  await expect(page.locator('.ed-doc-item')).toHaveCount(1);

  // Il toast offre "Annulla": cliccandolo il file torna, alla sua posizione.
  await page.click('.ed-toast-action');
  await expect(page.locator('.ed-doc-item')).toHaveCount(2);

  // Il file ripristinato ha ancora ALFA; il file attivo BETA non è stato perso.
  await page.locator('.ed-doc-item').nth(0).click();
  await expect(page.locator('#doc')).toHaveText('contenuto ALFA');
  await page.click('#docSwitch');
  await page.locator('.ed-doc-item').nth(1).click();
  await expect(page.locator('#doc')).toHaveText('contenuto BETA');
});

test('annulla eliminazione dell\'ultimo file: torna il documento, non il foglio vuoto', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  await setDocText(page, 'unico documento');

  // Elimina l'unico file: invariante → compare un foglio vuoto al suo posto.
  await page.click('#docSwitch');
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
  await expect(page.locator('#doc')).not.toContainText('unico documento');

  // Annulla: il foglio vuoto viene tolto e torna il documento originale.
  await page.click('.ed-toast-action');
  await expect(page.locator('#doc')).toHaveText('unico documento');
  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item')).toHaveCount(1);
});
