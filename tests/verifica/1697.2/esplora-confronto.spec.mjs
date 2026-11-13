// esplorazione #1697.2 giro 3: stesso punto, incolla corto contro lungo.
import { test } from '../../fixtures/electron.mjs';

test.setTimeout(240_000);
const righe = (n) => Array.from({ length: n }, (_, i) => `riga ${i}`).join('\n');
const ctrl = process.platform === 'darwin' ? 'Meta' : 'Control';

const casi = [
  ['codice', '<pre>codice uno\ncodice due</pre><p>sotto</p>', (d) => { getSelection().collapse(d.querySelector('pre').firstChild, 4); }],
  ['codice in fondo', '<pre>codice uno</pre><p>sotto</p>', (d) => { const t = d.querySelector('pre').firstChild; getSelection().collapse(t, t.length); }],
  ['cella', '<table><tbody><tr><td>cella uno</td><td>due</td></tr></tbody></table><p>sotto</p>', (d) => { getSelection().collapse(d.querySelector('td').firstChild, 3); }],
  ['grassetto', '<p>testo <b>grassetto lungo</b> dopo</p>', (d) => { getSelection().collapse(d.querySelector('b').firstChild, 5); }],
  ['tutto con titolo', '<h1>titolo</h1><p>testo uno</p><ul><li>voce</li></ul>', null],
  ['fine titolo', '<h2>titolo</h2><p>sotto</p>', (d) => { const t = document.createTreeWalker(d.querySelector('h2'), NodeFilter.SHOW_TEXT).nextNode(); getSelection().collapse(t, t.length); }],
  ['link', '<p>vedi <a href="https://example.com">il sito lungo</a> dopo</p>', (d) => { getSelection().collapse(d.querySelector('a').firstChild, 3); }],
];

for (const [nome, html, sel] of casi) {
  test(`confronto ${nome}`, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await page.waitForSelector('#doc');
    for (const n of [10, 60]) {
      await page.click('#doc');
      await page.evaluate((h) => { const d = document.getElementById('doc'); d.innerHTML = h; d.dispatchEvent(new Event('input', { bubbles: true })); }, html);
      if (sel) await page.evaluate(`(${sel})(document.getElementById('doc'))`);
      else await page.keyboard.press(`${ctrl}+a`);
      await page.evaluate((t) => {
        const dt = new DataTransfer(); dt.setData('text/plain', t);
        document.getElementById('doc').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, righe(n));
      await page.waitForTimeout(200);
      const h = await page.evaluate(() => document.getElementById('doc').innerHTML.replace(/<button.*?<\/button>/g, '[btn]').replace(/\n/g, '\\n'));
      console.log(`${nome} ${n}: ${h.slice(0, 220)} ... ${h.slice(-160)}`);
    }
  });
}
