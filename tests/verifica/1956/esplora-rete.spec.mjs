// Esplorazione del giro 2 di verifica #1956: perché la pagina d'errore di rete non si conta sul ramo. Si cancella.
import { test, expect } from '../../fixtures/electron.mjs';

const stato = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const ev = {};
  for (const v of Object.values(s.ore || {})) Object.assign(ev, v.erroriVisti || {});
  const w = require('electron').BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.map((x) => ({ id: x.id, url: x.url, wc: x.view && x.view.webContents.getURL(), crashed: x.view && x.view.webContents.isCrashed() }));
  return { ev, t, active: w._filoTabs.activeId };
});

test('rete', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html('<!doctype html><title>viva</title><p>contenuto</p>');
  await openTab(url);
  await app.evaluate(({ webContents, BrowserWindow }, target) => {
    const shellWc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('filo://shell/'));
    const mainWin = BrowserWindow.fromWebContents(shellWc);
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === target && BrowserWindow.fromWebContents(w) === mainWin);
    process.kill(wc.getOSProcessId(), 'SIGKILL');
  }, url);
  await new Promise((r) => setTimeout(r, 3000));
  console.log('DOPO CRASH', JSON.stringify(await stato(app)));
  const s = await stato(app);
  await app.evaluate(({ BrowserWindow }, i) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === i);
    t.view.webContents.on('did-fail-load', (_e, code, desc, u) => console.log('[DBG] did-fail-load', code, desc, u));
    w._filoTabs.navigate(i, 'http://sito-che-non-esiste.invalid/');
  }, s.active);
  for (let k = 0; k < 4; k++) {
    await new Promise((r) => setTimeout(r, 2500));
    console.log('T', k, JSON.stringify(await stato(app)));
  }
  expect(1).toBe(1);
});
