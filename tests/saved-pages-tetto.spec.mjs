// #1088 — «Salva per dopo» con l'elenco già a 1000: la pagina nuova entra, la più vecchia esce, e un avviso nella
// finestra dice quale. Prima usciva senza che nessuno lo dicesse.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

test('a 1000 pagine salvate, salvarne un\'altra dice quale esce', async ({ app, openTab, testServer, avvisi }) => {
  const tetto = await app.evaluate(async () => {
    const { STORAGE_KEYS, SAVED_PAGES_LIMIT } = globalThis.SN_CONST;
    const base = Date.parse('2026-01-01T00:00:00Z');
    const pagine = Array.from({ length: SAVED_PAGES_LIMIT }, (_, i) => ({
      id: `p${i}`, url: `https://vecchie.example/${i}`,
      title: i === SAVED_PAGES_LIMIT - 1 ? 'La ricetta del 2019' : `Pagina ${i}`,
      favicon: '', thumbnail: null, savedAt: new Date(base + (SAVED_PAGES_LIMIT - i) * 60e3).toISOString(),
    }));
    await globalThis.chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGES]: pagine });
    return SAVED_PAGES_LIMIT;
  });

  const url = testServer.html('<!doctype html><html><head><title>Pagina nuova</title></head><body style="padding:40px"><h1>Nuova</h1></body></html>');
  const page = await openTab(url);
  await page.waitForLoadState('domcontentloaded');
  await page.click('body', { button: 'right' });
  const btn = menuDi(page).locator('.sn-menu [data-sn-icon-id="saveForLater"]');
  await expect(btn).toBeVisible();
  await btn.click();

  const vista = await avvisi();
  const avviso = vista.locator('.shell-notif-msg', { hasText: '«La ricetta del 2019»' });
  await expect(avviso).toBeVisible({ timeout: 10000 });
  await expect(avviso).toContainText(`al massimo ${tetto}`);
  await vista.screenshot({ path: 'tests/.shots/saved-pages-tetto.png' });

  const titoli = await app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).map((p) => p.title));
  expect(titoli.length).toBe(tetto);
  expect(titoli[0]).toBe('Pagina nuova');
  expect(titoli).not.toContain('La ricetta del 2019');
});
