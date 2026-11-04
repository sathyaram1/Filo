// Verifica #810.18, giro 2, rilievo 2: su una pagina grande con migliaia di campi, un riquadro che gli script della
// pagina non possono aprire, o un componente chiuso con un campo qualunque, non fanno aspettare la foto né fermano Filo.

import { test, expect } from '../../fixtures/electron.mjs';

const CASELLE = `<table>${'<tr><td><input type="checkbox"></td><td>ordine</td></tr>'.repeat(3000)}</table>`;
const CASI = [
  ['un riquadro senza script con un campo per l’email', `<iframe sandbox srcdoc="<form>Iscriviti <input name='email'></form>" width="300" height="60"></iframe>`],
  ['un componente chiuso col solo campo di ricerca', `<cerca-c></cerca-c><script>customElements.define('cerca-c', class extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'closed' }).innerHTML = '<input type="search" value="scarpe">'; } });</script>`],
];

for (const [nome, extra] of CASI) {
  test(`r2 tremila caselle da spuntare e ${nome}: la foto per l’assistente non aspetta e Filo non si ferma`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120_000);
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Ordini</title></head><body>${extra}${CASELLE}
      <script>document.write('<div><p>testo <b>uno</b> <i>due</i></p><ul><li>a</li><li>b</li></ul></div>'.repeat(9000));</script></body></html>`);
    await new Promise((r) => setTimeout(r, 1000));
    const esito = await app.evaluate(async ({ webContents }, percorso) => {
      const rq = process.mainModule.require;
      const M = rq(rq('node:path').join(process.cwd(), 'src/main/services/campiNeiRiquadri.js'));
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(percorso));
      const durate = [];
      let fermo = 0, prec = Date.now();
      const iv = setInterval(() => { const n = Date.now(); fermo = Math.max(fermo, n - prec); prec = n; }, 10);
      for (let i = 0; i < 3; i++) {
        const t = Date.now();
        await M.campiSegretiFuoriPagina(wc);
        durate.push(Date.now() - t);
      }
      clearInterval(iv);
      return { durate, fermo };
    }, new URL(page.url()).pathname);
    console.log(nome, JSON.stringify(esito));
    expect(Math.max(...esito.durate), 'ogni foto dell’assistente aspetta la ricerca dei campi').toBeLessThan(1000);
    expect(esito.fermo, 'Filo resta fermo mentre cerca i campi').toBeLessThan(300);
  });
}
