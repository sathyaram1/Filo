// Eliminazione di un documento nell'editor: deve restare RECUPERABILE anche se
// arrivano altri avvisi o se si chiude e riapre la pagina.
//
// Prima c'era un solo avviso riusato: il secondo avviso distruggeva il primo
// insieme al suo "Annulla", e il documento appena eliminato diventava
// irrecuperabile (nessun cestino, storico versioni buttato via). Questi test
// asseriscono il SUCCESSO del recupero — il documento torna col SUO testo — non
// l'assenza di un messaggio d'errore.

import { expect, test } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shotsDir = join(__dirname, '.shots');

// Sostituisce il contenuto del foglio e notifica l'editor (come la digitazione).
async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

async function newDocWithText(page, text) {
  await page.click('#docSwitch');
  await page.click('#docNew');
  await setDocText(page, text);
  await expect(page.locator('#doc')).toHaveText(text);
}

// Testo di tutti i documenti della collezione (dal menu, senza aprirli uno a uno).
async function docTexts(page) {
  return page.evaluate(() => {
    const col = JSON.parse(localStorage.getItem('filo.editor.collection'));
    const plain = (f) => JSON.stringify(f && f.content || '');
    return (col.files || []).map(plain);
  });
}

test('due eliminazioni di fila: l\'"Annulla" del PRIMO documento è ancora lì e lo riporta indietro', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => { localStorage.removeItem('filo.editor.trash'); });

  // Tre documenti con testi diversi.
  await page.click('#doc');
  await setDocText(page, 'contenuto ALFA');
  await newDocWithText(page, 'contenuto BETA');
  await newDocWithText(page, 'contenuto GAMMA');

  // Elimina il primo e, SENZA aspettare, anche il secondo.
  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item')).toHaveCount(3);
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
  await expect(page.locator('.ed-doc-item')).toHaveCount(1);

  // Entrambi gli avvisi sono in piedi, ciascuno col suo "Annulla".
  const toasts = page.locator('.ed-toast.show');
  await expect(toasts).toHaveCount(2);
  await expect(page.locator('.ed-toast.show .ed-toast-action')).toHaveCount(2);
  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: join(shotsDir, 'editor-trash-two-toasts.png') });

  // Premo l'"Annulla" del PRIMO avviso (il documento ALFA, eliminato per primo).
  await toasts.first().locator('.ed-toast-action').click();

  // ALFA è tornato: due documenti, e il ripristinato ha il SUO testo.
  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item')).toHaveCount(2);
  const texts = await docTexts(page);
  expect(texts.join('|')).toContain('contenuto ALFA');
  expect(texts.join('|')).toContain('contenuto GAMMA');
});

test('un documento eliminato resta nel cestino e si recupera anche dopo aver riaperto la pagina', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => {
    localStorage.removeItem('filo.editor.trash');
    localStorage.removeItem('filo.editor.collection');
  });
  await page.reload();
  await page.waitForSelector('#doc');

  await page.click('#doc');
  await setDocText(page, 'testo da recuperare');
  await newDocWithText(page, 'documento che resta');

  // Elimina il primo documento.
  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item')).toHaveCount(2);
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
  await expect(page.locator('.ed-doc-item')).toHaveCount(1);

  // Chiudi e riapri la pagina: l'avviso con "Annulla" non c'è più, ma il
  // documento non è perso.
  await page.reload();
  await page.waitForSelector('#doc');
  await expect(page.locator('.ed-toast')).toHaveCount(0);

  await page.click('#docSwitch');
  await expect(page.locator('#docTrash')).toContainText('Cestino (1)');
  await page.click('#docTrash');

  const item = page.locator('.ed-tr-item');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('testo da recuperare');
  await page.screenshot({ path: join(shotsDir, 'editor-trash-panel.png') });

  await page.locator('.ed-tr-restore').click();

  // Il documento è tornato nell'elenco col suo testo, e il cestino si è svuotato.
  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item')).toHaveCount(2);
  const texts = await docTexts(page);
  expect(texts.join('|')).toContain('testo da recuperare');
  await expect(page.locator('#docTrash')).toHaveCount(0);
});

test('dal cestino si può anche buttare via per sempre, ma solo confermando', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => {
    localStorage.removeItem('filo.editor.trash');
    localStorage.removeItem('filo.editor.collection');
  });
  await page.reload();
  await page.waitForSelector('#doc');

  await page.click('#doc');
  await setDocText(page, 'contenuto usa e getta');
  await newDocWithText(page, 'documento che resta');

  await page.click('#docSwitch');
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
  await page.click('#docTrash');
  await expect(page.locator('.ed-tr-item')).toHaveCount(1);

  // Primo click: chiede conferma (niente eliminazione silenziosa).
  const purge = page.locator('.ed-tr-purge');
  await purge.click();
  await expect(purge).toHaveText('Confermi?');
  await expect(page.locator('.ed-tr-item')).toHaveCount(1);

  // Secondo click: via davvero.
  await purge.click();
  await expect(page.locator('.ed-tr-item')).toHaveCount(0);
  await expect(page.locator('.ed-vh-empty')).toContainText('Nessun documento eliminato');
});
