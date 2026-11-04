// Verifica #810.18, giro 1, rilievo 2: su una pagina grande un componente chiuso con il solo campo di ricerca (niente
// di segreto) fa leggere a ogni foto l'intera struttura della pagina: secondi di attesa e Filo fermo. C'era già su main.

import { test, expect } from '../../fixtures/electron.mjs';

test('r2 pagina grande con un componente chiuso che ha solo un campo di ricerca: la foto non aspetta e Filo non si ferma', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Lunga</title></head><body>
    <cerca-chiuso></cerca-chiuso><script>customElements.define('cerca-chiuso', class extends HTMLElement {
      constructor() { super(); this.attachShadow({ mode: 'closed' }).innerHTML = '<input type="search" placeholder="Cerca">'; } });</script>
    <script>document.write('<div><p>testo <b>uno</b> <i>due</i></p><ul><li>a</li><li>b</li></ul></div>'.repeat(9000));</script></body></html>`);
  const esito = await app.evaluate(async ({ webContents }, percorso) => {
    const rq = process.mainModule.require;
    const M = rq(rq('node:path').join(process.cwd(), 'src/main/services/campiNeiRiquadri.js'));
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(percorso));
    const durate = [];
    let fermo = 0, prec = Date.now();
    const iv = setInterval(() => { const n = Date.now(); fermo = Math.max(fermo, n - prec); prec = n; }, 10);
    for (let i = 0; i < 3; i++) {
      const t = Date.now();
      const r = await M.campiSegretiNeiComponentiChiusi(wc);
      durate.push({ ms: Date.now() - t, campi: r.campi.length });
    }
    clearInterval(iv);
    return { durate, fermo };
  }, new URL(page.url()).pathname);
  console.log(JSON.stringify(esito));
  expect(esito.durate.every((d) => d.campi === 0)).toBe(true);
  expect(Math.max(...esito.durate.map((d) => d.ms)), 'attesa di ogni foto per la ricerca dei campi').toBeLessThan(1000);
  expect(esito.fermo, 'Filo fermo durante la ricerca').toBeLessThan(300);
});
