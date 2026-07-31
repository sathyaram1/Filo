// SPEC TEMPORANEO DI AUDIT (prober) — non va committato come test permanente.

import { test, expect } from './fixtures/electron.mjs';

async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

// Apre il menu documenti in modo idempotente (il click su #docSwitch fa toggle).
async function openPop(page) {
  const hidden = await page.locator('#docPop').evaluate((el) => el.hidden);
  if (hidden) await page.click('#docSwitch');
  await expect(page.locator('#docPop')).toBeVisible();
}

test('probe: due eliminazioni ravvicinate — quante si possono annullare?', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');

  await setDocText(page, 'AAA');
  await openPop(page);
  await page.click('#docNew');
  await setDocText(page, 'BBB');
  await openPop(page);
  await page.click('#docNew');
  await setDocText(page, 'CCC');

  await openPop(page);
  await expect(page.locator('.ed-doc-item')).toHaveCount(3);

  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
  await openPop(page);
  await expect(page.locator('.ed-doc-item')).toHaveCount(2);
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();

  const toastText = await page.locator('#edToast').innerText().catch(() => '(nessun toast)');
  console.log('TOAST DOPO 2 ELIMINAZIONI:', JSON.stringify(toastText));

  await page.locator('.ed-toast-action').click();
  await openPop(page);
  const names = await page.locator('.ed-doc-item-name').allInnerTexts();
  console.log('DOPO UN ANNULLA — file:', names.length, JSON.stringify(names));
  const stillToast = await page.locator('.ed-toast-action').count();
  console.log('altri pulsanti Annulla disponibili:', stillToast);
  await page.screenshot({ path: 'tests/.shots/probe-editor-2del.png' });
});

test('probe: nome documento lunghissimo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await setDocText(page, 'testo');

  const longName = 'Appunti di lavoro molto molto lunghi ' + 'X'.repeat(300);
  await openPop(page);
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-rename').click();
  await page.locator('.ed-doc-item-input').fill(longName);
  await page.keyboard.press('Enter');

  const titleTxt = await page.locator('#docTitle').innerText();
  console.log('docTitle len:', titleTxt.length);
  const titleBox = await page.locator('#docTitle').boundingBox();
  const barBox = await page.locator('#docbar').boundingBox();
  console.log('docTitle box:', titleBox, 'docbar box:', barBox);

  await openPop(page);
  const popBox = await page.locator('#docPop').boundingBox();
  const itemBox = await page.locator('.ed-doc-item').nth(0).boundingBox();
  const delBox = await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').boundingBox();
  const vw = await page.evaluate(() => window.innerWidth);
  console.log('popBox:', popBox, 'itemBox:', itemBox, 'delBox:', delBox, 'vw:', vw);
  await page.screenshot({ path: 'tests/.shots/probe-editor-longname.png' });

  // Il tasto Elimina è ancora cliccabile con un nome enorme?
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click({ timeout: 5000 });
  console.log('elimina cliccabile: OK');
});

test('probe: storico versioni — sfoglia e ripristina', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await setDocText(page, 'versione uno');
  await page.keyboard.press('Control+s');
  await openPop(page);
  await page.click('#docHistory');
  await page.waitForTimeout(500);
  const html = await page.locator('#overlayBox').innerText().catch(() => '(no overlay)');
  console.log('STORICO (doc appena creato):', JSON.stringify(html.slice(0, 400)));
  await page.screenshot({ path: 'tests/.shots/probe-editor-history.png' });
});
