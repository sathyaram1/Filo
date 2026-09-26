// #686 — giro 3: strade equivalenti, più schede, valori strani.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = (n) => `<!doctype html><html><head><meta charset="utf-8"><title>p${n}</title></head>
<body><h1>pagina ${n}</h1></body></html>`;

const execAction = (app, action) =>
  app.evaluate(({ BrowserWindow }, { action }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return globalThis.SN_EXECUTE_FILO_ACTION(action, { sender: { win, wc: win.webContents } });
  }, { action });

// Lo zoom di una scheda precisa, cercata per coda dell'indirizzo: la Page che
// torna dalla fixture si sceglie per host, e nel test l'host è uno solo.
const zoomDi = (app, coda) => app.evaluate(({ BrowserWindow }, c) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  const t = win._filoTabs.tabs.find((x) => { try { return x.view.webContents.getURL().endsWith(c); } catch (_) { return false; } });
  if (!t) return null;
  try { return Math.round(t.view.webContents.getZoomFactor() * 100); } catch (_) { return null; }
}, coda);

const stato = (app) => app.evaluate(async () => (await globalThis.SN_FILO_STATE.assemble()).stateText);

test('due schede: la chat zooma quella davanti e lascia stare l\'altra', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA(1));
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => zoomDi(app, '/1')).toBe(200);

  await testServer.openReady(openTab, PAGINA(2));
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 125 });
  await expect.poll(async () => zoomDi(app, '/2')).toBe(125);
  expect(await zoomDi(app, '/1')).toBe(200);
  expect(await stato(app)).toMatch(/Scheda davanti: 125%/);
});

test('valori strani: niente zoom a caso e niente numero inventato', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA(3));
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  await expect.poll(async () => zoomDi(app, '/1')).toBe(150);

  for (const valore of [0, -50, 'abc', '', '   ', '12,5,7', 'NaN', null, {}, [], '150%%', '<b>150</b>']) {
    const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: valore });
    expect(r.executed, `percentuale=${JSON.stringify(valore)}`).toBe(false);
    expect(await zoomDi(app, '/1'), `percentuale=${JSON.stringify(valore)}`).toBe(150);
  }
  const r = await execAction(app, { type: 'ZOOM_PAGINA', verso: 'grande' });
  expect(r.executed).toBe(false);
  expect(await zoomDi(app, '/1')).toBe(150);

  // Le grafie umane invece funzionano, e il numero riferito è quello vero.
  for (const [valore, atteso] of [['125%', 125], [' 125 ', 125]]) {
    const ok = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: valore });
    expect(ok.executed, `percentuale=${valore}`).toBe(true);
    expect(ok.output.percentuale, `percentuale=${valore}`).toBe(atteso);
    expect(await zoomDi(app, '/1'), `percentuale=${valore}`).toBe(atteso);
  }
});

test('editor: il tasto destro dice lo stesso numero che dice la chat', async ({ app, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  expect(r.executed).toBe(true);
  await expect.poll(async () => page.evaluate(() => document.getElementById('doc').style.zoom)).toBe('1.5');
  expect(await stato(app)).toMatch(/Scheda davanti: 150%/);

  await page.locator('#doc').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await expect(page.locator('.sn-menu').getByText(/150%/)).toHaveCount(1);
});

test('editor: oltre il massimo del foglio si ferma e lo dice', async ({ app, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 500 });
  expect(r.executed).toBe(true);
  await expect.poll(async () => page.evaluate(() => document.getElementById('doc').style.zoom)).toBe('3');
  expect(r.output.limitato).toBe(true);
  expect(await stato(app)).toMatch(/Scheda davanti: 300%/);
});
