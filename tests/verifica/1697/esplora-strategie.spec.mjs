// Esplorazione (si cancella): blocchi interi sostituiti da un'ancora davanti.
import { test } from '../../fixtures/electron.mjs';

test.setTimeout(600_000);

const N = 1500;
const setups = {
  tuttoTitoloElenco: { html: '<h1>Titolo</h1><p>testo di prima</p><ul><li>voce a</li><li>voce b</li></ul>', da: 0, a: 2 },
  soloElencoInMezzo: { html: '<p>prima</p><ul><li>voce a</li><li>voce b</li></ul><p>dopo</p>', da: 1, a: 1 },
  tuttoConImmagine: { html: '<p>prima</p><p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></p>', da: 0, a: 1 },
  dopoElenco: { html: '<ul><li>uno</li><li>due</li></ul><p><br></p><p>sotto</p>', da: 1, a: 1 },
  citazioneVuota: { html: '<p>sopra</p><blockquote><br></blockquote>', da: 1, a: 1 },
  tuttoParagrafi: { html: '<p>uno</p><p>due</p><p>tre</p>', da: 0, a: 2 },
};

for (const [nome, s] of Object.entries(setups)) {
  test(nome, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await page.waitForSelector('#doc');
    const out = await page.evaluate(({ s, N }) => {
      const doc = document.getElementById('doc');
      doc.focus();
      doc.innerHTML = s.html;
      const pulisci = (h) => h.replace(/<button.*?<\/button>/g, '').replace(/​/g, '[Z]');
      const prima = pulisci(doc.innerHTML);
      const sel = window.getSelection();
      const r = document.createRange();
      const righe = Array.from({ length: N }, (_, i) => `riga ${i}`);
      const A = doc.children[s.da];
      const B = doc.children[s.a];
      const tag = /^(P|H[1-6]|BLOCKQUOTE)$/.test(A.tagName) ? A.tagName.toLowerCase() : 'p';
      const anc = document.createElement(tag);
      const z = document.createTextNode('​');
      anc.appendChild(z);
      A.before(anc);
      r.setStart(z, 1);
      r.setEnd(doc, [...doc.childNodes].indexOf(B) + 1);
      const htmlIns = righe.map((x, i) => { const t = i === 0 || tag === 'blockquote' ? tag : 'p'; return `<${t}>${x}</${t}>`; }).join('');
      sel.removeAllRanges(); sel.addRange(r);
      const t0 = performance.now();
      document.execCommand('insertHTML', false, htmlIns);
      const ms = Math.round(performance.now() - t0);
      const tags = [...doc.children].map((c) => c.tagName);
      const riassunto = [];
      for (const t of tags) { if (riassunto.length && riassunto[riassunto.length - 1][0] === t) riassunto[riassunto.length - 1][1]++; else riassunto.push([t, 1]); }
      const pezzi = [...doc.children].slice(0, 3).map((c) => pulisci(c.outerHTML).slice(0, 90));
      const coda = [...doc.children].slice(-2).map((c) => pulisci(c.outerHTML).slice(0, 90));
      document.execCommand('undo');
      const annullato = pulisci(doc.innerHTML);
      document.execCommand('redo');
      const rifatto = [...doc.children].length;
      return { ms, struttura: riassunto.slice(0, 8).map(([t, n]) => `${t}x${n}`).join(' '), pezzi, coda, annullato, prima, rifatto };
    }, { s, N });
    console.log('RIS', nome, JSON.stringify(out));
  });
}
