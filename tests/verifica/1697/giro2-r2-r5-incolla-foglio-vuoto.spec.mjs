// #1697 giro 2. r2: un incolla lungo in un foglio vuoto cancella la storia dell'annulla di prima.
// r5: un incolla lungo in una citazione appena aperta lascia una riga di citazione vuota sopra il testo.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(120_000);

const righe = (n) => Array.from({ length: n }, (_, i) => `riga numero ${i} del testo incollato`).join('\n');
async function incolla(page, testo) {
  await page.evaluate((t) => {
    const dt = new DataTransfer(); dt.setData('text/plain', t);
    document.getElementById('doc').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, testo);
}
async function apri(openTab) {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  return page;
}

test('r2 testo scritto e cancellato tutto, incolla 600 righe: due annulla riportano il testo cancellato', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.keyboard.type('abc def');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await incolla(page, righe(600));
  await expect(page.locator('#doc')).toContainText('riga numero 599');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#doc')).toHaveText('abc def');
});

test('r2 titolo vuoto appena aperto, incolla 600 righe e annulla: il titolo vuoto torna', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.keyboard.type('# ');
  await expect(page.locator('#doc h1')).toHaveCount(1);
  await incolla(page, righe(600));
  await expect(page.locator('#doc')).toContainText('riga numero 599');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#doc h1')).toHaveCount(1);
  await expect(page.locator('#doc')).not.toContainText('riga numero');
});

test('r5 citazione appena aperta, incolla 60 righe: la prima riga incollata è la prima riga della citazione', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.keyboard.type('> ');
  await incolla(page, righe(60));
  await expect(page.locator('#doc blockquote').first()).toContainText('riga numero 0');
  const invisibili = await page.evaluate(() => (document.getElementById('doc').textContent.match(/​/g) || []).length);
  expect(invisibili).toBe(0);
});
