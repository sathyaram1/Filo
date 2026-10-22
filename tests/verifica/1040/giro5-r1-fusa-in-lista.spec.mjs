// Verifica #1040 giro 5, r1: una pratica «Approvata e fusa» nel quadrato non deve dire in lista che aspetta il via libera.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const RAMO = 'worker/fb-1040-fusa-20261004T120000Z';
const FB = {
  _id: 'fb-1040-fusa', text: 'Il menu non si apre.', name: 'Menu che non si apre',
  seq: 953, subSeq: 0, status: 'design', statusReason: 'l5', statusPublic: 'open', branch: RAMO,
  clientId: 'tester@example.com', createdAt: '2026-10-04T10:00:00Z', images: [],
};
const FUSA = {
  id: 'feedc0ffeefeedc0ffeefeed', branch: RAMO, sha: 'a'.repeat(40), feedbackId: FB._id, num: '953', who: 'routine',
  origin: 'routine', blocks: [], createdAtMs: Date.now() - 60000, expiresAtMs: Date.now() + 86400000,
  expired: false, used: true, discarded: false, outcome: 'merged', mergeSha: 'c'.repeat(40),
};

test('r1 approvata e fusa: il quadrato dice che è fusa, e la lista non la mette fra le fusioni che aspettano il via libera', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((fusa) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [fusa], preapproved: [], ttlMs: 7 * 86400000 };
      return orig(msg);
    };
  }, FUSA);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), [FB]);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate((id) => window.__mgTest.openDetail(id), FB._id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  await expect(page.locator('#mgSideBody')).toContainText('Approvata e fusa');

  const voce = page.locator(`.mg-item[data-id="${FB._id}"]`).first();
  await expect(voce).toBeVisible();
  const titoli = await voce.evaluate((el) => [el, ...el.querySelectorAll('[title]')].map((n) => n.getAttribute('title') || '').join(' | '));
  expect(titoli).not.toMatch(/aspetta il tuo via libera/i);
});
