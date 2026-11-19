// #2507.1 giro 2: esplorazione. La conferma di Filo dentro un sito (mondo dei content script) ha i suoi segni.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import * as d from '../../agent/driver.mjs';
import { apriFiloPerLaProva } from '../../agent/provaPreparazione.mjs';
import { eseguiMossa } from '../../agent/provaMosse.mjs';

const require = createRequire(import.meta.url);
const { MONDO } = require('../../../src/preload/mondo-esente.js');
test.setTimeout(150_000);

let server;
let base;
test.beforeAll(async () => {
  server = createServer((q, r) => {
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    r.end('<!doctype html><title>Modulo</title><h1>Modulo</h1><input id="c" aria-label="Nome">');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server && server.close());

test('la conferma di Filo sopra un sito ha i segni, e OK conferma', async () => {
  const { app, shell } = await apriFiloPerLaProva();
  try {
    await d.navigate(app, shell, `${base}/modulo`);
    await expect.poll(async () => (await d.activeView(app, shell))?.url() || '').toContain('/modulo');
    await d.sleep(1500);
    const pronto = await app.evaluate(async ({ BrowserWindow }, mondo) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
      return wc.executeJavaScriptInIsolatedWorld(mondo, [{ code: `(() => { if (!globalThis.SN_CONFIRM_UI) return 'manca'; globalThis.__esito = 'aperta'; SN_CONFIRM_UI.confirm({ title: 'Filo chiede', text: 'Va bene?' }).then((ok) => { globalThis.__esito = ok; }); return 'ok'; })()` }]);
    }, MONDO);
    console.log('conferma:', pronto);
    let map = [];
    await expect.poll(async () => {
      ({ map } = await d.markInteractables(app, shell));
      await d.clearMarks(app, shell);
      return map.filter((m) => /^(OK|Annulla)$/i.test(m.label)).map((m) => m.label).sort();
    }, { timeout: 10_000 }).toEqual(['Annulla', 'OK']);
    await d.sleep(700);
    await eseguiMossa(app, shell, { azione: 'clic', segno: map.find((m) => /^OK$/i.test(m.label)).i }, map, null);
    await expect.poll(() => app.evaluate(async ({ BrowserWindow }, mondo) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
      return wc.executeJavaScriptInIsolatedWorld(mondo, [{ code: 'globalThis.__esito' }]);
    }, MONDO)).toBe(true);
  } finally {
    await d.closeFilo(app);
  }
});
