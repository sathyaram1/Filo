// SPEC TEMPORANEO DI AUDIT (prober) — non va committato come test permanente.
// Esplora la gestione documenti dell'editor con input limite.

import { test, expect } from './fixtures/electron.mjs';

async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

test('probe: due eliminazioni ravvicinate — quante si possono annullare?', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');

  await setDocText(page, 'AAA');
  await page.click('#docSwitch');
  await page.click('#docNew');
  await setDocText(page, 'BBB');
  await page.click('#docSwitch');
  await page.click('#docNew');
  await setDocText(page, 'CCC');

  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item')).toHaveCount(3);

  // Elimina il primo (AAA) e subito dopo il secondo (BBB).
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item')).toHaveCount(2);
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();

  // Ora il toast: quante volte posso premere Annulla?
  const toastText = await page.locator('#edToast').innerText().catch(() => '(nessun toast)');
  console.log('TOAST DOPO 2 ELIMINAZIONI:', JSON.stringify(toastText));

  await page.locator('.ed-toast-action').click();
  await page.click('#docSwitch');
  const n = await page.locator('.ed-doc-item').count();
  const names = await page.locator('.ed-doc-item-name').allInnerTexts();
  console.log('DOPO UN ANNULLA — file:', n, names);

  // C'è ancora un modo di recuperare il primo eliminato?
  const stillToast = await page.locator('.ed-toast-action').count();
  console.log('altri pulsanti Annulla disponibili:', stillToast);
  await page.screenshot({ path: 'tests/.shots/probe-editor-2del.png' });
});

test('probe: nome documento lunghissimo / con markup', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await setDocText(page, 'testo');

  const longName = 'A'.repeat(400);
  await page.click('#docSwitch');
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-rename').click();
  await page.locator('.ed-doc-item-input').fill(longName);
  await page.keyboard.press('Enter');
  await page.click('#docSwitch');
  const box = await page.locator('#docPop').boundingBox();
  const vw = await page.evaluate(() => window.innerWidth);
  console.log('docPop box:', box, 'viewport w:', vw);
  await page.screenshot({ path: 'tests/.shots/probe-editor-longname.png' });

  // titolo nella docbar
  const titleBox = await page.locator('#docTitle').boundingBox();
  console.log('docTitle box:', titleBox);
});

test('probe: molti documenti — il menu resta usabile?', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  for (let i = 0; i < 14; i++) {
    await page.click('#docSwitch');
    await page.click('#docNew');
    await setDocText(page, 'doc ' + i);
  }
  await page.click('#docSwitch');
  const box = await page.locator('#docPop').boundingBox();
  const vh = await page.evaluate(() => window.innerHeight);
  const scroll = await page.evaluate(() => {
    const p = document.getElementById('docPop');
    return { scrollH: p.scrollHeight, clientH: p.clientHeight, overflowY: getComputedStyle(p).overflowY };
  });
  console.log('docPop con 15 file:', box, 'vh:', vh, scroll);
  // Il pulsante "Nuovo documento" è ancora raggiungibile?
  const newBox = await page.locator('#docNew').boundingBox();
  console.log('docNew box:', newBox);
  await page.screenshot({ path: 'tests/.shots/probe-editor-manyfiles.png' });
});
