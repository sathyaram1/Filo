import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

test('debug3', async ({ app, openTab }) => {
  test.setTimeout(60000);
  const server = createServer((req, res) => {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>403</title><h1 id="msg">Access denied to this resource.</h1>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await app.evaluate(() => {
    const Classifier = globalThis.SN_GEOBLOCK_CLASSIFIER;
    const cache = Classifier.createCache();
    globalThis.__fakeClass = 'geo_block';
    globalThis.__dbg = [];
    globalThis.SN_GEO_CLASSIFY = async (input) => {
      const r = await Classifier.classify(input, { complete: async () => globalThis.__fakeClass, cache });
      const w = globalThis.require ? null : null;
      globalThis.__dbg.push({ inUrl: input.url, status: input.statusCode, cls: r.class, proxy: r.route && r.route.proxy, skipped: r.skipped });
      return r;
    };
    globalThis.__geoSignals = [];
    globalThis.SN_GEOBLOCK.onDetected((s) => globalThis.__geoSignals.push(s));
  });
  const page = await openTab(`${origin}/forbidden-geo`);
  await page.waitForSelector('#msg');
  await new Promise((r) => setTimeout(r, 5000));
  const dbg = await app.evaluate(() => globalThis.__dbg);
  const sigs = await app.evaluate(() => globalThis.__geoSignals);
  const tab = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''));
    let cur=''; try{cur=t.view.webContents.getURL();}catch(e){}
    return { url: t.url, curWcUrl: cur, geoBlock: t.geoBlock };
  });
  console.log('DBG=', JSON.stringify(dbg));
  console.log('SIGS=', JSON.stringify(sigs));
  console.log('TAB=', JSON.stringify(tab));
  await new Promise((r) => server.close(r));
});
