// Esplorazione: riquadri chiusi in sandbox con un campo, su una pagina grande.

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
  ['un riquadro in sandbox senza script con un campo', '<iframe sandbox="" srcdoc="<input name=email>"></iframe>'],
  ['un riquadro in sandbox con script con un campo', '<iframe sandbox="allow-scripts" srcdoc="<input name=email>"></iframe>'],
  ['un riquadro in sandbox stessa origine senza script', '<iframe sandbox="allow-same-origin" srcdoc="<input name=email>"></iframe>'],
];

for (const [nome, extra] of CASI) {
  test(`esplora ${nome}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120_000);
    const page = await testServer.openReady(openTab, grande(extra));
    await new Promise((r) => setTimeout(r, 1000));
    const esito = await misura(app, new URL(page.url()).pathname);
    console.log(nome, JSON.stringify(esito));
    expect(Math.max(...esito.durate.map((d) => d.ms))).toBeLessThan(1000);
  });
}
