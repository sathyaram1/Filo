// DEBUG TEMPORANEO della verifica (da cancellare).
import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const GIORNO = 24 * 60 * 60 * 1000;

test('debug stub get', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  const diag = await page.evaluate(async (GIORNO) => {
    const out = {};
    out.canAssign = (() => { try { const o = window.filo.message; window.filo.message = o; return true; } catch (e) { return 'no: ' + e.message; } })();
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'merge_approvals_get') {
        return { ok: true, pending: [{ id: 'aa'.repeat(12), branch: 'claude/x', sha: 'ab'.repeat(20), who: 'a@b.c', blocks: [], createdAtMs: Date.now(), expiresAtMs: Date.now() + 7 * GIORNO }], failed: [], recent: [], ttlMs: 7 * GIORNO };
      }
      return orig(msg);
    };
    out.stubbed = window.filo.message !== orig;
    window.__mgTest.setAdmin(true);
    out.n = await window.__mgTest.loadMergeApprovals();
    const host = document.getElementById('mgMergeApprovals');
    out.hidden = host ? host.hidden : 'no-host';
    out.html = host ? host.innerHTML.slice(0, 300) : '';
    const direct = await window.filo.message({ type: 'merge_approvals_get' });
    out.direct = JSON.stringify(direct).slice(0, 200);
    return out;
  }, GIORNO);
  console.log('DIAG', JSON.stringify(diag, null, 2));
  expect(diag.n).toBeGreaterThan(0);
});
