// Esplorazione temporanea (#1697): tempi dell'incolla lungo nei casi di contorno. Si cancella prima della consegna.
import { test } from './fixtures/electron.mjs';

async function incolla(app, page, testo) {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);
  const t0 = Date.now();
  await page.keyboard.press('Control+V');
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  return Date.now() - t0;
}

test('esplora', async ({ app, openTab }) => {
  test.setTimeout(300_000);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  const righe = (n) => Array.from({ length: n }, (_, i) => `Riga ${i} del testo`).join('\n');
  for (const n of [600, 1500]) {
    await page.evaluate(() => { const d = document.getElementById('doc'); d.innerHTML = '<p>uno due</p><p>tre quattro</p>'; d.focus(); });
    await page.keyboard.press('Control+A');
    const ms = await incolla(app, page, righe(n));
    const esito = await page.evaluate(() => ({ n: document.querySelectorAll('#doc > p').length, a: document.querySelector('#doc > p').textContent }));
    await page.keyboard.press('Control+Z');
    const dopo = await page.evaluate(() => document.getElementById('doc').innerHTML);
    console.log('ctrl+a', n, ms, JSON.stringify(esito), dopo);
  }
  for (const n of [600, 1500]) {
    await page.evaluate(() => {
      const d = document.getElementById('doc'); d.innerHTML = '<p>uno due</p><p>tre quattro</p><p>cinque</p>'; d.focus();
      const r = document.createRange(); r.setStart(d.firstChild.firstChild, 4); r.setEnd(d.children[1].firstChild, 3); getSelection().removeAllRanges(); getSelection().addRange(r);
    });
    const ms = await incolla(app, page, righe(n));
    const esito = await page.evaluate(() => [...document.querySelectorAll('#doc > p')].map((p) => p.textContent).filter((t, i, a) => i < 2 || i > a.length - 3));
    await page.keyboard.press('Control+Z');
    const dopo = await page.evaluate(() => document.getElementById('doc').innerHTML);
    console.log('due blocchi', n, ms, JSON.stringify(esito), dopo);
  }
  for (const n of [600, 1500]) {
    await page.evaluate(() => {
      const d = document.getElementById('doc'); d.innerHTML = '<ul><li>a</li></ul><p><br></p>'; d.focus();
      const r = document.createRange(); r.setStart(d.lastChild, 0); getSelection().removeAllRanges(); getSelection().addRange(r);
    });
    const ms = await incolla(app, page, righe(n));
    console.log('vuoto dopo elenco', n, ms);
  }
});
