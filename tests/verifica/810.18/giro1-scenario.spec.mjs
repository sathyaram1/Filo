// Verifica #810.18, giro 1: le domande all'assistente su una pagina grande senza componenti chiusi, coi passi della
// segnalazione, misurate dal lato dell'utente (attesa fra l'invio e la chiamata al modello, Filo fermo).

import http from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

async function secondoServer(body) {
  const s = http.createServer((_q, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { s, url: `http://127.0.0.1:${s.address().port}/` };
}

async function preparaModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const finto = async ({ attempts, messages }) => {
      globalThis.__visti.push({ t: Date.now(), img: JSON.stringify(messages).includes('data:image/') });
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: JSON.stringify({ text: 'Ecco.', status: 'done' }) };
    };
    P.completeWithFallback = finto;
    P.streamCompleteWithFallback = finto;
  });
}

// Tre domande di fila; per ognuna l'attesa fino al modello, e il fermo più lungo del processo principale.
async function treDomande(app, shell, page) {
  await preparaModelli(app);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 15_000 });
  await app.evaluate(() => {
    globalThis.__fermo = 0;
    let prec = Date.now();
    globalThis.__iv = setInterval(() => { const n = Date.now(); globalThis.__fermo = Math.max(globalThis.__fermo, n - prec); prec = n; }, 10);
  });
  const attese = [];
  for (let i = 0; i < 3; i++) {
    await aiuto.fill('.sn-sidebar-input textarea', `dove trovo le taglie? ${i}`);
    const t = await app.evaluate(() => Date.now());
    await aiuto.press('.sn-sidebar-input textarea', 'Enter');
    await expect.poll(() => app.evaluate(() => globalThis.__visti.length), { timeout: 40_000 }).toBe(i + 1);
    const v = await app.evaluate(() => globalThis.__visti.at(-1));
    attese.push({ ms: v.t - t, img: v.img });
    await new Promise((r) => setTimeout(r, 1500));
  }
  const fermo = await app.evaluate(() => { clearInterval(globalThis.__iv); return globalThis.__fermo; });
  return { attese, fermo };
}

const CASI = [
  ['senza riquadro né scritta (riferimento)', () => ''],
  ['con un riquadro di un’altra porta dello stesso indirizzo con un campo per l’email', (altro) => `<iframe src="${altro}" width="320" height="80"></iframe>`],
  ['con il commento «vecchio modulo: <input>»', () => '<!-- vecchio modulo: <input> -->'],
];

for (const [nome, extra] of CASI) {
  test(`pagina di novantamila elementi e venti riquadri, ${nome}: ogni domanda arriva al modello con la foto, senza attese né Filo fermo`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(180_000);
    const altro = await secondoServer('<!doctype html><html><body><form>Iscriviti alla newsletter <input type="email" name="email"></form></body></html>');
    try {
      const riquadri = Array.from({ length: 20 }, (_, i) => testServer.html(`<!doctype html><html><body>
        ${'<div><span>x</span><a href="#">y</a></div>'.repeat(1500)}<p>r${i}</p></body></html>`, { pubblico: true }));
      const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Negozio</title></head><body>
        <h1>Scarpe</h1>${extra(altro.url)}
        <script>document.write('<div><p>scarpa <b>uno</b> <i>due</i></p><ul><li>a</li><li>b</li></ul></div>'.repeat(9000));</script>
        ${riquadri.map((u) => `<iframe src="${u}" width="200" height="100"></iframe>`).join('')}</body></html>`);
      expect(await page.evaluate(() => document.getElementsByTagName('*').length)).toBeGreaterThan(60_000);
      await expect.poll(() => page.frames().length, { timeout: 30_000 }).toBeGreaterThan(20);
      const { attese, fermo } = await treDomande(app, shell, page);
      console.log(nome, JSON.stringify({ attese, fermo }));
      expect(attese.every((a) => a.img), 'ogni domanda porta la foto della pagina').toBe(true);
      expect(Math.max(...attese.map((a) => a.ms)), 'attesa fra l’invio e il modello').toBeLessThan(2500);
      expect(fermo, 'Filo fermo durante le domande').toBeLessThan(500);
    } finally { altro.s.close(); }
  });
}
