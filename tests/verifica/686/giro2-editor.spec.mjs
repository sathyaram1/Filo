// #686 giro 2 — l'editor scala il foglio: cosa fa e cosa racconta lo zoom chiesto in chat.
import { test, expect } from './../../fixtures/electron.mjs';

const execAction = (app, action) =>
  app.evaluate(({ BrowserWindow }, { action }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return globalThis.SN_EXECUTE_FILO_ACTION(action, { sender: { win, wc: win.webContents } });
  }, { action });

test('«zoom al 150%» sull\'editor: il foglio cambia, e Filo sa dire a quanto sta', async ({ app, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  expect(r.executed).toBe(true);
  await page.waitForTimeout(500);

  // Il foglio è davvero scalato?
  const zoomFoglio = await page.evaluate(() => {
    const el = document.getElementById('doc');
    return el ? { zoom: el.style.zoom, own: document.documentElement.dataset.filoOwnZoom, target: document.documentElement.dataset.filoZoomTarget } : null;
  });
  expect(zoomFoglio).toEqual(expect.objectContaining({ zoom: '1.5' }));

  // E Filo, a «a quanto è lo zoom?», risponde col numero giusto?
  const testo = await app.evaluate(async () => (await globalThis.SN_FILO_STATE.assemble()).stateText);
  expect(testo).toMatch(/Scheda davanti: 150%/);
});
