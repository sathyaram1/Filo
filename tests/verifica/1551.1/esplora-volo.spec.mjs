// Esplorazione della verifica #1551.1 giro 1: col testo ingrandito l'avviso in volo atterra sulla sua carta? Da cancellare.
import { test, expect } from '../../fixtures/electron.mjs';

async function home(app) {
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 8_000 });
  return page;
}

test('volo col testo al 150%: la copia in volo finisce sulla carta', async ({ app, shell, avvisi }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(1280, 760));
  let page = await home(app);
  await page.evaluate(async () => {
    const r = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...((r && r.settings) || {}), textScale: 1.5 } });
  });
  await page.reload();
  page = await home(app);
  await page.evaluate(() => {
    window.__ultimo = null;
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('dash-carta-in-volo')) {
      const t = () => { if (!n.isConnected) return; const b = n.getBoundingClientRect(); window.__ultimo = [b.left, b.top, b.width]; requestAnimationFrame(t); };
      t();
    } }).observe(document.body, { childList: true });
  });
  await shell.evaluate(() => window.filoNotify('Il portachiavi di sistema non risponde', { durationSec: 0, actions: [{ label: 'Capito', onClick() {} }] }));
  await expect((await avvisi()).locator('.shell-notif.show')).toHaveCount(1);
  await expect(page.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(1, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  const v = await page.evaluate(() => { const b = document.querySelector('#accade > .dash-carta[data-tipo="cornice"]').getBoundingClientRect(); return { ultimo: window.__ultimo, carta: [b.left, b.top, b.width] }; });
  console.log('VOLO', JSON.stringify(v));
  expect(v.ultimo).not.toBeNull();
  expect(Math.abs(v.ultimo[0] - v.carta[0])).toBeLessThan(4);
  expect(Math.abs(v.ultimo[1] - v.carta[1])).toBeLessThan(4);
  expect(Math.abs(v.ultimo[2] - v.carta[2])).toBeLessThan(4);
});
