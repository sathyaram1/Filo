// Verifica #530 giro 12, rilievo 1: a Conservativo, dopo una lettura, «cerca sul web» dall'Aiuto chiede due volte.
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmText, clickConfirm, scrollConfirmToEnd } from '../../helpers/confirm.mjs';

const PREFS = 'filo://preferences/preferences.html';

test('r1 a Conservativo, dopo una ricerca, «cerca sul web» dall\'Aiuto parte con un solo OK', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'conservativo' } });
    globalThis.SN_WEB_SEARCH.search = async () => ({ provider: 'finto', results: [
      { title: 'Pagina', url: 'https://sconosciuto.test/', content: 'testo di qualcun altro' },
    ] });
  });
  const page = await openTab(PREFS);
  await page.waitForFunction(() => typeof window.__filoSidebarTest?.runPageAction === 'function', null, { timeout: 10000 });
  await page.evaluate(() => {
    window.__opened = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...resto) => {
      if (msg && (msg.type === 'filo_run_action' || msg.type === 'filo_confirm_action') && msg.action && msg.action.type === 'NAVIGA') window.__opened.push(msg.type);
      return orig(msg, ...resto);
    };
    window.SN_SIDEBAR.open();
  });
  await page.evaluate(() => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.WEB_SEARCH, query: 'qualcosa' }));
  page.evaluate(() => window.__filoSidebarTest.runPageAction({ op: 'search_text', text: 'gatti' })).catch(() => {});
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 8000 });
  const primo = await confirmText(page);
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
  await expect.poll(() => page.evaluate(() => window.__opened.length), { timeout: 8000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  const secondo = await confirmText(page);
  expect(secondo, `dopo l'OK al primo popup («${primo.replace(/\n/g, ' ')}») ne arriva un altro`).toBe('');
});
