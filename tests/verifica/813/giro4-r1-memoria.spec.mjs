// Verifica di #813, quarto giro, rilievo 1: l'impronta di una pagina non deve tenere in memoria copie del suo indirizzo.
// Otto indirizzi lunghissimi aperti di fila non devono lasciare centinaia di MB nel processo principale.
import http from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

test('otto indirizzi lunghissimi aperti di fila non lasciano centinaia di MB occupati dal controllo di Google', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = http.createServer({ maxHeaderSize: 8 * 1024 * 1024 }, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>LUNGA</title><p>pagina</p>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    await app.evaluate(() => {
      const SB = globalThis.SN_SAFEBROWSE;
      SB._gsbLookup.clear();
      const prima = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        if (!String(url).startsWith('https://safebrowsing.googleapis.com/')) return prima(url, opts);
        return { ok: true, status: 200, async json() { return { cacheDuration: '300s' }; } };
      };
      SB.configure({ gsbKey: () => 'chiave-di-prova', enableSandbox: false, enableNetwork: false });
      process.getBuiltinModule('v8').setFlagsFromString('--expose-gc');
      globalThis.__gc813 = process.getBuiltinModule('vm').runInNewContext('gc');
    });
    const heap = () => app.evaluate(() => { globalThis.__gc813(); globalThis.__gc813(); return process.memoryUsage().heapUsed; });
    const page = await openTab(testServer.html('<title>INIZIO</title><p>inizio</p>'));
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    const base = await heap();
    const porta = srv.address().port;
    for (let k = 0; k < 8; k++) {
      const seg = String.fromCharCode(97 + k).repeat(450_000);
      const url = `http://a.b.c.d.e.f.g.localhost:${porta}/${seg}/${seg}/${seg}/q?${'y'.repeat(400_000)}`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    }
    await page.waitForTimeout(1500);
    const occupati = (await heap()) - base;
    console.log(`MB rimasti nel processo principale: ${(occupati / 1e6).toFixed(1)}`);
    for (let k = 0; k < 8; k++) await page.goto(`http://127.0.0.1:${porta}/corta${k}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    console.log(`MB dopo otto pagine corte: ${(((await heap()) - base) / 1e6).toFixed(1)}`);
    expect(occupati).toBeLessThan(100e6);
  } finally {
    srv.close();
  }
});
