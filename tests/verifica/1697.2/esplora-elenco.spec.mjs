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
    const voci = (n, primo, ultimo) => Array.from({ length: n }, (_, i) => `<li>${i === 0 ? primo : ''}riga ${i}${i === n - 1 ? ultimo : ''}</li>`).join('');
    const prova = (nome, html, sel, frammento, n) => {
      box.innerHTML = html;
      box.focus();
      const r = sel(box);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      const t0 = performance.now();
      document.execCommand('insertHTML', false, frammento(n));
      const ls = [...box.querySelectorAll('li')].map((l) => l.innerHTML);
      ris.push(`${nome} n=${n}: ${Math.round(performance.now() - t0)} ms, liste=${box.querySelectorAll('ul,ol').length} ${box.innerHTML.slice(0, 18)} | ${JSON.stringify(ls.slice(0, 2))} … ${JSON.stringify(ls.slice(-3))} | dopo: ${box.lastElementChild.outerHTML.slice(0, 40)}`);
    };
    const tutta = (b) => { const r = document.createRange(); const l = b.querySelector('li'); r.setStart(l, 0); r.setEnd(l, l.childNodes.length); return r; };
    for (const [lista, base] of [['ul', '<ul><li>voce uno</li><li>voce due</li></ul><p>dopo</p>'], ['ol', '<ol><li>voce uno</li><li>voce due</li></ol><p>dopo</p>'], ['annidata', '<ul><li>voce uno<ul><li>sotto</li></ul></li><li>voce due</li></ul>']]) {
      for (const n of [1000, 4000]) {
        prova(`${lista} voce intera, ul`, base, tutta, (n) => `<ul>${voci(n, 'voce ', ' uno')}</ul>`, n);
        prova(`${lista} voce intera, solo li`, base, tutta, (n) => voci(n, 'voce ', ' uno'), n);
      }
    }
    box.remove();
    return ris;
  });
  console.log(out.join('\n'));
});
