import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';

test('aspetto di bilanci e tetto', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await apriScheda(page, 'automation');
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_caps_get') return { ok: true, cap3: 3, cap2: 1, cap1: 0, tettoVerifiche: 6, fixInstructions: '' };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadCaps());
  await expect(page.locator('#mgTettoVerifiche')).toHaveValue('6');
  await page.locator('#mgTettoVerificheBlock').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/giro9-bilanci-chiaro.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: 'tests/.shots/giro9-bilanci-scuro.png' });
  const info = await page.evaluate(() => {
    const t = document.getElementById('mgTettoVerificheBlock');
    const c = document.getElementById('mgCap1Block');
    return { tetto: t.outerHTML.slice(0, 1500), cap1: c.outerHTML.slice(0, 1500) };
  });
  console.log(JSON.stringify(info, null, 1));
});
