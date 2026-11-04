// Verifica #810.18, giro 2: esplorazione delle altre porte che fanno guardare i campi uno alla volta.

import { test, expect } from '../../fixtures/electron.mjs';

async function misura(app, percorso, volte = 3) {
  return app.evaluate(async ({ webContents }, [percorso, volte]) => {
    const rq = process.mainModule.require;
    const M = rq(rq('node:path').join(process.cwd(), 'src/main/services/campiNeiRiquadri.js'));
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(percorso));
    const durate = [];
    let fermo = 0, prec = Date.now();
    const iv = setInterval(() => { const n = Date.now(); fermo = Math.max(fermo, n - prec); prec = n; }, 10);
    for (let i = 0; i < volte; i++) {
      const t = Date.now();
      const r = await M.campiSegretiFuoriPagina(wc);
      durate.push({ ms: Date.now() - t, campi: r.campi.length, nonCoperti: r.nonCoperti });
    }
    clearInterval(iv);
    return { durate, fermo };
  }, [percorso, volte]);
}

const CASELLE = `<table>${'<tr><td><input type="checkbox"></td><td>ordine</td></tr>'.repeat(3000)}</table>`;
const CASI = [
  ['riferimento', ''],
  ['chiuso con ricerca', `<cerca-c></cerca-c><script>customElements.define('cerca-c', class extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'closed' }).innerHTML = '<input type="search" value="x">'; } });</script>`],
  ['chiuso con la scritta', `<code-c></code-c><script>customElements.define('code-c', class extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'closed' }).innerHTML = '<pre>&lt;input&gt;</pre>'; } });</script>`],
  ['riquadro senza indirizzo scritto dalla pagina', `<iframe id="w"></iframe><script>w.contentDocument.body.innerHTML = '<form><input name="email"></form>';</script>`],
  ['riquadro senza script', `<iframe sandbox srcdoc="<form><input name='email'></form>"></iframe>`],
];

for (const [nome, extra] of CASI) {
  test(`esplora: tremila caselle, ${nome}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120_000);
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Lunga</title></head><body>${extra}${CASELLE}
      <script>document.write('<div><p>testo <b>uno</b> <i>due</i></p><ul><li>a</li><li>b</li></ul></div>'.repeat(9000));</script></body></html>`);
    await new Promise((r) => setTimeout(r, 1500));
    const esito = await misura(app, new URL(page.url()).pathname);
    const urls = await app.evaluate(({ webContents }, p) => webContents.getAllWebContents().find((w) => w.getURL().includes(p))
      .mainFrame.framesInSubtree.map((f) => f.url), new URL(page.url()).pathname);
    console.log(nome, JSON.stringify({ ...esito, urls }));
    expect(esito.durate.length).toBe(3);
  });
}
