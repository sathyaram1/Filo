// Verifica #841, giro 1, rilievo 1: spegnere l'Aiuto deve togliere anche il pannello già aperto su una scheda.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = '<!doctype html><title>Pagina</title><body style="margin:0;padding:24px;font:16px sans-serif"><p id="p">Un paragrafo.</p></body>';

test('r1 «spegni l\'Aiuto» con il pannello aperto lo chiude', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html(PAGINA));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const wc = w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'H', modifiers: ['alt'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'H', modifiers: ['alt'] });
  });
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8000 });
  const r = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_PREFERENZA', chiave: 'aiuto', valore: 'spento' }));
  expect(r.executed).toBe(true);
  await expect(page.locator('.sn-sidebar')).toBeHidden({ timeout: 8000 });
});
