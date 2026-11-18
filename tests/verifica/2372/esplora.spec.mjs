// Esplorazione del giro 1 (da cancellare).
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { homeIntera } from '../../helpers/tastiHome.mjs';

async function casa(app) {
  await homeIntera(app);
  const page = await home(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#altroPiu')).toBeVisible({ timeout: 10_000 });
  return page;
}
const aperte = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return w._filoTabs.tabs.filter((t) => { try { return t.view.webContents.getURL().startsWith(u); } catch (_) { return false; } }).length;
}, url);
const info = (page) => page.evaluate(() => ({ val: document.getElementById('input').value, att: document.activeElement && (document.activeElement.id || document.activeElement.tagName) }));

for (const caso of ['diretto', 'dopo-clic', 'dopo-fill', 'dopo-fill-clic']) {
  test(`yy ${caso}`, async ({ app, testServer }) => {
    const url = testServer.html('<title>Video</title><h1>video</h1>');
    await app.evaluate((_, u) => globalThis.SN_STORAGE.updateSettings({ doppioTocco: { lettere: [{ lettera: 'y', url: u }] } }), url);
    const page = await casa(app);
    if (caso.startsWith('dopo-fill')) { await page.keyboard.type('yo', { delay: 30 }); await page.locator('#input').fill(''); }
    if (caso.endsWith('clic')) await page.mouse.click(640, 300);
    console.log(caso, 'prima', JSON.stringify(await info(page)));
    console.log(caso, 'cfg', JSON.stringify(await page.evaluate(async () => {
      const s = await self.SN_STORAGE.getSettings();
      return { raw: s.doppioTocco, norm: self.SN_DOPPIO_TOCCO.normalizza(s.doppioTocco) };
    })));
    await page.evaluate(() => { window.__tasti = []; document.addEventListener('keydown', (e) => window.__tasti.push([e.key, e.repeat, Math.round(e.timeStamp), e.isTrusted, e.defaultPrevented]), true); });
    await page.keyboard.type('yy', { delay: 40 });
    await page.waitForTimeout(800);
    console.log(caso, 'dopo', JSON.stringify(await info(page)), 'aperte', await aperte(app, url), JSON.stringify(await page.evaluate(() => window.__tasti)));
  });
}
