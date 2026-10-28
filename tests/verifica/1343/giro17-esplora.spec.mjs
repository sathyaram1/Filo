// Verifica #1343 giro 17: esplorazione a schermo intero col puntatore vero (xdotool su X11).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';

let xdotool = false;
try { execFileSync('xdotool', ['version'], { stdio: 'ignore' }); xdotool = process.platform === 'linux' && !!process.env.DISPLAY; } catch (_) {}
const nascosta = process.env.FILO_HIDE_WINDOW;
if (xdotool) delete process.env.FILO_HIDE_WINDOW;
test.afterAll(() => { if (nascosta !== undefined) process.env.FILO_HIDE_WINDOW = nascosta; });
const xdo = (...a) => execFileSync('xdotool', a.map(String));
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const tmEval = (app, fn, arg) => app.evaluate(({ BrowserWindow }, a) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  // eslint-disable-next-line no-new-func
  return new Function('tm', 'arg', a.fn)(tm, a.arg);
}, { fn, arg });
const visibili = (app) => tmEval(app, 'return !!tm.schedeInAlto.visibili');
const cima = (app) => tmEval(app, 'const t = tm.tabs.find((x) => x.id === tm.activeId); return { y: t.view.getBounds().y, fila: tm.tabRowHeight, url: t.view.webContents.getURL(), n: tm.tabs.length };');

async function aSchermoIntero(app) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).focus());
  await tmEval(app, 'tm.setContentFullscreen(true)');
  await expect.poll(async () => (await cima(app)).y).toBe(0);
  await pausa(900);
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs).getContentBounds());
}
async function versoIlBordo(cb, x = 400) {
  xdo('mousemove', cb.x + x, cb.y + 300); await pausa(200);
  for (let i = 1; i <= 10; i++) { xdo('mousemove', cb.x + x, Math.round(cb.y + 300 - 300 * i / 10)); await pausa(30); }
  await pausa(1200);
}

test('pdf: a schermo intero il bordo alto fa arrivare le schede', async ({ app, openTab, testServer }) => {
  test.skip(!xdotool, 'serve xdotool');
  await testServer.openReady(openTab, '<!doctype html><title>Prima</title><h1>Prima</h1>');
  const url = testServer.asset(readFileSync('tests/fixtures/documenti/documento-con-testo.pdf'), 'application/pdf');
  await tmEval(app, 'tm.navigate(tm.activeId, arg)', url);
  await pausa(3000);
  const cb = await aSchermoIntero(app);
  await versoIlBordo(cb);
  const v = await visibili(app);
  console.log('PDF', JSON.stringify(await cima(app)), v);
  expect(v).toBe(true);
});

test('home: a schermo intero il bordo alto fa arrivare le schede', async ({ app }) => {
  test.skip(!xdotool, 'serve xdotool');
  await pausa(1500);
  const cb = await aSchermoIntero(app);
  await versoIlBordo(cb);
  console.log('HOME', JSON.stringify(await cima(app)));
  expect(await visibili(app)).toBe(true);
});

test('cambio scheda dalla fila scoperta, poi la fila se ne va: la nuova scheda torna in cima', async ({ app, shell, openTab, testServer }) => {
  test.skip(!xdotool, 'serve xdotool');
  await testServer.openReady(openTab, '<!doctype html><title>Prima</title><body style="background:#fdd"><h1>Prima</h1>');
  await testServer.openReady(openTab, '<!doctype html><title>Seconda</title><body style="background:#dfd"><h1>Seconda</h1>');
  const cb = await aSchermoIntero(app);
  await versoIlBordo(cb);
  expect(await visibili(app)).toBe(true);
  const tab = await shell.locator('.tab:has-text("Prima")').first().boundingBox();
  xdo('mousemove', cb.x + Math.round(tab.x + tab.width / 2), cb.y + Math.round(tab.y + tab.height / 2)); await pausa(300);
  xdo('click', 1); await pausa(500);
  expect((await cima(app)).url).toContain('');
  xdo('mousemove', cb.x + 400, cb.y + 300); await pausa(200);
  xdo('mousemove', cb.x + 420, cb.y + 320); await pausa(1500);
  const c = await cima(app);
  console.log('CAMBIO', JSON.stringify(c), await visibili(app));
  expect(await visibili(app)).toBe(false);
  expect(c.y).toBe(0);
  const viste = await tmEval(app, 'return tm.tabs.map((t) => ({ id: t.id, attiva: t.id === tm.activeId, b: t.view.getBounds(), vis: t.view.getVisible ? t.view.getVisible() : null }))');
  console.log('VISTE', JSON.stringify(viste));
});

test('uscita dallo schermo intero con le schede scoperte: la cornice torna normale', async ({ app, openTab, testServer }) => {
  test.skip(!xdotool, 'serve xdotool');
  await testServer.openReady(openTab, '<!doctype html><title>Prima</title><h1>Prima</h1>');
  const cb = await aSchermoIntero(app);
  await versoIlBordo(cb);
  expect(await visibili(app)).toBe(true);
  await tmEval(app, 'tm.setContentFullscreen(false)');
  await pausa(1500);
  const c = await cima(app);
  console.log('USCITA', JSON.stringify(c), await visibili(app));
  expect(c.y).toBeGreaterThan(0);
  // Di nuovo a schermo intero: la fila non è già giù.
  await tmEval(app, 'tm.setContentFullscreen(true)');
  await pausa(1200);
  console.log('RIENTRO', JSON.stringify(await cima(app)), await visibili(app));
  expect((await cima(app)).y).toBe(0);
});

test('nuova scheda con la tastiera a fila scoperta, poi giù sulla pagina: la fila se ne va', async ({ app, openTab, testServer }) => {
  test.skip(!xdotool, 'serve xdotool');
  await testServer.openReady(openTab, '<!doctype html><title>Prima</title><h1>Prima</h1>');
  const cb = await aSchermoIntero(app);
  await versoIlBordo(cb);
  expect(await visibili(app)).toBe(true);
  xdo('key', 'ctrl+t'); await pausa(1500);
  console.log('CTRLT-1', JSON.stringify(await cima(app)), await visibili(app), await tmEval(app, 'return !!tm.contentFullscreen'));
  xdo('mousemove', cb.x + 400, cb.y + 300); await pausa(200);
  xdo('mousemove', cb.x + 420, cb.y + 330); await pausa(1500);
  console.log('CTRLT-2', JSON.stringify(await cima(app)), await visibili(app));
  expect(await visibili(app)).toBe(false);
  expect((await cima(app)).y).toBe(0);
});

test('con l\'opzione spenta il bordo alto non fa arrivare le schede', async ({ app, openTab, testServer }) => {
  test.skip(!xdotool, 'serve xdotool');
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { barraLaterale: { schede: false } } },
    { tab: { id: 5, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' }));
  await testServer.openReady(openTab, '<!doctype html><title>Prima</title><h1>Prima</h1>');
  await pausa(800);
  console.log('OPZ', JSON.stringify(await tmEval(app, 'return tm.barra && tm.barra.opzioni')));
  const cb = await aSchermoIntero(app);
  await versoIlBordo(cb);
  expect(await visibili(app)).toBe(false);
});
