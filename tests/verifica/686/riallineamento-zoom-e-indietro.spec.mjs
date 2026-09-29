// #686 riallineamento: lo zoom chiesto in chat e indietro/avanti (arrivato da main) convivono.
import { test, expect } from '../../fixtures/electron.mjs';

const execAction = (app, action) =>
  app.evaluate(({ BrowserWindow }, { action }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return globalThis.SN_EXECUTE_FILO_ACTION(action, { sender: { win, wc: win.webContents } });
  }, { action });

const zoomAttivo = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return Math.round(t.view.webContents.getZoomFactor() * 100);
});
const urlAttivo = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t.view.webContents.getURL();
});
const premi = (app, keyCode, sullaBarra = false) => app.evaluate(({ BrowserWindow }, a) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  const wc = a.sullaBarra ? w.webContents : t.view.webContents;
  wc.sendInputEvent({ type: 'keyDown', keyCode: a.keyCode, modifiers: a.mods });
}, { keyCode, sullaBarra, mods: keyCode === '0' || keyCode === '=' ? ['control'] : ['alt'] });
const stato = (app) => app.evaluate(async () => (await globalThis.SN_FILO_STATE.assemble()).stateText);

test('zoom in chat, poi indietro e avanti fra due siti: le due strade non si pestano', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><title>A</title><h1>A</h1>');
  const b = testServer.html('<!doctype html><title>B</title><h1>B</h1>').replace('127.0.0.1', 'localhost');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  expect(r.executed).toBe(true);
  await expect.poll(() => zoomAttivo(app)).toBe(150);

  await page.evaluate((u) => { location.href = u; }, b);
  await expect.poll(() => urlAttivo(app)).toBe(b);
  await expect.poll(() => zoomAttivo(app)).toBe(100);

  await premi(app, 'Left');
  await expect.poll(() => urlAttivo(app)).toBe(a);
  expect(await stato(app)).toContain(`${await zoomAttivo(app)}%`);

  await premi(app, 'Right', true);
  await expect.poll(() => urlAttivo(app)).toBe(b);
  await expect.poll(() => zoomAttivo(app)).toBe(100);

  // Indietro dalla barra, poi Ctrl 0 e Ctrl = dalla barra: le due scorciatoie non si pestano.
  await premi(app, 'Left', true);
  await expect.poll(() => urlAttivo(app)).toBe(a);
  await premi(app, '0', true);
  await expect.poll(() => zoomAttivo(app)).toBe(100);
  await premi(app, '=', true);
  await expect.poll(() => zoomAttivo(app)).toBe(110);
  expect(await urlAttivo(app)).toBe(a);
});

test('la barra dei menu ha ancora le voci dello zoom accanto a Indietro e Avanti', async ({ app }) => {
  const etichette = await app.evaluate(({ Menu }) => {
    const out = [];
    const giro = (m) => (m ? m.items : []).forEach((i) => { out.push(i.label); giro(i.submenu); });
    giro(Menu.getApplicationMenu());
    return out;
  });
  for (const l of ['Indietro', 'Avanti', 'Ingrandisci', 'Rimpicciolisci', 'Dimensione reale']) expect(etichette).toContain(l);
});
