// Esplorazione del giro 2 di #1434.2, quarta parte: icone della finestra premute nella fila, audio acceso e spento.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = (menu, sel) => menu.locator(sel).evaluateAll((els) => els.map((e) => `${e.dataset.snIconId}|${e.getAttribute('aria-label')}|${e.dataset.snDisabled || ''}`));
const esegui = (app, azione) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), azione);
const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().reduce((n, w) => n + ((w._filoTabs && w._filoTabs.tabs) || []).length, 0));

test('icone della finestra premute nella fila', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  for (const icona of ['newTab', 'closeTab']) await esegui(app, { type: 'SPOSTA_ICONA', icona, dove: 'fila', contesto: 'pagina' });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>W</title></head><body style="margin:0;padding:40px;height:900px"><div id="vuoto" style="height:400px"></div>
    <video id="vid" width="240" height="120" style="background:#000" controls></video></body></html>`);
  const menu = menuDi(page);
  await page.locator('#vid').click({ button: 'right' });
  await expect(menu.principale).toBeVisible();
  await menu.locator('.sn-menu-row [data-sn-icon-id="media:mute"]').click();
  await pausa(300);
  console.log('muted', await page.evaluate(() => document.getElementById('vid').muted));
  await page.locator('#vid').click({ button: 'right' });
  await expect(menu.principale).toBeVisible();
  console.log('video dopo muto fila', JSON.stringify(await ids(menu, '.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]')),
    JSON.stringify(await menu.locator('.sn-menu-item:visible').evaluateAll((els) => els.map((e) => e.textContent.trim()))));
  await page.keyboard.press('Escape');

  const n0 = await schede(app);
  await page.locator('#vuoto').click({ button: 'right' });
  await expect(menu.principale).toBeVisible();
  console.log('fila pagina', JSON.stringify(await ids(menu, '.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]')));
  await menu.locator('.sn-menu-row [data-sn-icon-id="newTab"]').click();
  await pausa(1500);
  const n1 = await schede(app);
  console.log('schede', n0, '->', n1);
  await page.bringToFront().catch(() => {});
  await app.evaluate(({ BrowserWindow }, u) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = (w._filoTabs?.tabs || []).find((x) => x.view?.webContents?.getURL() === u);
      if (t && w._filoTabs.activate) w._filoTabs.activate(t.id);
    }
  }, page.url()).catch(() => {});
  await pausa(800);
  await page.locator('#vuoto').click({ button: 'right' });
  await pausa(800);
  const c = menu.locator('.sn-menu-row [data-sn-icon-id="closeTab"]');
  console.log('closeTab visibile', await c.isVisible());
  if (await c.isVisible()) {
    await c.click();
    await pausa(1500);
    console.log('schede dopo chiudi', await schede(app), 'pagina chiusa', page.isClosed());
  }
});
