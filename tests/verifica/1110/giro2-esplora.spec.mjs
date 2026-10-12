// #1110, giro 2: la pagina unica Automazioni + Modelli di supporto vista a più larghezze, da owner e da ospite,
// e il salvataggio dei modelli fatto dalla pagina nuova.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const MODELLI = {
  sanitizer: 'flash', judge1: 'flash, flash-or', judge2: 'flash', judge3: 'flash',
  judgeDynamic: 'flash', judgeRedTeam: 'flash', judgePriority: 'flash', manageSearch: 'flash',
  judgeRegistry: { flash: { model: 'deepseek/deepseek-v4-flash' }, 'flash-or': { model: 'deepseek/deepseek-v4-pro' } },
  openrouterKeyPresent: true, judgeTimeoutMs: 60000,
};

async function apri(app, openTab, { admin = true, size = [1536, 864] } = {}) {
  const page = await openTab(URL);
  await app.evaluate(({ BrowserWindow }, s) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs).setSize(s[0], s[1]); }, size);
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    const orig = window.filo.message.bind(window.filo);
    window.__inviati = [];
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: cfg.admin, isAdmin: cfg.admin, profile: null };
      if (!cfg.admin && /^(support_models_|merge_approvals_get|automation_)/.test(t || '')) return { ok: false, error: 'riservato' };
      if (t === 'support_models_get') return { ok: true, models: cfg.modelli };
      if (t === 'support_models_update') { window.__inviati.push(msg); return { ok: true, models: { ...cfg.modelli, ...msg.models } }; }
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 7 * 864e5 };
      if (t === 'automation_get') return { ok: true, enabled: true, routinesEnabled: true, autoApprove: {}, proberWhenIdle: true };
      if (t === 'automation_caps_get') return { ok: true, cap3: 3, cap2: 2, cap1: 1, cap0: 0, fixInstructions: '', giroStretto: true };
      if (t === 'automation_sessions_get') return { ok: true, letto: true, maxSessions: 4, priorityAccount: '', accountAOff: false, accountBOff: false };
      return orig(msg);
    };
  }, { admin, modelli: MODELLI });
  await page.evaluate((a) => window.__mgTest.setAdmin(a), admin);
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.evaluate(() => Promise.all([window.__mgTest.loadMergeApprovals(), window.__mgTest.loadSessions()]));
  await page.locator('.mg-tab[data-tab="automation"]').click();
  return page;
}

for (const size of [[1920, 1080], [1536, 864], [1229, 700]]) {
  test(`aspetto a ${size[0]}x${size[1]}, chiaro e scuro`, async ({ app, openTab }) => {
    const page = await apri(app, openTab, { size });
    await expect(page.locator('#mgSmEditor')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);
    const sbordo = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(sbordo).toBe(false);
    await page.screenshot({ path: `tests/.shots/v1110-${size[0]}.png` });
    await page.screenshot({ path: `tests/.shots/v1110-${size[0]}-full.png`, fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: `tests/.shots/v1110-${size[0]}-scuro.png` });
  });
}

test('i modelli si salvano dalla pagina unica', async ({ app, openTab }) => {
  const page = await apri(app, openTab);
  await expect(page.locator('#mgSmEditor')).toBeVisible({ timeout: 5000 });
  await page.locator('#mgSmKeyOpenrouter').fill('sk-or-v1-prova');
  await page.locator('#mgSmSaveBtn').scrollIntoViewIfNeeded();
  await page.locator('#mgSmSaveBtn').click();
  await expect.poll(() => page.evaluate(() => window.__inviati.length)).toBe(1);
  const m = await page.evaluate(() => window.__inviati[0]);
  expect(m.openrouterKey).toBe('sk-or-v1-prova');
  expect(m.models.judge1).toContain('flash');
  await page.screenshot({ path: 'tests/.shots/v1110-salvato.png' });
});

test('da ospite la pagina unica dice che è riservata, senza mezze sezioni', async ({ app, openTab }) => {
  const page = await apri(app, openTab, { admin: false });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/v1110-ospite.png', fullPage: true });
  await expect(page.locator('#mgSmLoading')).toBeHidden();
});
