import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';

for (const tema of ['light', 'dark']) {
  test(`Automazioni: tre bilanci, salvati (${tema})`, async ({ app, openTab }) => {
    const page = await openTab(URL);
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs).setSize(1536, 864); });
    await page.waitForFunction(() => window.__mgTest && window.filo);
    await page.evaluate(() => window.__mgTest.whenReady());
    await page.evaluate(() => {
      window.__inviati = [];
      const orig = window.filo.message.bind(window.filo);
      const doc = { cap3: 3, cap2: 1, cap1: 0 };
      window.filo.message = async (msg) => {
        const t = msg && msg.type;
        if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
        if (t === 'automation_get') return { ok: true, enabled: true, routinesEnabled: true, autoApprove: {} };
        if (t === 'automation_caps_get') return { ok: true, ...doc, fixInstructions: '', giroStretto: false };
        if (t === 'automation_caps_set') { window.__inviati.push(msg); Object.assign(doc, msg); delete doc.type; return { ok: true, ...doc, fixInstructions: '', giroStretto: false }; }
        if (t === 'automation_sessions_get') return { ok: true, letto: true, maxSessions: 2, priorityAccount: '', accountAOff: false, accountBOff: false };
        if (/^(support_models_get|merge_approvals_get)/.test(t || '')) return { ok: false, error: 'riservato' };
        return orig(msg);
      };
    });
    await page.evaluate(() => window.__mgTest.setAdmin(true));
    await page.evaluate(() => window.__mgTest.setData([]));
    await page.evaluate(() => window.__mgTest.loadCaps());
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, tema);
    await apriScheda(page, 'automation');
    await expect(page.locator('#mgCap3')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#mgCap0, #mgCap0Block')).toHaveCount(0);
    await expect(page.locator('#mgCap2')).toHaveValue('1');
    await expect(page.locator('#mgCap1')).toHaveValue('0');
    await page.locator('#mgCap2').fill('2');
    await page.locator('#mgCap2Save').click();
    await expect(page.locator('#mgCap2Msg')).toHaveText('Salvato.');
    const inviati = await page.evaluate(() => window.__inviati);
    expect(inviati.map((m) => Object.keys(m).sort().join(','))).toEqual(['cap2,type']);
    await page.locator('#mgCap3Block').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `tests/.shots/2339-bilanci-${tema}.png` });
  });
}
