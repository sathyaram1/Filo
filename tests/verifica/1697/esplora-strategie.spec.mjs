// Esplorazione (si cancella): un'ancora invisibile dopo la selezione rende veloce l'inserimento?
import { test } from '../../fixtures/electron.mjs';

test.setTimeout(600_000);

const N = 1500;
const setups = {
  dopoElenco: { html: '<ul><li>uno</li><li>due</li></ul><p><br></p>', primo: 'p', sel: (doc) => { const p = doc.querySelector('p'); return [p, 0, p, 0]; } },
  tuttoTitoloElenco: { html: '<h1>Titolo</h1><p>testo di prima</p><ul><li>voce a</li><li>voce b</li></ul>', primo: 'h1', sel: (doc) => { const h = doc.querySelector('h1').lastChild; const l = doc.querySelectorAll('li')[1].firstChild; return [h, 0, l, l.length]; } },
  tuttoParagrafi: { html: '<p>uno</p><p>due</p><p>tre</p>', primo: 'p', sel: (doc) => { const a = doc.querySelector('p').firstChild; const b = doc.querySelectorAll('p')[2].firstChild; return [a, 0, b, b.length]; } },
  citazioneFine: { html: '<blockquote>citato</blockquote>', primo: 'blockquote', sel: (doc) => { const t = doc.querySelector('blockquote').firstChild; return [t, t.length, t, t.length]; } },
  elencoAParagrafo: { html: '<ul><li>voce a</li><li>voce b</li></ul><p>dopo</p>', primo: 'li', sel: (doc) => { const a = doc.querySelectorAll('li')[1].firstChild; const b = doc.querySelector('p').firstChild; return [a, 2, b, 2]; } },
};

for (const [nome, s] of Object.entries(setups)) {
  for (const strat of ['ancora', 'ancoraTagPrimo', 'tagPrimo']) {
    test(`${nome} ${strat}`, async ({ openTab }) => {
      const page = await openTab('filo://editor/editor.html');
      await page.waitForSelector('#doc');
      const out = await page.evaluate(({ html, selSrc, strat, N, primo }) => {
        const doc = document.getElementById('doc');
        doc.focus();
        doc.innerHTML = html;
        const sel = window.getSelection();
        const r = document.createRange();
        const [a, ao, b, bo] = (new Function('doc', `return (${selSrc})(doc)`))(doc);
        r.setStart(a, ao); r.setEnd(b, bo);
        const righe = Array.from({ length: N }, (_, i) => `riga ${i}`);
        const tag0 = strat === 'ancora' ? 'p' : (primo === 'li' ? '' : primo);
        const htmlIns = righe.map((x, i) => (i === 0 && tag0 === '' ? x : `<${i === 0 ? tag0 : 'p'}>${x}</${i === 0 ? tag0 : 'p'}>`)).join('');
        if (strat !== 'tagPrimo') {
          const fine = r.cloneRange(); fine.collapse(false);
          const anc = document.createTextNode('​');
          fine.insertNode(anc);
          r.setEnd(anc, 0);
        }
        sel.removeAllRanges(); sel.addRange(r);
        const t0 = performance.now();
        document.execCommand('insertHTML', false, htmlIns);
        const ms = Math.round(performance.now() - t0);
        const tags = [...doc.children].map((c) => c.tagName);
        const riassunto = [];
        for (const t of tags) { if (riassunto.length && riassunto[riassunto.length - 1][0] === t) riassunto[riassunto.length - 1][1]++; else riassunto.push([t, 1]); }
        const pezzi = [...doc.children].slice(0, 2).map((c) => c.outerHTML.replace(/<button.*?<\/button>/, '').slice(0, 90));
        const ultimo = doc.lastElementChild ? doc.lastElementChild.outerHTML.slice(-90) : '';
        document.execCommand('undo');
        return { ms, struttura: riassunto.slice(0, 8).map(([t, n]) => `${t}x${n}`).join(' '), pezzi, ultimo, dopoUndo: doc.innerHTML.replace(/<button.*?<\/button>/g, '').replace(/​/g, '[Z]').slice(0, 160) };
      }, { html: s.html, selSrc: s.sel.toString(), strat, N, primo: s.primo });
      console.log('RIS', nome, strat, JSON.stringify(out));
    });
  }
}
