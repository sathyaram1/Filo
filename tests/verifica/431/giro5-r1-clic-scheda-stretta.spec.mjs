// Verifica #431 giro 5, rilievo 1: su una scheda stretta che suona resta visibile solo l'altoparlante, e il clic lì muta invece di aprirla.
import { test, expect } from '../../fixtures/electron.mjs';

test('clic al centro di una scheda stretta che suona: si apre la scheda', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  for (let i = 0; i < 25; i++) await openTab(testServer.html(`<title>Video ${i}</title>`));
  await expect(shell.locator('.tab')).toHaveCount(26, { timeout: 30_000 });
  const id = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const web = w._filoTabs.tabs.filter((x) => /^https?:/.test(x.url || ''));
    Object.assign(web[0], { audible: true, loading: false });
    w._filoTabs._broadcast();
    return web[0].id;
  });
  const tab = shell.locator(`.tab[data-id="${id}"]`);
  await expect(tab.locator('.audio-ind')).toBeVisible({ timeout: 10_000 });
  await expect(tab.locator('.favicon')).toBeHidden();
  const box = await tab.boundingBox();
  expect(box.width).toBeLessThan(56);
  await shell.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(tab).toHaveClass(/active/, { timeout: 5000 });
  const muted = await app.evaluate(({ BrowserWindow }, id) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return !!w._filoTabs.tabs.find((x) => x.id === id).muted;
  }, id);
  expect(muted).toBe(false);
});
