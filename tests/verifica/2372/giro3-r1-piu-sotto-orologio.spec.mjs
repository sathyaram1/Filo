// #2372 giro 3, rilievo 1: il «+» è la strada di ritorno garantita, ma su uno schermo da portatile (1366x768) con le
// carte di destra di chi ha i Mazzi finisce sotto l'orologio o oltre il bordo, e si vede solo scorrendo la colonna.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { homeIntera } from '../../helpers/tastiHome.mjs';

test('r1 su una finestra da portatile il «+» si vede senza scorrere la colonna', async ({ app }) => {
  await homeIntera(app);
  const page = await home(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#altroPiu')).toBeAttached({ timeout: 10_000 });
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((b) => b._filoTabs).setSize(1366, 728); });
  await page.waitForTimeout(800);
  // Il punto al centro del «+» deve essere il «+», non l'orologio sopra di lui né fuori dalla finestra.
  const visto = await page.evaluate(() => {
    const p = document.getElementById('altroPiu');
    const r = p.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (y > innerHeight || x > innerWidth) return 'fuori dalla finestra';
    const n = document.elementFromPoint(x, y);
    return n && p.contains(n) ? 'si vede' : `coperto da ${n && (n.id || n.className)}`;
  });
  expect(visto).toBe('si vede');
});
