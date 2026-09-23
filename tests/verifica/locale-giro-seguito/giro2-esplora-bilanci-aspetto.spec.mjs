// Esplorazione del giro 2 (si cancella): il campo del bilancio dei 3 in
// Gestione → Automazioni, fotografato nei due temi.

import { test, expect } from '../../fixtures/electron.mjs';

test('i bilanci in Automazioni, tema chiaro e scuro', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_caps_get') return { ok: true, cap3: 5, cap2: 4, cap1: 1, cap0: 0, fixInstructions: '' };
      if (msg && msg.type === 'automation_caps_set') return { ok: true, cap3: 3, cap2: 4, cap1: 1, cap0: 0, fixInstructions: '' };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadCaps());
  await expect(page.locator('#mgCap3')).toHaveValue('5');
  await page.locator('#mgCap3').fill('3');
  await page.locator('#mgCap3Save').click();
  await expect(page.locator('#mgCap3Msg')).toHaveText('Salvato.');
  await page.locator('#mgCap3Block').scrollIntoViewIfNeeded();
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(300);
    const box = await page.locator('#mgCap3Block').boundingBox();
    await page.screenshot({ path: `tests/.shots/giro2-bilanci-${tema}.png`, clip: { x: 0, y: Math.max(0, box.y - 20), width: 1100, height: 620 } });
  }
});
