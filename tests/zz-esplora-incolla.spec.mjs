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
  await page.evaluate(() => { const x = document.createElement('div'); x.id = 'pulito'; x.contentEditable = 'true'; document.body.appendChild(x); });
  const casi = [
    ['T1 interchange inizio', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, '<br class="Apple-interchange-newline">' + h)`],
    ['T2 interchange fine', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, h + '<br class="Apple-interchange-newline">')`],
    ['T3 p vuoto in testa', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, '<p><br></p>' + h)`],
    ['T4 vuoto: ul', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, hl)`],
    ['T5 vuoto: due sole p', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, '<p>a</p><p>b</p>')`],
    ['T6 vuoto 300', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, h.slice(0, h.length/2))`],
    ['S span vuoto unico', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, '<span>' + h + '</span>')`],
    ['S span vuoto 1500', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, '<span>' + h + h + h.slice(0, h.length/2) + '</span>')`],
    ['S span fine pieno', `d.innerHTML='<p>abc</p><p>def</p>'; ${cursore("({node: d.firstChild.firstChild, off: 3})")}`, `document.execCommand('insertHTML', false, '<span>' + h + '</span>')`],
    ['S span inizio secondo', `d.innerHTML='<p>abc</p><p>def</p>'; ${cursore("({node: d.lastChild.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, '<span>' + h + '</span>')`],
    ['S span vuoto in mezzo', `d.innerHTML='<p>abc</p><p><br></p><p>def</p>'; ${cursore("({node: d.children[1], off: 0})")}`, `document.execCommand('insertHTML', false, '<span>' + h + '</span>')`],
    ['J inizio pieno collassato', `d.innerHTML='<p>uno</p><p>due</p>'; ${cursore("({node: d.lastChild.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, h)`],
    ['K fine pieno seguito', `d.innerHTML='<p>uno</p><p>due</p>'; ${cursore("({node: d.firstChild.firstChild, off: 3})")}`, `document.execCommand('insertHTML', false, h)`],
    ['L vuoto fra pieni, sel da fine prec', `d.innerHTML='<p>uno</p><p><br></p>'; const r=document.createRange(); r.setStart(d.firstChild.firstChild,2); r.setEnd(d.lastChild,0); getSelection().removeAllRanges(); getSelection().addRange(r);`, `document.execCommand('insertHTML', false, '<p>o</p>' + h)`],
    ['M vuoto unico, sel br, frammento con p vuoto finale', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, h + '<p><br></p>')`],
    ['N vuoto: div senza p', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, '<div>' + h.replace(/<p>/g,'').replace(/<\\/p>/g,'<br>') + '</div>')`],
    ['G pulito p vuoto', `d = document.getElementById('pulito'); d.focus(); d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, h)`],
    ['H pulito pieno', `d = document.getElementById('pulito'); d.focus(); d.innerHTML='<p>abc</p>'; ${cursore("({node: d.firstChild.firstChild, off: 3})")}`, `document.execCommand('insertHTML', false, h)`],
    ['I br nel p', `d.innerHTML='<p>abc<br><br></p>'; ${cursore("({node: d.firstChild, off: 2})")}`, `document.execCommand('insertHTML', false, h)`],
    ['D radice prima del p vuoto', `d.innerHTML='<p><br></p>'; ${cursore("({node: d, off: 0})")}`, `document.execCommand('insertHTML', false, h)`],
    ['E radice prima del p vuoto in mezzo', `d.innerHTML='<p>uno</p><p><br></p><p>tre</p>'; ${cursore("({node: d, off: 1})")}`, `document.execCommand('insertHTML', false, h)`],
    ['A div', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, '<div>' + h + '</div>')`],
    ['B div per riga', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, h.replace(/<(\\/?)p>/g, '<$1div>'))`],
    ['F p vuoto con span', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, '<span></span>' + h)`],
    ['vuoto testa nuda', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, h.replace('<p>A0</p>', 'A0'))`],
    ['doc senza figli', `d.innerHTML=''; ${cursore("({node: d, off: 0})")}`, `document.execCommand('insertHTML', false, h)`],
    ['vuoto testa nuda 1500', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, h.replace('<p>A0</p>', 'A0') + h + h.slice(0, h.length/2))`],
    ['vuoto collassato 1500', `d.innerHTML='<p><br></p>'; ${cursore("({node: d.firstChild, off: 0})")}`, `document.execCommand('insertHTML', false, h + h + h.slice(0, h.length/2))`],
    ['vuoto br sostituito da testo', `d.innerHTML='<p><br></p>'; const r=document.createRange(); r.selectNode(d.firstChild.firstChild); getSelection().removeAllRanges(); getSelection().addRange(r);`, `document.execCommand('insertHTML', false, h.replace('<p>A0</p>', 'A0'))`],
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
