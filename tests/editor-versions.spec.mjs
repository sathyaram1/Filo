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

  // Percorso utente reale: compare l'avviso "Annulla" e cliccandolo il documento
  // torna IDENTICO a prima (testo invariato, grassetto sparito).
  const undoBtn = page.locator('#edToast .ed-toast-action');
  await expect(undoBtn).toHaveText('Annulla');
  await undoBtn.click();
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

// La SCHERMATA storico versioni (feedback #379): dal menu documenti in alto a
// sinistra si apre il pannello con TUTTE le versioni salvate (recente → vecchia),
// con la sorgente giusta e un'anteprima; ripristinando a mano una versione più
// vecchia il documento torna ESATTAMENTE a quel contenuto. Senza il pannello il
// menu non avrebbe la voce, la lista non comparirebbe e il ripristino "a mano"
// dalla UI non riporterebbe lo stato pre-modifica → rosso.
test('storico versioni: si sfoglia dal menu e ripristina una versione più vecchia', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  // Tre modifiche automatiche di Filo, ciascuna su un testo diverso: ogni edit
  // salva come punto di ripristino il contenuto PRE-modifica (testo semplice).
  await page.click('#doc');
  for (const word of ['Alpha', 'Bravo', 'Charlie']) {
    await setDocText(page, word);
    await filoAutoEdit(page);
  }
  const total = await page.evaluate(() => window.__filoEditorVersions.list().length);
  expect(total).toBe(3);

  // Percorso utente reale: apri il selettore documenti (in alto a sinistra) e la
  // voce "Storico versioni".
  await page.click('#docSwitch');
  await page.click('#docHistory');

  // Il pannello mostra TUTTE e tre le versioni, dalla più recente in alto.
  const items = page.locator('.ed-vh-item');
  await expect(items).toHaveCount(3);
  // Sorgente evidenziata: tutte create da una modifica di Filo.
  await expect(page.locator('.ed-vh-badge.filo')).toHaveCount(3);
  await expect(items.first()).toContainText('Modifica di Filo');
  // Ordine cronologico inverso: in cima l'ultimo stato salvato (pre-"Charlie"),
  // in fondo il più vecchio (pre-"Alpha").
  await expect(items.first().locator('.ed-vh-prev')).toContainText('Bravo');
  await expect(items.last().locator('.ed-vh-prev')).toContainText('Alpha');

  // Ripristina la versione PIÙ VECCHIA (in fondo): il documento deve tornare
  // ESATTAMENTE a quel contenuto — testo "Alpha", senza il grassetto di Filo.
  await items.last().locator('.ed-vh-restore').click();
  await expect(page.locator('#doc')).toHaveText('Alpha');
  await expect(page.locator('#doc strong')).toHaveCount(0);
});

// L'anteprima ampia prima di ripristinare: clic su una riga apre l'anteprima
// della versione e da lì la si ripristina. Prova che il cammino "guardo poi
// ripristino" porta al contenuto giusto.
test('storico versioni: anteprima di una versione e ripristino dall\'anteprima', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  await page.click('#doc');
  await setDocText(page, 'Testo originale da ritrovare');
  await filoAutoEdit(page);
  await setDocText(page, 'Testo cambiato dopo');
  await filoAutoEdit(page);

  await page.click('#docSwitch');
  await page.click('#docHistory');

  // Apri l'anteprima della versione più vecchia (il testo originale).
  await page.locator('.ed-vh-item').last().click();
  await expect(page.locator('.ed-vh-fulltext')).toContainText('Testo originale da ritrovare');

  // Ripristina dalla schermata di anteprima: il documento torna a quel testo.
  await page.click('#vhRestore');
  await expect(page.locator('#doc')).toContainText('Testo originale da ritrovare');
  await expect(page.locator('#doc strong')).toHaveCount(0);
});
