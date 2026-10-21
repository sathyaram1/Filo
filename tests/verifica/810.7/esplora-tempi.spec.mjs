// Esplorazione (si cancella): quanto costa la misura dei campi fuori pagina a ogni foto dell'assistente.

import { test, expect } from '../../fixtures/electron.mjs';

async function tempi(app, frammento) {
  return app.evaluate(async ({ webContents }, frammento) => {
    const rq = process.mainModule.require;
    const path = rq('node:path');
    const M = rq(path.join(process.cwd(), 'src/main/services/campiNeiRiquadri.js'));
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(frammento));
    const out = { foto: [], misura: [], chiusi: [] };
    for (let i = 0; i < 3; i++) {
      let t = Date.now(); await wc.capturePage(); out.foto.push(Date.now() - t);
      t = Date.now(); await M.campiSegretiFuoriPagina(wc); out.misura.push(Date.now() - t);
      t = Date.now(); await M.campiSegretiNeiComponentiChiusi(wc); out.chiusi.push(Date.now() - t);
    }
    return out;
  }, frammento);
}

test('tempi su una pagina semplice e su una pagina pesante', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const leggera = await testServer.openReady(openTab, '<!doctype html><html><head><title>Leggera</title></head><body><h1>Ciao</h1><input></body></html>');
  console.log('leggera', JSON.stringify(await tempi(app, new URL(leggera.url()).pathname)));
  const riquadri = Array.from({ length: 20 }, (_, i) => testServer.html(`<!doctype html><html><body>${'<div><span>x</span><a href="#">y</a></div>'.repeat(2000)}<p>r${i}</p></body></html>`, { pubblico: true }));
  const pesante = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pesante</title></head><body>
    <script>document.write('<div class="c"><p>testo <b>uno</b> <i>due</i></p><ul><li>a</li><li>b</li></ul></div>'.repeat(15000));</script>
    ${riquadri.map((u) => `<iframe src="${u}" width="200" height="100"></iframe>`).join('')}</body></html>`);
  await expect.poll(() => pesante.frames().length, { timeout: 30_000 }).toBeGreaterThan(15);
  console.log('nodi', await pesante.evaluate(() => document.getElementsByTagName('*').length));
  console.log('pesante', JSON.stringify(await tempi(app, new URL(pesante.url()).pathname)));
});
