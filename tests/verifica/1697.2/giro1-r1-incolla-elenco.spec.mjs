// #1697.2 giro 1, rilievo 1: dentro una voce di elenco l'incolla lungo cresce ancora col quadrato delle righe
// (4000 righe circa 5 secondi), mentre in un paragrafo o in una citazione le stesse righe entrano in mezzo secondo.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(180_000);

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

for (const [dove, off] of [['a metà', 4], ['in fondo', 8]]) {
  test(`r1 ${dove} di una voce di elenco 4000 righe entrano senza fermare la pagina`, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await page.waitForSelector('#doc');
    await page.click('#doc');
    await page.evaluate((off) => {
      const doc = document.getElementById('doc');
      doc.innerHTML = '<ul><li>voce uno</li><li>voce due</li></ul><p>dopo</p>';
      doc.dispatchEvent(new Event('input', { bubbles: true }));
      getSelection().collapse(doc.querySelector('li').firstChild, off);
    }, off);
    const ms = await incolla(page, righe(4000));
    expect(await entrate(page)).toBe(4000);
    expect(ms, `incolla durato ${ms} ms`).toBeLessThan(2000);
  });
}
