// Verifica #667.5 giro 1: in Automazioni il tasto «Approva e fondi» armato tiene la scatola a ogni larghezza del riquadro, anche quando va a capo.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const GIORNO = 24 * 60 * 60 * 1000;

function richiesta() {
  return {
    id: 'ab12cd34ef56ab12cd34ef56', branch: 'claude/approvazione-fusioni', sha: 'a1b2c3d4'.repeat(5), who: 'owner@esempio',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 120_000, expiresAtMs: Date.now() + GIORNO, expired: false, used: false, discarded: false,
  };
}

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((pending) => {
    window.__macCalls = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending, failed: [], recent: [], ttlMs: 7 * 86400000 };
      if (t === 'merge_approval_approve') { window.__macCalls.push({ op: 'approve', id: msg.id }); return { ok: true, result: 'merged', sha: 'deadbeefcafe' }; }
      return orig(msg);
    };
  }, [richiesta()]);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.locator('.mg-tab[data-tab="automation"]').click();
}

test('a ogni larghezza del riquadro, Confermi? sta nella scatola di Approva e il secondo clic nello stesso punto fonde', async ({ openTab }) => {
  test.setTimeout(240_000);
  const page = await openTab(MANAGE);
  for (const larga of [1000, 560, 320, 240, 180, 150, 130, 110]) {
    if (larga !== 1000) await page.reload({ waitUntil: 'load' });
    await apri(page);
    const go = page.locator('#mgMergeApprovalsOrphans .sn-mac-btn-go');
    await expect(go).toBeVisible({ timeout: 8000 });
    // La finestra di prova non si ridimensiona: si stringe il riquadro delle fusioni.
    await page.evaluate((w) => { document.querySelector('#mgMergeApprovalsOrphans').style.width = w + 'px'; }, larga);
    await go.scrollIntoViewIfNeeded();
    const prima = await go.boundingBox();
    const punto = { x: prima.x + prima.width / 2, y: prima.y + prima.height - 3 };
    await page.mouse.click(punto.x, punto.y);
    await expect(go).toHaveText('Confermi?');
    const armato = await go.boundingBox();
    for (const k of ['x', 'y', 'width', 'height']) expect(Math.abs(armato[k] - prima[k]), `larga ${larga}: ${k}`).toBeLessThan(0.5);
    await page.waitForTimeout(600);
    await page.mouse.click(punto.x, punto.y);
    await expect(page.locator('#mgMergeApprovalsOrphans .sn-mac-status')).toContainText(/su main/i, { timeout: 8000 });
    expect(await page.evaluate(() => window.__macCalls), `larga ${larga}`).toEqual([{ op: 'approve', id: 'ab12cd34ef56ab12cd34ef56' }]);
    await page.screenshot({ path: `tests/.shots/v667-5-${larga}.png` }).catch(() => {});
  }
});
