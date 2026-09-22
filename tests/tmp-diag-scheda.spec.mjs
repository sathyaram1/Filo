import { test } from './fixtures/electron.mjs';

test('diagnosi: chi deborda nella scheda', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  const fb = {
    _id: 'fb-diag', name: 'Le regole del database lasciano leggere i segreti',
    text: 'x', seq: 701, subSeq: 0, status: 'working', statusPublic: 'open',
    clientId: 't@e', createdAt: '2026-09-20T08:00:00Z', images: [],
    mergePreapproved: { by: 'owner@esempio', at: '2026-09-20T09:00:00.000Z' },
  };
  const req = {
    id: 'ab12cd34ef56ab12cd34ef56', branch: 'w/701', sha: 'a'.repeat(40), who: 'x',
    origin: 'routine', num: '#701', feedbackId: 'fb-diag', blocks: [],
    createdAtMs: Date.now(), expiresAtMs: Date.now() + 8.64e7,
    expired: false, used: false, discarded: false,
  };
  await page.evaluate((r) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (m) => {
      if (m?.type === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (m?.type === 'merge_approvals_get') return { ok: true, pending: [r], failed: [], recent: [], preapproved: [] };
      if (m?.type === 'merge_approval_approve') return { ok: false, error: 'diag' };
      return orig(m);
    };
  }, req);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((l) => window.__mgTest.setData(l), [fb]);
  await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(f, {})), fb);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.waitForTimeout(600);
  const dump = await page.evaluate(() => {
    const it = document.querySelector('.mg-item');
    const box = (e) => e ? { cls: e.className, w: Math.round(e.getBoundingClientRect().width), sw: e.scrollWidth, cw: e.clientWidth, dir: getComputedStyle(e).flexDirection, wrap: getComputedStyle(e).flexWrap, disp: getComputedStyle(e).display } : null;
    return {
      lista: box(document.querySelector('.mg-list')),
      item: box(it),
      figli: Array.from(it.children).map(box),
      riga: box(it.querySelector('.mg-item-row')),
      nipoti: Array.from((it.querySelector('.mg-item-row') || it).children).map(box),
    };
  });
  console.log(JSON.stringify(dump, null, 1));
});
