// Verifica #810.18, giro 1, rilievo 1: su una pagina grande con migliaia di campi qualunque (nessun componente
// chiuso) la ricerca dei campi segreti per la foto dell'assistente costa quasi un secondo e ferma Filo; su main
// la stessa pagina costava pochi millisecondi.

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
      durate.push({ ms: Date.now() - t, campi: r.campi.length });
    }
    clearInterval(iv);
    return { durate, fermo };
  }, [percorso, volte]);
}

test('r1 pagina grande con una tabella di tremila caselle da spuntare: la foto per l’assistente non aspetta e Filo non si ferma', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Ordini</title></head><body>
    <table>${'<tr><td><input type="checkbox"></td><td>ordine</td></tr>'.repeat(3000)}</table>
    <script>document.write('<div><p>testo <b>uno</b> <i>due</i></p><ul><li>a</li><li>b</li></ul></div>'.repeat(9000));</script></body></html>`);
  const esito = await misura(app, new URL(page.url()).pathname);
  console.log(JSON.stringify(esito));
  expect(esito.durate.every((d) => d.campi === 0)).toBe(true);
  expect(Math.max(...esito.durate.map((d) => d.ms)), 'attesa di ogni foto per la ricerca dei campi').toBeLessThan(400);
  expect(esito.fermo, 'Filo fermo durante la ricerca').toBeLessThan(150);
});
