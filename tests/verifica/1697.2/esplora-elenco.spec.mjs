// esplorazione: dove si paga l'incolla lungo in un elenco.
import { test } from '../../fixtures/electron.mjs';

test.setTimeout(240_000);

test('misure', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  const out = await page.evaluate(() => {
    const ris = [];
    const box = document.createElement('div');
    box.contentEditable = 'true';
    document.body.appendChild(box);
    const li = (n, pre = '') => Array.from({ length: n }, (_, i) => `<li>${pre}riga ${i}</li>`).join('');
    const prova = (nome, html, prepara, n) => {
      box.innerHTML = html;
      box.focus();
      const r = prepara(box);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      const t0 = performance.now();
      document.execCommand('insertHTML', false, prepara.frammento(n));
      ris.push(`${nome} n=${n}: ${Math.round(performance.now() - t0)} ms, li=${box.querySelectorAll('li').length}, ul=${box.querySelectorAll('ul,ol').length}`);
    };
    const base = '<ul><li>voce uno</li><li>voce due</li></ul><p>dopo</p>';
    const tutta = (b) => { const r = document.createRange(); const l = b.querySelector('li'); r.setStart(l, 0); r.setEnd(l, l.childNodes.length); return r; };
    tutta.frammento = (n) => `<ul>${li(n)}</ul>`;
    const fondo = (b) => { const r = document.createRange(); const t = b.querySelector('li').firstChild; r.setStart(t, t.length); return r; };
    fondo.frammento = (n) => `<ul>${li(n)}</ul>`;
    const fondoSoloLi = (b) => fondo(b);
    fondoSoloLi.frammento = (n) => li(n);
    const fondoP = (b) => fondo(b);
    fondoP.frammento = (n) => Array.from({ length: n }, (_, i) => `<p>riga ${i}</p>`).join('');
    const dopoLista = (b) => { const r = document.createRange(); const t = b.querySelector('p').firstChild; r.setStart(t, 0); return r; };
    dopoLista.frammento = (n) => `<ul>${li(n)}</ul>`;
    const ultimaVoce = (b) => { const r = document.createRange(); const l = b.querySelectorAll('li')[1]; r.setStart(l.firstChild, l.firstChild.length); return r; };
    ultimaVoce.frammento = (n) => `<ul>${li(n)}</ul>`;
    for (const n of [1000, 2000, 4000]) {
      prova('voce intera selezionata', base, tutta, n);
      prova('fondo prima voce, ul', base, fondo, n);
      prova('fondo prima voce, solo li', base, fondoSoloLi, n);
      prova('fondo ultima voce, ul', base, ultimaVoce, n);
      prova('inizio del paragrafo dopo, ul', base, dopoLista, n);
      prova('fondo prima voce, p', base, fondoP, n);
    }
    box.remove();
    return ris;
  });
  console.log(out.join('\n'));
});
