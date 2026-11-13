// esplorazione #1697.2 giro 3: a capo di Windows, annulla e ripeti dopo l'incolla lungo nelle posizioni della segnalazione.
import { test } from '../../fixtures/electron.mjs';

test.setTimeout(240_000);
const ctrl = process.platform === 'darwin' ? 'Meta' : 'Control';
const casi = [
  ['voci fin fuori', '<ul><li>uno</li><li>due</li><li>tre</li></ul><p>dopo il testo</p>', (d) => { const r = document.createRange(); r.setStart(d.querySelectorAll('li')[1].firstChild, 0); r.setEnd(d.querySelector('p').firstChild, 0); getSelection().removeAllRanges(); getSelection().addRange(r); }],
  ['meta voce a meta paragrafo', '<ul><li>voce uno</li><li>voce due</li></ul><p>paragrafo sotto</p>', (d) => { const r = document.createRange(); r.setStart(d.querySelectorAll('li')[1].firstChild, 3); r.setEnd(d.querySelector('p').firstChild, 9); getSelection().removeAllRanges(); getSelection().addRange(r); }],
  ['meta paragrafo', '<p>primo paragrafo</p><p>secondo paragrafo</p>', (d) => { getSelection().collapse(d.querySelectorAll('p')[1].firstChild, 7); }],
];

for (const [nome, html, sel] of casi) {
  test(`annulla e ripeti ${nome}, a capo di Windows`, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await page.waitForSelector('#doc');
    await page.click('#doc');
    await page.evaluate((h) => { const d = document.getElementById('doc'); d.innerHTML = h; d.dispatchEvent(new Event('input', { bubbles: true })); }, html);
    await page.waitForTimeout(700);
    const prima = await page.evaluate(() => document.getElementById('doc').innerHTML);
    await page.evaluate(`(${sel})(document.getElementById('doc'))`);
    const testo = Array.from({ length: 1500 }, (_, i) => `riga ${i}`).join('\r\n');
    const ms = await page.evaluate((t) => {
      const dt = new DataTransfer(); dt.setData('text/plain', t);
      const t0 = performance.now();
      document.getElementById('doc').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return Math.round(performance.now() - t0);
    }, testo);
    const dopo = await page.evaluate(() => { const d = document.getElementById('doc'); return { html: d.innerHTML, cr: /\r/.test(d.innerHTML), n: (d.innerText.match(/riga \d+/g) || []).length }; });
    await page.keyboard.press(`${ctrl}+z`);
    const annullato = await page.evaluate(() => document.getElementById('doc').innerHTML);
    await page.keyboard.press(`${ctrl}+y`);
    const ripetuto = await page.evaluate(() => (document.getElementById('doc').innerText.match(/riga \d+/g) || []).length);
    console.log(`${nome}: ${ms} ms, righe ${dopo.n}, cr ${dopo.cr}, annulla identico ${annullato === prima}, ripeti ${ripetuto}`);
    if (annullato !== prima) console.log('  prima ' + prima.slice(0, 200) + '\n  annul ' + annullato.slice(0, 200));
  });
}
