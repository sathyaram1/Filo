// #1697.2 giro 3, rilievo 1: un incolla lungo (50 righe o più) dentro un blocco di codice spezza il blocco e
// porta le righe incollate, e il resto del codice, fuori dal codice; con 10 righe restano dentro.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(120_000);
const righe = (n) => Array.from({ length: n }, (_, i) => `linea_${i}();`).join('\n');

for (const [nome, dove] of [['a metà', 4], ['in fondo', 'fine']]) {
  test(`r1 ${nome} di un blocco di codice, 60 righe incollate restano tutte nel codice, come 10`, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await page.waitForSelector('#doc');
    await page.click('#doc');
    await page.evaluate((dove) => {
      const d = document.getElementById('doc');
      d.innerHTML = '<pre>codice uno\ncodice due</pre><p>sotto</p>';
      d.dispatchEvent(new Event('input', { bubbles: true }));
      const t = d.querySelector('pre').firstChild;
      getSelection().collapse(t, dove === 'fine' ? t.length : dove);
    }, dove);
    await page.evaluate((t) => {
      const dt = new DataTransfer(); dt.setData('text/plain', t);
      document.getElementById('doc').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, righe(60));
    const esito = await page.evaluate(() => {
      const d = document.getElementById('doc');
      const pre = [...d.querySelectorAll('pre')];
      const inCodice = pre.map((p) => p.innerText).join('\n');
      return { blocchi: pre.length, righe: (inCodice.match(/linea_\d+\(\);/g) || []).length, coda: /codice due/.test(inCodice), sotto: d.lastElementChild.textContent };
    });
    expect(esito.blocchi, 'un solo blocco di codice').toBe(1);
    expect(esito.righe, 'tutte le righe incollate stanno nel codice').toBe(60);
    expect(esito.coda, 'il resto del codice resta codice').toBe(true);
    expect(esito.sotto).toBe('sotto');
  });
}
