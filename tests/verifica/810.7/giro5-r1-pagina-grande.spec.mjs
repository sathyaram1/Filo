// Verifica #810.7, giro 5, rilievo 1: su una pagina grande senza componenti chiusi la foto per l'assistente torna ad
// aspettare secondi e Filo si ferma, se la pagina ha un riquadro dello stesso sito con un campo o la scritta «<input>».

import http from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

async function secondoServer(body) {
  const s = http.createServer((_q, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { s, url: `http://127.0.0.1:${s.address().port}/` };
}

const CASI = [
  ['r1 riquadro dello stesso sito con un campo', (altro) => `<iframe src="${altro}" width="300" height="80"></iframe>`],
  ['r1 la scritta «<input>» in un commento della pagina', () => '<!-- vecchio modulo: <input> -->'],
];

for (const [nome, extra] of CASI) {
  test(`${nome}: la foto per l’assistente non aspetta e Filo non si ferma`, async ({ app, openTab, testServer }) => {
    test.setTimeout(180_000);
    const altro = await secondoServer('<!doctype html><html><body><form>Iscriviti alla newsletter <input name="email"></form></body></html>');
    try {
      const riquadri = Array.from({ length: 20 }, (_, i) => testServer.html(`<!doctype html><html><body>
        ${'<div><span>x</span><a href="#">y</a></div>'.repeat(2000)}<p>r${i}</p></body></html>`, { pubblico: true }));
      const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Lunga</title></head><body>
        <form><input name="q" value="scarpe da corsa"> <textarea>una nota</textarea></form>${extra(altro.url)}
        <script>document.write('<div><p>testo <b>uno</b> <i>due</i></p><ul><li>a</li><li>b</li></ul></div>'.repeat(13000));</script>
        ${riquadri.map((u) => `<iframe src="${u}" width="200" height="100"></iframe>`).join('')}</body></html>`);
      await expect.poll(() => page.frames().length, { timeout: 30_000 }).toBeGreaterThan(15);
      await page.waitForTimeout(2000);
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
      }, new URL(page.url()).pathname);
      expect(esito.durate.every((d) => d.campi === 0)).toBe(true);
      expect(Math.max(...esito.durate.map((d) => d.ms)), 'ogni foto dell’assistente aspetta la ricerca dei campi').toBeLessThan(1000);
      expect(esito.fermo, 'Filo resta fermo mentre cerca i campi').toBeLessThan(300);
    } finally { altro.s.close(); }
  });
}
