// #1697.2 giro 2, rilievo 1: un incolla lungo in fondo o a metà di un titolo o di una citazione con testo porta la prima
// riga dentro un pezzo con lo stile fisso del paragrafo (più piccola nel titolo, col colore del testo nella citazione).
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(120_000);
const righe = (n) => Array.from({ length: n }, (_, i) => `riga numero ${i} del testo incollato`).join('\n');

for (const [nome, html, sel, dove] of [
  ['in fondo a un titolo', '<h2>Un titolo</h2><p>sotto</p>', 'h2', 'fine'],
  ['a metà di un titolo', '<h2>Un titolo lungo</h2><p>sotto</p>', 'h2', 3],
  ['in fondo a una citazione', '<blockquote>Una citazione</blockquote><p>sotto</p>', 'blockquote', 'fine'],
  ['a metà di una citazione', '<blockquote>Una citazione lunga</blockquote><p>sotto</p>', 'blockquote', 4],
]) {
  test(`r1 ${nome}: la prima riga di 60 incollate ha lo stile del blocco, come con 10`, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await page.waitForSelector('#doc');
    await page.click('#doc');
    await page.evaluate(({ html, sel, dove }) => {
      const doc = document.getElementById('doc');
      doc.innerHTML = html;
      doc.dispatchEvent(new Event('input', { bubbles: true }));
      const t = document.createTreeWalker(doc.querySelector(sel), NodeFilter.SHOW_TEXT).nextNode();
      getSelection().collapse(t, dove === 'fine' ? t.length : dove);
    }, { html, sel, dove });
    await page.evaluate((t) => {
      const dt = new DataTransfer(); dt.setData('text/plain', t);
      document.getElementById('doc').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, righe(60));
    const esito = await page.evaluate((sel) => {
      const b = document.querySelector('#doc ' + sel);
      const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      let t = w.nextNode();
      while (t && !/riga numero 0 /.test(t.nodeValue)) t = w.nextNode();
      const st = (el) => { const c = getComputedStyle(el); return `${c.fontSize} ${c.color}`; };
      return { blocco: st(b), riga: t ? st(t.parentElement) : null, stili: b.querySelectorAll('[style]').length };
    }, sel);
    expect(esito.riga, 'la prima riga incollata sta nel blocco').not.toBeNull();
    expect(esito.riga).toBe(esito.blocco);
    expect(esito.stili).toBe(0);
  });
}
