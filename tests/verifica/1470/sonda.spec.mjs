// Sonda della verifica di #1470: chiusure da tastiera e sessione ripristinata seguita da un'uscita vera.
import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const finestra = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const out = {};
  for (const o of Object.values(s.ore || {})) {
    if (!o.finestra) continue;
    for (const [c, m] of Object.entries(o.finestra)) {
      if (!m || typeof m !== 'object') continue;
      const t = out[c] || (out[c] = {});
      for (const [x, n] of Object.entries(m)) t[x] = (t[x] || 0) + n;
    }
  }
  return out;
});

test('ctrl+w dalla tastiera della cornice e dalla pagina', async ({ app, shell, openTab }) => {
  await openTab('filo://history/history.html');
  await openTab('filo://options/options.html');
  await openTab('filo://downloads/');
  const conta = async () => (await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.length));
  const n0 = await conta();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.focus();
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: ['control'] });
    t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'W', modifiers: ['control'] });
  });
  await expect.poll(conta).toBe(n0 - 1);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.webContents.focus();
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: ['control'] });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'W', modifiers: ['control'] });
  });
  await expect.poll(conta).toBe(n0 - 2);
  await sleep(1500);
  const f = await finestra(app);
  console.log('SONDA ctrlw', JSON.stringify(f.chiusuraScheda));
  expect(f.chiusuraScheda?.['ctrl_w:m1'] || 0).toBe(2);
});

test('la sessione ripristinata e chiusa subito arriva anche se Filo esce prima dei cinque minuti', async () => {
  test.setTimeout(180_000);
  const userData = cartellaTemporanea('filo-sonda-1470-');
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><p>${req.url}</p>`); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ sn_open_tabs: { tabs: [`${base}/a`, `${base}/b`, `${base}/c`], activeIndex: 0 } }));
  const env = { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' };
  let app = null;
  try {
    app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      return w ? w._filoTabs.tabs.filter((t) => t._ripristino).length : 0;
    }), { timeout: 60_000 }).toBe(3);
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      w._filoTabs.closeTab(w._filoTabs.tabs[w._filoTabs.tabs.length - 1].id, { via: 'pulsante_x' });
    });
    await sleep(1500);
    const prima = await finestra(app);
    console.log('SONDA prima', JSON.stringify(prima.sessioneRipristinata || {}), JSON.stringify(prima.chiusuraScheda || {}));
    await chiudiApp(app, { tetto: 15000 });
    app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env });
    await sleep(4000);
    const dopo = await finestra(app);
    console.log('SONDA dopo', JSON.stringify(dopo.sessioneRipristinata || {}), JSON.stringify(dopo.chiusuraScheda || {}));
    expect(Object.keys(dopo.sessioneRipristinata || {}).filter((k) => k.startsWith('n2_5:'))).toEqual(['n2_5:q50']);
  } finally {
    if (app) await chiudiApp(app);
    server.close();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
