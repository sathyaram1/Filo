import http from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

async function secondoServer(body) {
  const s = http.createServer((_q, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { s, url: `http://127.0.0.1:${s.address().port}/` };
}

async function misura(app, percorso) {
  return app.evaluate(async ({ webContents }, percorso) => {
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
}

for (const variante of ['base', 'stessoSito', 'testo']) {
  test(`tempi ${variante}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(180_000);
    const altro = await secondoServer('<!doctype html><html><body><form>Iscriviti alla newsletter <input name="email"></form></body></html>');
    try {
      const riquadri = Array.from({ length: 20 }, (_, i) => testServer.html(`<!doctype html><html><body>
        ${'<div><span>x</span><a href="#">y</a></div>'.repeat(2000)}<p>r${i}</p></body></html>`, { pubblico: true }));
      const extra = variante === 'stessoSito' ? `<iframe src="${altro.url}" width="300" height="80"></iframe>`
        : variante === 'testo' ? '<p>Il campo si scrive <code>&lt;input&gt;</code></p>' : '';
      const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Lunga</title></head><body>
        <form><input name="q" value="scarpe da corsa"> <textarea>una nota</textarea></form>${extra}
        <script>document.write('<div><p>testo <b>uno</b> <i>due</i></p><ul><li>a</li><li>b</li></ul></div>'.repeat(13000));</script>
        ${riquadri.map((u) => `<iframe src="${u}" width="200" height="100"></iframe>`).join('')}</body></html>`);
      await expect.poll(() => page.frames().length, { timeout: 30_000 }).toBeGreaterThan(15);
      await page.waitForTimeout(2000);
      const esito = await misura(app, new URL(page.url()).pathname);
      console.log(variante, JSON.stringify(esito));
    } finally { altro.s.close(); }
  });
}
