// Esplorazione temporanea del giro 2 (#1110): da cancellare.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);
const MODELLI = {
  sanitizer: 'flash', judge1: 'flash', judge2: 'flash', judge3: 'flash',
  judgeDynamic: 'flash', judgeRedTeam: 'flash', judgePriority: 'flash', manageSearch: 'flash',
  judgeRegistry: { flash: { model: 'deepseek/deepseek-v4-flash' } }, openrouterKeyPresent: true, judgeTimeoutMs: 60000,
};
const fusa = (i, extra = {}) => ({
  id: String(i).padStart(24, 'a'), branch: `worker/lavoro-${i}`, sha: SHA, mergeSha: SHA, who: 'secaudit', origin: 'routine',
  num: `#${600 + i}`, feedbackId: `f${i}`, blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['a.mjs'], more: 0 }],
  createdAtMs: Date.now() - i * 3600e3, decidedAtMs: Date.now() - i * 3600e3, used: true, outcome: 'merged', ...extra,
});

async function apri(app, openTab, size) {
  const page = await openTab(URL);
  await app.evaluate(({ BrowserWindow }, s) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs).setSize(s[0], s[1]); }, size);
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'support_models_get') return { ok: true, models: cfg.modelli };
      if (t === 'merge_approvals_get') return { ok: true, pending: cfg.pending, failed: [], recent: cfg.recent, preapproved: cfg.recent, ttlMs: 7 * 864e5 };
      if (t === 'automation_get') return { ok: true, enabled: true, routinesEnabled: true, autoApprove: {}, proberWhenIdle: true };
      if (t === 'automation_sessions_get') return { ok: true, letto: true, maxSessions: 4, priorityAccount: '', accountAOff: false, accountBOff: false };
      return orig(msg);
    };
  }, { modelli: MODELLI, recent: Array.from({ length: 10 }, (_, i) => fusa(i)), pending: [fusa(99, { used: false, outcome: '', feedbackId: '', num: '' })] });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.evaluate(() => Promise.all([window.__mgTest.loadMergeApprovals(), window.__mgTest.loadSessions()]));
  return page;
}

for (const size of [[900, 800], [1920, 1080]]) {
  test(`guarda ${size[0]}`, async ({ app, openTab }) => {
    const page = await apri(app, openTab, size);
    await page.locator('.mg-tab[data-tab="automation"]').click();
    await expect(page.locator('#mgSmEditor')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/g2-auto-${size[0]}.png` });
    const sbordo = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    console.log('sbordo', size[0], sbordo);
    await page.locator('.mg-tab[data-tab="log"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/g2-log-${size[0]}.png` });
    await page.locator('.mg-tab[data-tab="stats"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/g2-rt-${size[0]}.png` });
    // Il ritorno alla scheda deve rimostrare l'editor, non rimetterlo in caricamento.
    await page.locator('.mg-tab[data-tab="automation"]').click();
    await expect(page.locator('#mgSmEditor')).toBeVisible();
  });
}
