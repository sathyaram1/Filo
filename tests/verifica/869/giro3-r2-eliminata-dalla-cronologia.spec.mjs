// Verifica #869 giro 3, rilievo 2: una scheda chiusa eliminata dalla Cronologia resta nel filo della home e nella sua ricerca.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

test('r2 elimino dalla Cronologia la scheda chiusa di «orche marine»: la home non la mostra e la ricerca non la trova', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await home(app);
  const url = testServer.html('<title>orche marine</title><p>le orche</p>');
  const p = await openTab(url);
  await p.waitForFunction(() => document.title === 'orche marine');
  await shell.evaluate(async (u) => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => x.url === u);
    await window.filoShell.tabs.close(t.id);
  }, url);
  await expect.poll(() => app.evaluate(async (_e, u) => (await globalThis.SN_ARCHIVED_TABS.list()).filter((t) => t.url === u).length, url)).toBe(1);
  const cron = await openTab('filo://archive/archive.html');
  const r = await cron.evaluate(async (u) => {
    const { MSG } = self.SN_MSG;
    const lista = await self.chrome.runtime.sendMessage({ type: MSG.GET_ARCHIVED_TABS });
    const t = (lista.tabs || lista || []).find((x) => x.url === u);
    return self.chrome.runtime.sendMessage({ type: MSG.REMOVE_ARCHIVED_TAB, id: t.id });
  }, url);
  expect(r.ok).toBe(true);
  const page = await openTab('filo://newtab/');
  await expect(page.locator('#input')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.locator('.dash-pagine', { hasText: 'orche marine' })).toHaveCount(0);
  await page.locator('#cercaInput').fill('orche');
  await expect(page.locator('#cercaRisultati')).toBeVisible();
  await expect(page.locator('#cercaRisultati .dash-cerca-pagina', { hasText: 'orche marine' })).toHaveCount(0);
});
