// #1697 giro 1, rilievo 1: un incolla lungo che sostituisce una selezione toccando un elenco o un titolo, o che arriva
// in una citazione o nel paragrafo vuoto dopo un elenco, ferma ancora la pagina per secondi.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(180_000);

const righe = (n) => Array.from({ length: n }, (_, i) => `riga numero ${i} del testo incollato`).join('\n');

async function prepara(page, html, selettore, dove) {
  await page.evaluate(({ html, selettore, dove }) => {
    const doc = document.getElementById('doc');
    doc.focus();
    doc.innerHTML = html;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
    const el = doc.querySelector(selettore);
    const t = el.lastChild && el.lastChild.nodeType === 3 ? el.lastChild : el;
    const r = document.createRange();
    r.setStart(t, dove === 'fine' && t.nodeType === 3 ? t.length : 0);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
  }, { html, selettore, dove });
}

async function incolla(page, testo) {
  return page.evaluate((t) => {
    const dt = new DataTransfer(); dt.setData('text/plain', t);
    const t0 = performance.now();
    document.getElementById('doc').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return Math.round(performance.now() - t0);
  }, testo);
}

const entrate = (page) => page.evaluate(() => (document.getElementById('doc').innerText.match(/riga numero \d+ del testo incollato/g) || []).length);

test('r1 seleziona tutto (titolo, testo, elenco) e incolla 1000 righe: entra senza fermare la pagina', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await prepara(page, '<h1>Titolo</h1><p>testo di prima</p><ul><li>voce a</li><li>voce b</li></ul>', 'p', 0);
  await page.keyboard.press('Control+a');
  const ms = await incolla(page, righe(1000));
  expect(await entrate(page)).toBe(1000);
  await expect(page.locator('#doc')).not.toContainText('testo di prima');
  expect(ms, `incolla durato ${ms} ms`).toBeLessThan(2000);
});

test('r1 in fondo a una citazione incolla 600 righe: entra senza fermare la pagina', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await prepara(page, '<blockquote>citato</blockquote>', 'blockquote', 'fine');
  const ms = await incolla(page, righe(600));
  expect(await entrate(page)).toBe(600);
  expect(ms, `incolla durato ${ms} ms`).toBeLessThan(2000);
});

test('r1 nel paragrafo vuoto dopo un elenco incolla 1500 righe: entra senza fermare la pagina', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await prepara(page, '<ul><li>uno</li><li>due</li></ul><p><br></p>', 'p', 0);
  const ms = await incolla(page, righe(1500));
  expect(await entrate(page)).toBe(1500);
  expect(ms, `incolla durato ${ms} ms`).toBeLessThan(2000);
});
