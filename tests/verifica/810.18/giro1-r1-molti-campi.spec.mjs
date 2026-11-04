// Verifica #810.18, giro 1: la ricerca dei campi nei componenti chiusi su pagine grandi con molti campi o molte
// scritte «<input>», e con un componente chiuso che ha solo un campo di ricerca.

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
      const r = await M.campiSegretiNeiComponentiChiusi(wc);
      durate.push({ ms: Date.now() - t, campi: r.campi.length });
    }
    clearInterval(iv);
    return { durate, fermo };
  }, [percorso, volte]);
}

const grande = (extra) => `<!doctype html><html><head><title>Lunga</title></head><body>${extra}
  <script>document.write('<div><p>testo <b>uno</b> <i>due</i></p><ul><li>a</li><li>b</li></ul></div>'.repeat(9000));</script></body></html>`;

const CASI = [
  ['una tabella con tremila caselle da spuntare', `<table>${'<tr><td><input type="checkbox"></td><td>riga</td></tr>'.repeat(3000)}</table>`],
  ['una pagina che spiega l’HTML con tremila esempi «<input>»', '<pre>&lt;input&gt;</pre>'.repeat(3000)],
  ['un componente chiuso con il solo campo di ricerca', `<cerca-chiuso></cerca-chiuso><script>customElements.define('cerca-chiuso', class extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'closed' }).innerHTML = '<input type="search" placeholder="Cerca">'; } });</script>`],
];

for (const [nome, extra] of CASI) {
  test(`pagina grande con ${nome}: la ricerca dei campi segreti non aspetta e Filo non si ferma`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120_000);
    const page = await testServer.openReady(openTab, grande(extra));
    const esito = await misura(app, new URL(page.url()).pathname);
    console.log(nome, JSON.stringify(esito));
    expect(esito.durate.every((d) => d.campi === 0)).toBe(true);
    expect(Math.max(...esito.durate.map((d) => d.ms)), 'attesa di ogni ricerca').toBeLessThan(1000);
    expect(esito.fermo, 'Filo fermo durante la ricerca').toBeLessThan(300);
  });
}
