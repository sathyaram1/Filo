import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';

for (const tema of ['light', 'dark']) {
  test(`aspetto dei tre bilanci, tema ${tema}`, async ({ openTab }) => {
    const page = await openTab(URL);
    await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
    await page.emulateMedia({ colorScheme: tema });
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
    await apriScheda(page, 'automation');
    await page.evaluate(() => {
      const orig = window.filo.message.bind(window.filo);
      window.__sets = [];
      window.filo.message = async (msg) => {
        if (msg && msg.type === 'automation_caps_get') return { ok: true, cap3: 3, cap2: 1, cap1: 0, fixInstructions: '', giroStretto: false };
        if (msg && msg.type === 'automation_caps_set') { window.__sets.push(msg); return { ok: true, ...msg }; }
        return orig(msg);
      };
    });
    await page.evaluate(() => window.__mgTest.setAdmin(true));
    await page.evaluate(() => window.__mgTest.loadCaps());
    await expect(page.locator('#mgCap2')).toHaveValue('1');
    await expect(page.locator('#mgCap0')).toHaveCount(0);
    await page.locator('#mgCap3Block').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `tests/.shots/2339-bilanci-${tema}.png` });
    await page.locator('#mgCap2').fill('2');
    await page.locator('#mgCap2Save').click();
    await page.waitForTimeout(500);
    console.log('SETS', JSON.stringify(await page.evaluate(() => window.__sets)));
  });
}
