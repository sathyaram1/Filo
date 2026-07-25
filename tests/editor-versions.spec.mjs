// Versionamento dell'editor: ogni modifica AUTOMATICA di Filo (le "azioni di
// formattazione" che la chat applica al documento) deve creare un punto di
// ripristino, così è SEMPRE possibile tornare indietro. Lo storico vive
// sull'archivio file dell'app, quindi sopravvive al reload.
//
// I test asseriscono il SUCCESSO della feature:
//   1) dopo una modifica automatica di Filo, ripristinando la versione
//      precedente il contenuto torna IDENTICO a prima (non solo "nessun errore");
//   2) lo storico è ancora presente e ripristinabile dopo un reload.
// Senza il versionamento, l'hook di test non esisterebbe, la lista sarebbe vuota
// e il ripristino non riporterebbe il documento allo stato pre-modifica → rosso.

import { test, expect } from './fixtures/electron.mjs';

async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

// Simula una modifica automatica di Filo: la stessa via che usa la chat quando
// il modello risponde con azioni di formattazione (grassetto su tutto il testo).
async function filoAutoEdit(page) {
  return page.evaluate(() => window.__filoEditorFormat.applyFormatActions([{ style: 'bold', target: 'all' }]));
}

test('una modifica automatica di Filo è annullabile: il contenuto torna identico', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  await page.click('#doc');
  await setDocText(page, 'Cappuccetto Rosso');

  // Stato di partenza: nessun grassetto, nessuna versione ancora.
  await expect(page.locator('#doc strong')).toHaveCount(0);
  const before = await page.locator('#doc').textContent();
  const startVers = await page.evaluate(() => window.__filoEditorVersions.list().length);

  // Modifica AUTOMATICA di Filo: mette in grassetto tutto il testo.
  const touched = await filoAutoEdit(page);
  expect(touched).toBeGreaterThan(0);
  // La modifica è avvenuta davvero (c'è il grassetto)…
  await expect(page.locator('#doc strong')).toHaveCount(1);
  // …ed è stato creato un punto di ripristino etichettato come modifica di Filo.
  const afterVers = await page.evaluate(() => window.__filoEditorVersions.list());
  expect(afterVers.length).toBe(startVers + 1);
  expect(afterVers[afterVers.length - 1].source).toBe('filo');
  expect(afterVers[afterVers.length - 1].label).toMatch(/Filo/);

  // Ripristina la versione pre-modifica: il documento torna IDENTICO a prima
  // (testo invariato, grassetto sparito).
  await page.evaluate(() => {
    const v = window.__filoEditorVersions;
    const id = v.activeId();
    const list = v.list(id);
    v.restore(id, list[0].id); // la prima versione = stato prima della modifica di Filo
  });
  await expect(page.locator('#doc strong')).toHaveCount(0);
  await expect(page.locator('#doc')).toHaveText(before.trim());
});

test('lo storico delle versioni sopravvive al reload', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  await page.click('#doc');
  await setDocText(page, 'Bianca come il latte');

  await filoAutoEdit(page);
  const idBefore = await page.evaluate(() => window.__filoEditorVersions.activeId());
  const countBefore = await page.evaluate(() => window.__filoEditorVersions.list().length);
  expect(countBefore).toBeGreaterThan(0);

  // Assicura che lo storico sia stato scritto sull'archivio prima di ricaricare.
  await page.evaluate(() => window.__filoEditorVersions.flush());

  await page.reload();
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  // Lo storico è ancora lì per lo stesso file, con lo stesso numero di versioni…
  const countAfter = await page.evaluate((id) => window.__filoEditorVersions.list(id).length, idBefore);
  expect(countAfter).toBe(countBefore);

  // …e la versione è ancora RIPRISTINABILE (riporta lo stato pre-modifica: niente
  // grassetto). Questo prova che il contenuto salvato è sopravvissuto, non solo
  // che esiste una riga di storico.
  await page.evaluate((id) => {
    const v = window.__filoEditorVersions;
    const list = v.list(id);
    v.restore(id, list[0].id);
  }, idBefore);
  await expect(page.locator('#doc strong')).toHaveCount(0);
  await expect(page.locator('#doc')).toContainText('Bianca come il latte');
});
