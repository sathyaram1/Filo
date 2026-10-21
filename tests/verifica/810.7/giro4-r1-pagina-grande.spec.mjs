// Verifica #810.7, giro 4, rilievo 1: su una pagina grande, senza nessun campo segreto, la ricerca dei campi da coprire
// rallenta ogni foto dell'assistente di secondi e blocca Filo intero a tratti.

import { test, expect } from '../../fixtures/electron.mjs';

test('r1 pagina grande senza campi segreti: la foto per l’assistente non aspetta secondi e Filo non si blocca', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const riquadri = Array.from({ length: 20 }, (_, i) => testServer.html(`<!doctype html><html><body>
    ${'<div><span>x</span><a href="#">y</a></div>'.repeat(2000)}<p>r${i}</p></body></html>`, { pubblico: true }));
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Lunga</title></head><body>
    <script>document.write('<div><p>testo <b>uno</b> <i>due</i></p><ul><li>a</li><li>b</li></ul></div>'.repeat(13000));</script>
    ${riquadri.map((u) => `<iframe src="${u}" width="200" height="100"></iframe>`).join('')}</body></html>`);
  await expect.poll(() => page.frames().length, { timeout: 30_000 }).toBeGreaterThan(15);
  const percorso = new URL(page.url()).pathname;

  const esito = await app.evaluate(async ({ webContents }, percorso) => {
    const rq = process.mainModule.require;
    const M = rq(rq('node:path').join(process.cwd(), 'src/main/services/campiNeiRiquadri.js'));
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(percorso));
    const durate = [];
    let fermo = 0, prec = Date.now();
    const iv = setInterval(() => { const n = Date.now(); fermo = Math.max(fermo, n - prec); prec = n; }, 10);
    for (let i = 0; i < 3; i++) {
      const t = Date.now();
      const r = await M.campiSegretiFuoriPagina(wc);
      durate.push({ ms: Date.now() - t, campi: r.campi.length });
    }
    clearInterval(iv);
    return { durate, fermo };
  }, percorso);

  expect(esito.durate.every((d) => d.campi === 0)).toBe(true);
  expect(Math.max(...esito.durate.map((d) => d.ms)), 'ogni foto dell’assistente aspetta la ricerca dei campi').toBeLessThan(1000);
  expect(esito.fermo, 'Filo resta bloccato mentre cerca i campi').toBeLessThan(300);
});
