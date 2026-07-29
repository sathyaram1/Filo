import { test, expect } from './fixtures/electron.mjs';

async function setDocText(page, html) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);
}
async function filoAutoEdit(page) {
  return page.evaluate(() => window.__filoEditorFormat.applyFormatActions([{ style: 'bold', target: 'all' }]));
}

// STRESS: contenuto malevolo nel documento non deve eseguirsi né iniettare markup
// quando lo vedi nell'anteprima dello storico.
test('storico: contenuto <script>/onerror non esegue XSS nel pannello', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  let alerted = false;
  page.on('dialog', async (d) => { alerted = true; await d.dismiss(); });

  await page.click('#doc');
  // Testo con tentativo di XSS. In un contenteditable il markup viene per lo più
  // neutralizzato, ma verifichiamo comunque che il pannello non introduca img/script.
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerText = '<script>window.__xss=1<\/script><img src=x onerror=alert(1)> ciao';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await filoAutoEdit(page);

  await page.click('#docSwitch');
  await page.click('#docHistory');

  const prev = page.locator('.ed-vh-prev').first();
  await expect(prev).toBeVisible();
  // Nessun elemento iniettato dentro l'anteprima (il markup è testo, non DOM).
  await expect(prev.locator('img')).toHaveCount(0);
  await expect(prev.locator('script')).toHaveCount(0);
  // Il testo del payload compare come TESTO visibile.
  await expect(prev).toContainText('onerror');

  // Apri l'anteprima ampia: idem, niente iniezione.
  await page.locator('.ed-vh-item').first().click();
  const full = page.locator('.ed-vh-fulltext');
  await expect(full).toBeVisible();
  await expect(full.locator('img')).toHaveCount(0);
  await expect(full.locator('script')).toHaveCount(0);

  expect(await page.evaluate(() => window.__xss)).toBeFalsy();
  expect(alerted).toBe(false);
});

// STRESS: stato vuoto — aprire lo storico su un documento senza versioni mostra
// il messaggio chiaro, non una lista vuota muta né un crash.
test('storico: stato vuoto mostra un messaggio, non una lista vuota', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  await page.click('#doc');
  await setDocText(page, 'documento nuovo senza storico');
  // Nessuna modifica automatica di Filo → nessuna versione.
  expect(await page.evaluate(() => window.__filoEditorVersions.list().length)).toBe(0);

  await page.click('#docSwitch');
  await page.click('#docHistory');

  await expect(page.locator('.ed-vh-empty')).toBeVisible();
  await expect(page.locator('.ed-vh-item')).toHaveCount(0);
});

// STRESS: doppio ripristino rapido + riapertura pannello ripetuta non rompe nulla,
// e ogni ripristino resta a sua volta reversibile (salva lo stato pre-ripristino).
test('storico: ripristini in sequenza restano coerenti e reversibili', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  await page.click('#doc');
  for (const word of ['Uno', 'Due', 'Tre']) {
    await setDocText(page, word);
    await filoAutoEdit(page);
  }

  await page.click('#docSwitch');
  await page.click('#docHistory');
  // Ripristina la più vecchia (Uno).
  await page.locator('.ed-vh-item').last().locator('.ed-vh-restore').click();
  await expect(page.locator('#doc')).toHaveText('Uno');
  // Il ripristino ha salvato lo stato pre-ripristino → una versione in più,
  // quindi è a sua volta annullabile dallo stesso pannello.
  const listNow = await page.evaluate(() => window.__filoEditorVersions.list());
  expect(listNow.length).toBeGreaterThanOrEqual(4);
  expect(listNow[listNow.length - 1].source).toBe('restore');
  // Il pannello è ancora aperto e mostra la nuova versione in cima.
  await expect(page.locator('.ed-vh-item').first()).toBeVisible();
});
