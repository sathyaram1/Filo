// Esplorazione (si cancella): quali inserimenti restano veloci nei casi lenti dell'incolla lungo.
import { test } from '../../fixtures/electron.mjs';

test.setTimeout(600_000);

const N = 1500;
const setups = {
  dopoElenco: { html: '<ul><li>uno</li><li>due</li></ul><p><br></p>', sel: (doc) => { const p = doc.querySelector('p'); return [p, 0, p, 0]; } },
  tuttoTitoloElenco: { html: '<h1>Titolo</h1><p>testo di prima</p><ul><li>voce a</li><li>voce b</li></ul>', sel: (doc) => { const h = doc.querySelector('h1').lastChild; const l = doc.querySelectorAll('li')[1].firstChild; return [h, 0, l, l.length]; } },
  tuttoParagrafi: { html: '<p>uno</p><p>due</p><p>tre</p>', sel: (doc) => { const a = doc.querySelector('p').firstChild; const b = doc.querySelectorAll('p')[2].firstChild; return [a, 0, b, b.length]; } },
  citazioneFine: { html: '<blockquote>citato</blockquote>', sel: (doc) => { const t = doc.querySelector('blockquote').firstChild; return [t, t.length, t, t.length]; } },
};

const strategie = ['ps', 'testaNuda', 'nodoEsterno', 'dopoNodo', 'divUnico'];

for (const [nome, s] of Object.entries(setups)) {
  for (const strat of strategie) {
    test(`${nome} ${strat}`, async ({ openTab }) => {
      const page = await openTab('filo://editor/editor.html');
      await page.waitForSelector('#doc');
      const out = await page.evaluate(({ html, selSrc, strat, N }) => {
        const doc = document.getElementById('doc');
        doc.focus();
        doc.innerHTML = html;
        const sel = window.getSelection();
        const r = document.createRange();
        const [a, ao, b, bo] = (new Function('doc', `return (${selSrc})(doc)`))(doc);
        r.setStart(a, ao); r.setEnd(b, bo);
        const righe = Array.from({ length: N }, (_, i) => `riga ${i}`);
        const ps = righe.map((x) => `<p>${x}</p>`).join('');
        let htmlIns = ps;
        if (strat === 'testaNuda') htmlIns = righe[0] + righe.slice(1).map((x) => `<p>${x}</p>`).join('');
        if (strat === 'nodoEsterno') {
          const bA = (r.startContainer.nodeType === 3 ? r.startContainer.parentNode : r.startContainer);
          let top = bA; while (top.parentNode !== doc) top = top.parentNode;
          let topB = (r.endContainer.nodeType === 3 ? r.endContainer.parentNode : r.endContainer); while (topB.parentNode !== doc) topB = topB.parentNode;
          r.setStartBefore(top); r.setEndAfter(topB);
        }
        if (strat === 'dopoNodo') {
          let top = (r.startContainer.nodeType === 3 ? r.startContainer.parentNode : r.startContainer); while (top.parentNode !== doc) top = top.parentNode;
          r.setStartAfter(top); r.collapse(true);
        }
        if (strat === 'divUnico') htmlIns = `<div>${ps}</div>`;
        sel.removeAllRanges(); sel.addRange(r);
        const t0 = performance.now();
        document.execCommand('insertHTML', false, htmlIns);
        const ms = Math.round(performance.now() - t0);
        const tags = [...doc.children].map((c) => c.tagName);
        const riassunto = [];
        for (const t of tags) { if (riassunto.length && riassunto[riassunto.length - 1][0] === t) riassunto[riassunto.length - 1][1]++; else riassunto.push([t, 1]); }
        const primo = doc.children[0] ? doc.children[0].outerHTML.slice(0, 80) : '';
        document.execCommand('undo');
        return { ms, struttura: riassunto.slice(0, 8).map(([t, n]) => `${t}x${n}`).join(' '), primo, annullato: doc.innerHTML === html, dopoUndo: doc.innerHTML.slice(0, 120) };
      }, { html: s.html, selSrc: s.sel.toString(), strat, N });
      console.log('RIS', nome, strat, JSON.stringify(out));
    });
  }
}
