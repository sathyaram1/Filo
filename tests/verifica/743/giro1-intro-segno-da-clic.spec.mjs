// Verifica #743 giro 1: in Automazioni l'introduzione delle «Fuse senza chiedere» non attribuisce
// al «fondi senza chiedermelo» una fusione nata dal segno di un clic Approva.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function fusa(over = {}) {
  return Object.assign({
    id: 'ab12cd34ef56ab12cd34ef56', branch: 'worker/prova-743', sha: 'a1b2c3d4'.repeat(5),
    mergeSha: 'feedface'.repeat(5), who: 'owner@esempio', origin: 'routine', num: '#743', feedbackId: 'fb-743',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 60 * 60 * 1000, decidedAtMs: Date.now() - 60 * 60 * 1000,
    used: true, outcome: 'merged',
    preapprovedBy: 'owner@esempio · approvazione 0123456789abcdef01234567',
    preapprovedAt: '2026-09-20T10:00:00Z',
  }, over);
}

async function apri(page, preapproved) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((lista) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') {
        return { ok: true, pending: [], failed: [], recent: [], preapproved: lista, ttlMs: 7 * 24 * 60 * 60 * 1000 };
      }
      return orig(msg);
    };
  }, preapproved);
  await page.evaluate(() => { window.__mgTest.setAdmin(true); window.__mgTest.setData([]); });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.locator('.mg-tab[data-tab="automation"]').click();
  const box = page.locator('#mgMergeApprovalsPreapproved');
  await expect(box).toBeVisible({ timeout: 8_000 });
  return box;
}

test('solo fusioni da clic Approva: l’introduzione parla del sì, non del «fondi senza chiedermelo»', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const box = await apri(page, [fusa()]);
  const intro = box.locator('.sn-mac-preapproved-intro');
  await expect(box).toContainText('pre-approvata dal tuo sì alla richiesta del');
  await expect(intro).not.toContainText('fondi senza chiedermelo');
  await expect(intro).toContainText('già approvato');
  await page.screenshot({ path: 'tests/.shots/verifica-743-da-clic.png' });
});

test('una a mano e una da clic: l’introduzione dice entrambe le cose, le righe ciascuna la sua', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const box = await apri(page, [
    fusa(),
    fusa({ id: 'cd34ef56ab12cd34ef56ab12', branch: 'worker/prova-a-mano', preapprovedBy: 'owner@esempio', num: '#744', feedbackId: 'fb-744' }),
  ]);
  const intro = box.locator('.sn-mac-preapproved-intro');
  await expect(intro).toContainText('fondi senza chiedermelo');
  await expect(intro).toContainText('già approvato');
  await expect(box.locator('.sn-mac-recent-who').nth(0)).toContainText('dal tuo sì');
  await expect(box.locator('.sn-mac-recent-who').nth(1)).toHaveText('pre-approvata da owner@esempio');
  await page.screenshot({ path: 'tests/.shots/verifica-743-misto.png' });
});
