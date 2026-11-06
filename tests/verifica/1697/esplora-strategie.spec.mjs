// Esplorazione (si cancella): blocchi interi con un paragrafo d'ancora, e righe di citazione.
import { test } from '../../fixtures/electron.mjs';

test.setTimeout(600_000);

const N = 1500;
const setups = {
  tuttoTitoloElenco: { html: '<h1>Titolo</h1><p>testo di prima</p><ul><li>voce a</li><li>voce b</li></ul>', strat: 'blocchi', da: 0, a: 2 },
  soloElencoInMezzo: { html: '<p>prima</p><ul><li>voce a</li><li>voce b</li></ul><p>dopo</p>', strat: 'blocchi', da: 1, a: 1 },
  tuttoConImmagine: { html: '<p>prima</p><p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></p>', strat: 'blocchi', da: 0, a: 1 },
  citazioneRighe: { html: '<blockquote>citato</blockquote><p>dopo</p>', strat: 'citazione' },
  citazioneVuota: { html: '<p>sopra</p><blockquote><br></blockquote>', strat: 'citazioneVuota' },
};

for (const [nome, s] of Object.entries(setups)) {
  test(nome, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await page.waitForSelector('#doc');
    const out = await page.evaluate(({ s, N }) => {
      const doc = document.getElementById('doc');
      doc.focus();
      doc.innerHTML = s.html;
      const prima = doc.innerHTML;
      const sel = window.getSelection();
      const r = document.createRange();
      const righe = Array.from({ length: N }, (_, i) => `riga ${i}`);
      let htmlIns;
      if (s.strat === 'blocchi') {
        const fine = doc.children[s.a];
        const anc = document.createElement('p');
        anc.textContent = '​';
        fine.after(anc);
        r.setStart(doc, s.da);
        r.setEnd(doc, [...doc.childNodes].indexOf(anc));
        htmlIns = righe.map((x) => `<p>${x}</p>`).join('');
      } else if (s.strat === 'citazione') {
        const t = doc.querySelector('blockquote').firstChild;
        r.setStart(t, t.length); r.collapse(true);
        htmlIns = righe.map((x) => `<blockquote>${x}</blockquote>`).join('');
      } else {
        const bq = doc.querySelector('blockquote');
        bq.insertBefore(document.createTextNode('​'), bq.firstChild);
        r.setStart(bq.firstChild, 0); r.collapse(true);
        htmlIns = righe.map((x) => `<blockquote>${x}</blockquote>`).join('');
      }
      sel.removeAllRanges(); sel.addRange(r);
      const t0 = performance.now();
      document.execCommand('insertHTML', false, htmlIns);
      const ms = Math.round(performance.now() - t0);
      const pulisci = (h) => h.replace(/<button.*?<\/button>/g, '').replace(/​/g, '[Z]');
      const tags = [...doc.children].map((c) => c.tagName);
      const riassunto = [];
      for (const t of tags) { if (riassunto.length && riassunto[riassunto.length - 1][0] === t) riassunto[riassunto.length - 1][1]++; else riassunto.push([t, 1]); }
      const pezzi = [...doc.children].slice(0, 3).map((c) => pulisci(c.outerHTML).slice(0, 90));
      const coda = [...doc.children].slice(-2).map((c) => pulisci(c.outerHTML).slice(0, 90));
      document.execCommand('undo');
      return { ms, struttura: riassunto.slice(0, 8).map(([t, n]) => `${t}x${n}`).join(' '), pezzi, coda, annullato: pulisci(doc.innerHTML), prima: pulisci(prima) };
    }, { s, N });
    console.log('RIS', nome, JSON.stringify(out));
  });
}
