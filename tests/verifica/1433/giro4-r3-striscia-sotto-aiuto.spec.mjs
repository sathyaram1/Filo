// Verifica #1433, giro 4, rilievo 3: con l'Aiuto aperto la striscia del pannello resta raggiungibile, e un clic lì
// apre il pannello.

import { test, expect } from '../../fixtures/electron.mjs';

test('r3 Aiuto aperto, pannello chiuso: un clic sulla striscia apre il pannello', async ({ app, openTab }) => {
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1' && typeof window.SN_SIDEBAR?.open === 'function');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await ed.waitForTimeout(600);
  const s = await ed.locator('.pd-striscia').boundingBox();
  await ed.mouse.click(s.x + s.width / 2, 400);
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto')), { timeout: 3000 }).toBe(true);
});
