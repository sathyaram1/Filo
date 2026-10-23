// r2: su un sito in chiaro (http, non locale) Chrome non manda i segnali del browser (Sec-CH-UA*) e la pagina non li
// vede; Filo li aggiunge lo stesso, e la differenza dice al sito che non è Chrome.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test.setTimeout(90_000);

test('r2 un sito in chiaro non riceve i segnali del browser, come in Chrome', async ({ openTab }) => {
  const visti = new Map();
  const srv = createServer((req, res) => {
    visti.set(req.url.split('?')[0], req.headers);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>IN CHIARO</title><p>ok</p>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const page = await openTab(`http://sito-pubblico.test:${srv.address().port}/chiaro`);
    await page.waitForLoadState('load');
    const pagina = await page.evaluate(() => ({ sicura: window.isSecureContext, uad: typeof navigator.userAgentData }));
    expect(pagina, 'la pagina in chiaro non è sicura e non vede i segnali').toEqual({ sicura: false, uad: 'undefined' });
    const h = visti.get('/chiaro');
    expect(h, 'la richiesta è arrivata').toBeTruthy();
    expect({ ua: h['sec-ch-ua'] || null, mobile: h['sec-ch-ua-mobile'] || null, piattaforma: h['sec-ch-ua-platform'] || null })
      .toEqual({ ua: null, mobile: null, piattaforma: null });
  } finally {
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
});
