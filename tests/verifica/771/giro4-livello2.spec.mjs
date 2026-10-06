// #771 giro 4: senza fornitore il livello 2 non chiama il modello; col fornitore sì.
// Spia sul fornitore di modelli vero (SN_PROVIDERS.completeWithFallback), pagine vere del mini server.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function startServer() {
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path.startsWith('/vietato')) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>403</title><h1>Access denied to this resource.</h1>');
    } else if (path.startsWith('/vuota')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>x</title><img alt="">');
    } else if (path.startsWith('/errore')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>Oops</title><p>Something went wrong. ' + 'Please try again later, our team is on it. '.repeat(5) + '</p>');
    } else {
      res.writeHead(404); res.end('no');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

async function spia(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.GEOBLOCK_CLASSIFY]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__geoCalls = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const m = JSON.stringify(messages);
      // Altri classificatori (il giudice dei siti sospetti) usano lo stesso fornitore: conta solo il livello 2.
      if (!m.includes('PERCHÉ una pagina web non mostra')) return { text: '{}', model: attempts[0] && attempts[0].model, usage: {} };
      globalThis.__geoCalls.push(m.slice(0, 400));
      return { text: '{"class":"errore_generico"}', model: attempts[0] && attempts[0].model, usage: {} };
    };
  });
}

const chiamate = (app) => app.evaluate(() => globalThis.__geoCalls.length);

test('senza fornitore: 403, pagina quasi vuota e «something went wrong» non chiamano il modello', async ({ app, openTab, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const srv = await startServer();
  try {
    await spia(app);
    for (const p of ['/vietato', '/vuota', '/errore']) {
      const page = await openTab(`${srv.origin}${p}`);
      await page.waitForLoadState('load').catch(() => {});
    }
    // Il controllo del testo gira al load e di nuovo dopo 2 s.
    await new Promise((r) => setTimeout(r, 5_000));
    expect(await chiamate(app)).toBe(0);
  } finally { await srv.close(); }
});

test('col fornitore la stessa pagina 403 chiama il modello', async ({ app, openTab, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const srv = await startServer();
  try {
    await spia(app);
    await app.evaluate(async () => {
      await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: 'socks5://127.0.0.1:9' } });
    });
    const page = await openTab(`${srv.origin}/vietato-con`);
    await page.waitForLoadState('load').catch(() => {});
    await expect.poll(() => chiamate(app), { timeout: 15_000 }).toBeGreaterThan(0);
  } finally { await srv.close(); }
});
