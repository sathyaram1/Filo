// #1697 giro 2, rilievo 1: un incolla lungo ferma ancora la pagina quando la selezione parte da una voce di elenco e
// finisce fuori, o quando arriva a metà di un paragrafo con migliaia di righe.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(240_000);

const righe = (n) => Array.from({ length: n }, (_, i) => `riga numero ${i} del testo incollato`).join('\n');
async function incolla(page, testo) {
  return page.evaluate((t) => {
    const dt = new DataTransfer(); dt.setData('text/plain', t);
    const t0 = performance.now();
    document.getElementById('doc').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return Math.round(performance.now() - t0);
  }, testo);
}
const entrate = (page) => page.evaluate(() => (document.getElementById('doc').innerText.match(/riga numero \d+ del testo incollato/g) || []).length);
async function apri(openTab) {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  return page;
}

test('r1 tre voci di elenco selezionate a tastiera, incolla 1000 righe: entra senza fermare la pagina', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.keyboard.type('- uno');
  await page.keyboard.press('Enter');
  await page.keyboard.type('due');
  await page.keyboard.press('Enter');
  await page.keyboard.type('tre');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  const ms = await incolla(page, righe(1000));
  expect(await entrate(page)).toBe(1000);
  expect(ms, `incolla durato ${ms} ms`).toBeLessThan(2000);
});

test('r1 selezione da metà di una voce di elenco a metà del paragrafo sotto, incolla 1000 righe: entra senza fermare la pagina', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<ul><li>voce uno</li><li>voce due</li></ul><p>paragrafo dopo</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
    const r = document.createRange();
    r.setStart(doc.querySelectorAll('li')[1].firstChild, 3);
    r.setEnd(doc.querySelector('p').firstChild, 5);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  const ms = await incolla(page, righe(1000));
  expect(await entrate(page)).toBe(1000);
  await expect(page.locator('#doc')).toContainText('voc');
  await expect(page.locator('#doc')).toContainText('grafo dopo');
  expect(ms, `incolla durato ${ms} ms`).toBeLessThan(2000);
});

test('r1 a metà di un paragrafo incolla 3000 righe: entra senza fermare la pagina', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>primo</p><p>prima parte dopo parte</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
    getSelection().collapse(doc.querySelectorAll('p')[1].firstChild, 12);
  });
  const ms = await incolla(page, righe(3000));
  expect(await entrate(page)).toBe(3000);
  expect(ms, `incolla durato ${ms} ms`).toBeLessThan(3000);
});
