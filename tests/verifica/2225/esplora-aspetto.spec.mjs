import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ openTab }) => {
    const page = await openTab('filo://manage/manage.html');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
    await page.emulateMedia({ colorScheme: tema });
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
    await apriScheda(page, 'automation');
    await page.evaluate(() => {
      const RS = window.SN_ROUTINE_SESSIONI;
      const orig = window.filo.message.bind(window.filo);
      window.filo.message = async (msg) => {
        if (msg && msg.type === 'automation_sessions_get') return Object.assign({ ok: true }, RS.leggiDoc({ unitWindows: 'toccati' }));
        return orig(msg);
      };
    });
    await page.evaluate(() => window.__mgTest.setAdmin(true));
    await page.evaluate(() => window.__mgTest.loadSessions());
    const blocco = page.locator('#mgUnitWindowsBlock');
    await blocco.scrollIntoViewIfNeeded();
    await expect(page.locator('input[name="mgUnitWindows"][value="toccati"]')).toBeChecked();
    await page.locator('.mg-auto-choice-item').filter({ has: page.locator('input[value="tutti"]') }).hover();
    await page.screenshot({ path: `tests/.shots/2225-${tema}.png` });
    await page.locator('.mg-auto-choice-item').filter({ has: page.locator('input[value="tutti"]') }).click({ button: 'right' });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `tests/.shots/2225-${tema}-destro.png` });
  });
}
