// Esplorazione (si cancella): l'ancora tolta subito dopo l'incolla rompe annulla e ripeti?
import { test } from '../../fixtures/electron.mjs';

test.setTimeout(600_000);

const casi = {
  tuttoParagrafi: { html: '<p>uno <b>due</b></p><p>tre</p>', sel: 'tutto' },
  dopoElenco: { html: '<ul><li>uno</li><li>due</li></ul><p><br></p><p>sotto</p>', sel: 'vuoto' },
  titoloElenco: { html: '<h1>Titolo</h1><p>testo</p><ul><li>a</li><li>b</li></ul>', sel: 'tutto' },
};

for (const [nome, s] of Object.entries(casi)) {
  for (const togli of ['subito', 'mai', 'dopoUndo']) {
    test(`${nome} ${togli}`, async ({ openTab }) => {
      const page = await openTab('filo://editor/editor.html');
      await page.waitForSelector('#doc');
      const out = await page.evaluate(({ s, togli }) => {
        const doc = document.getElementById('doc');
        doc.focus();
        doc.innerHTML = s.html;
        const pulisci = (h) => h.replace(/<button.*?<\/button>/g, '').replace(/​/g, '[Z]');
        const prima = pulisci(doc.innerHTML);
        const r = document.createRange();
        if (s.sel === 'tutto') {
          const w = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
          let t = w.nextNode(); while (t && t.parentNode.closest('[contenteditable="false"]')) t = w.nextNode();
          let u = t; for (let x = w.nextNode(); x; x = w.nextNode()) u = x;
          r.setStart(t, 0); r.setEnd(u, u.length);
        } else { const p = doc.querySelectorAll('p')[0]; r.setStart(p, 0); r.collapse(true); }
        const z = document.createTextNode('​');
        const d = r.cloneRange(); d.collapse(true); d.insertNode(z);
        r.setStart(z, 1);
        getSelection().removeAllRanges(); getSelection().addRange(r);
        const righe = Array.from({ length: 1500 }, (_, i) => `<p>riga ${i}</p>`).join('');
        const t0 = performance.now();
        document.execCommand('insertHTML', false, righe);
        const ms = Math.round(performance.now() - t0);
        if (togli === 'subito' && z.isConnected) z.remove();
        const dopo = pulisci(doc.innerHTML).slice(0, 120);
        document.execCommand('undo');
        if (togli === 'dopoUndo' && z.isConnected && z.data === '​') z.remove();
        const annullato = pulisci(doc.innerHTML);
        document.execCommand('redo');
        const rifatto = pulisci(doc.innerHTML).slice(0, 120) + ' … n=' + doc.children.length;
        document.execCommand('undo');
        const riannullato = pulisci(doc.innerHTML);
        return { ms, zDopo: z.isConnected, dopo, annullatoUguale: annullato === prima, annullato, rifatto, riannullatoUguale: riannullato === prima, riannullato };
      }, { s, togli });
      console.log('RIS', nome, togli, JSON.stringify(out));
    });
  }
}
