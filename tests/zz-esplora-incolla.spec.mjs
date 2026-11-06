// Esplorazione temporanea (#1697): quale forma di insertHTML resta veloce. Si cancella prima della consegna.
import { test } from './fixtures/electron.mjs';

const N = 600;
const html = (n, testa = '') => `<p>${testa}A0</p>` + Array.from({ length: n - 1 }, (_, i) => `<p>Riga ${i + 1} di prova</p>`).join('');

async function prova(page, nome, prepara, fai) {
  const ms = await page.evaluate(({ prepara, fai, h, hl }) => {
    const d = document.getElementById('doc');
    d.focus();
    new Function('d', prepara)(d);
    const t0 = performance.now();
    new Function('d', 'h', 'hl', fai)(d, h, hl);
    const ms = performance.now() - t0;
    return { ms: Math.round(ms), n: d.querySelectorAll('p,li').length, inizio: d.innerHTML.slice(0, 120) };
  }, { prepara, fai, h: html(N), hl: '<ul>' + Array.from({ length: N }, (_, i) => `<li>Riga ${i}</li>`).join('') + '</ul>' });
  console.log(nome, JSON.stringify(ms));
}

const cursore = (sel) => `const n = ${sel}; const r = document.createRange(); r.setStart(n.node, n.off); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r);`;

test('esplora', async ({ openTab }) => {
  test.setTimeout(300_000);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  const casi = [
    ['vuoto collassato', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, h)`],
    ['vuoto br selezionato', `d.innerHTML='<p><br></p>'; const r=document.createRange(); r.selectNodeContents(d.firstChild); getSelection().removeAllRanges(); getSelection().addRange(r);`, `document.execCommand('insertHTML', false, h)`],
    ['vuoto p selezionato', `d.innerHTML='<p><br></p>'; const r=document.createRange(); r.selectNode(d.firstChild); getSelection().removeAllRanges(); getSelection().addRange(r);`, `document.execCommand('insertHTML', false, h)`],
    ['fine pieno collassato', `d.innerHTML='<p>abc</p>'; ${cursore("({node: d.firstChild.firstChild, off: 3})")}`, `document.execCommand('insertHTML', false, h)`],
    ['fine pieno ultimo car', `d.innerHTML='<p>abc</p>'; const r=document.createRange(); r.setStart(d.firstChild.firstChild,2); r.setEnd(d.firstChild.firstChild,3); getSelection().removeAllRanges(); getSelection().addRange(r);`, `document.execCommand('insertHTML', false, h.replace('<p>', '<p>c'))`],
    ['inizio pieno primo car', `d.innerHTML='<p>uno</p><p>due</p>'; const r=document.createRange(); r.setStart(d.lastChild.firstChild,0); r.setEnd(d.lastChild.firstChild,1); getSelection().removeAllRanges(); getSelection().addRange(r);`, `document.execCommand('insertHTML', false, h + '')`],
    ['li collassato p', `d.innerHTML='<ul><li>abc</li></ul>'; ${cursore("({node: d.querySelector('li').firstChild, off: 3})")}`, `document.execCommand('insertHTML', false, h)`],
    ['li ultimo car ul', `d.innerHTML='<ul><li>abc</li></ul>'; const t=d.querySelector('li').firstChild; const r=document.createRange(); r.setStart(t,2); r.setEnd(t,3); getSelection().removeAllRanges(); getSelection().addRange(r);`, `document.execCommand('insertHTML', false, hl.replace('<li>', '<li>c'))`],
    ['li collassato ul', `d.innerHTML='<ul><li>abc</li></ul>'; ${cursore("({node: d.querySelector('li').firstChild, off: 3})")}`, `document.execCommand('insertHTML', false, hl)`],
    ['li vuota ul', `d.innerHTML='<ul><li><br></li></ul>'; ${cursore("({node: d.querySelector('li'), off: 0})")}`, `document.execCommand('insertHTML', false, hl)`],
  ];
  for (const [nome, prepara, fai] of casi) await prova(page, nome, prepara, fai);
});
