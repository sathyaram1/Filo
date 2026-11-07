// esplorazione #1697.2 giro 2: stile della prima riga in titolo e citazione, righe vuote in un paragrafo vuoto.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(240_000);
const righe = (n, coda = '') => Array.from({ length: n }, (_, i) => `riga numero ${i} del testo incollato`).join('\n') + coda;
async function incolla(page, testo) {
  return page.evaluate((t) => {
    const dt = new DataTransfer(); dt.setData('text/plain', t);
    document.getElementById('doc').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, testo);
}
async function apri(page, html) {
  await page.waitForSelector('#doc');
  await page.click('#doc');
  await page.evaluate((h) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = h;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);
}
const html = (page) => page.evaluate(() => document.getElementById('doc').innerHTML.replace(/<button.*?<\/button>/g, '[btn]'));

test('righe vuote: incolla corto contro lungo in un paragrafo vuoto', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  for (const [n, coda] of [[10, ''], [10, '\n'], [100, ''], [100, '\n']]) {
    await apri(page, '<p>sopra</p><p><br></p><p>sotto</p>');
    await page.evaluate(() => { const p = document.querySelectorAll('#doc p')[1]; getSelection().collapse(p, 0); });
    await incolla(page, righe(n, coda));
    const h = await html(page);
    console.log(n, JSON.stringify(coda), 'TESTA', h.slice(0, 80), 'CODA', h.slice(-120), 'paragrafi', (h.match(/<p>/g) || []).length);
  }
  for (const [n, coda] of [[10, ''], [100, '']]) {
    await apri(page, '<p>sopra</p><p><br></p>');
    await page.evaluate(() => { const p = document.querySelectorAll('#doc p')[1]; getSelection().collapse(p, 0); });
    await incolla(page, righe(n, coda));
    const h = await html(page);
    console.log('in fondo', n, 'CODA', h.slice(-120), 'paragrafi', (h.match(/<p>/g) || []).length);
  }
});

for (const tema of ['light', 'dark']) {
  test(`prima riga incollata in titolo e citazione, tema ${tema}`, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await page.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
    for (const [nome, h, sel] of [
      ['titolo corto', '<h2>Un titolo</h2><p>sotto</p>', 'h2'],
      ['citazione corto', '<blockquote>Una citazione</blockquote><p>sotto</p>', 'blockquote'],
    ]) {
      for (const n of [10, 60]) {
        await apri(page, h);
        await page.evaluate((s) => { const b = document.querySelector('#doc ' + s); const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT); const t = w.nextNode(); getSelection().collapse(t, t.length); }, sel);
        await incolla(page, righe(n));
        const info = await page.evaluate((s) => {
          const b = document.querySelector('#doc ' + s);
          const sp = b.querySelector('span');
          const cs = (el) => { const c = getComputedStyle(el); return `${c.fontSize} ${c.color}`; };
          return { blocco: cs(b), span: sp ? cs(sp) + ' style=' + sp.getAttribute('style') : null, html: b.outerHTML.replace(/<button.*?<\/button>/g, '[btn]').slice(0, 200) };
        }, sel);
        console.log(tema, nome, n, JSON.stringify(info));
        if (n === 60) await page.screenshot({ path: `tests/.shots/1697-2-giro2-${tema}-${sel}.png`, clip: { x: 0, y: 0, width: 900, height: 260 } });
      }
    }
  });
}
