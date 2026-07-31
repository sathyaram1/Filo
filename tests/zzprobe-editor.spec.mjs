// PROBE temporaneo (audit prober): edge case sull'editor multi-file.
import { test, expect } from './fixtures/electron.mjs';

async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

test('probe: elimina un file NON attivo e annulla', async ({ openTab }) => {
  test.setTimeout(120000);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');

  await page.click('#doc');
  await setDocText(page, 'UNO');
  await page.click('#docSwitch');
  await page.click('#docNew');
  await setDocText(page, 'DUE');
  await page.click('#docSwitch');
  await page.click('#docNew');
  await setDocText(page, 'TRE');

  // Elimina il file "UNO" (non attivo) dal menu documenti.
  await page.click('#docSwitch');
  const items = page.locator('.ed-doc-item');
  console.log('PROBE items count', await items.count());
  const html = await page.locator('#docPop').innerHTML();
  console.log('PROBE docPop html:', html.slice(0, 1500));
});

test('probe: titolo lunghissimo nella docbar', async ({ openTab }) => {
  test.setTimeout(120000);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  await setDocText(page, 'testo');
  const long = 'Titolo interminabile '.repeat(20);
  await page.evaluate((t) => {
    // rinomina via UI: apri il menu titolo (tasto destro) non serve, usa l'input inline
    const ev = new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 30 });
    document.querySelector('.ed-doc-title').dispatchEvent(ev);
  }, long).catch(() => {});
  await page.waitForTimeout(300);
  const menu = await page.locator('.ed-title-ctxmenu').count();
  console.log('PROBE title ctxmenu count', menu);
  if (menu) {
    const labels = await page.locator('.ed-title-ctxmenu .sn-select-option').allTextContents();
    console.log('PROBE title menu labels', JSON.stringify(labels));
    await page.locator('.ed-title-ctxmenu .sn-select-option', { hasText: 'Rinomina' }).click();
    await page.fill('.ed-doc-title-input', long);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const box = await page.locator('.ed-doc-title').boundingBox();
    const win = await page.evaluate(() => ({ w: window.innerWidth, scrollW: document.documentElement.scrollWidth }));
    console.log('PROBE title box', JSON.stringify(box), JSON.stringify(win));
    await page.screenshot({ path: 'tests/.shots/probe-long-title.png' });
  }
});
