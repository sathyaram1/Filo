// Verifica #1839 giro 1, rilievo 1: approvata dal riquadro, mentre il server fonde il quadrato Fusione del
// dettaglio resta rosso «bloccato», mentre lista e pannello dicono già «in fusione».

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const ORA = Date.now();

test('r1 durante la fusione il quadrato del dettaglio non resta rosso: dice quello che dicono lista e pannello', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  const req = {
    id: 'r-f-pend', feedbackId: 'f-pend', num: '#100', branch: 'worker/f-pend', sha: 'abcdef1234567',
    origin: 'routine', who: 'secaudit · slug', createdAtMs: ORA - 60000, expiresAtMs: ORA + 6 * 86400000,
    blocks: [{ rule: 'tocca le regole', file: 'firestore.rules' }],
  };
  await page.evaluate((req) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [req], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      // Il server sta ancora fondendo.
      if (t === 'merge_approval_approve') return new Promise(() => {});
      return orig(msg);
    };
  }, req);
  await page.evaluate(() => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([{
      _id: 'f-pend', name: 'Pratica 100', text: 'Testo.', seq: 100, subSeq: 0, status: 'design', statusReason: 'l5',
      statusPublic: 'open', clientId: 'owner:test', createdAt: new Date().toISOString(), images: [], branch: 'worker/f-pend',
    }]);
  });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.evaluate(() => window.__mgTest.openDetail('f-pend'));

  const quadrato = page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]');
  await expect(quadrato).toHaveClass(/mg-forma--attack/);
  await quadrato.click();
  const card = page.locator('#mgSideBody .sn-mac-card').first();
  await card.locator('.sn-mac-btn-go').click();
  await card.locator('.sn-mac-btn-go').click({ delay: 50 });
  await expect(card).toHaveClass(/is-merging/);

  // Lista e pannello dicono già «in fusione».
  await expect(page.locator('.mg-item').filter({ hasText: '#100' }).first()).toContainText('in fusione');
  await expect(page.locator('#mgSideBody')).toContainText('il server sta fondendo');
  // Il quadrato in cima deve dirlo anche lui, senza il rosso di «bloccato».
  await expect(quadrato).not.toHaveClass(/mg-forma--attack/, { timeout: 5000 });
});
