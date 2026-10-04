// #550 giro 1, rilievo 2: un doppio clic su «Approva e fondi» non deve fondere in un
// gesto solo; un clic voluto dopo, sì (stessa guardia del cestino dell'editor, #415).

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);
const GIORNO = 24 * 60 * 60 * 1000;

const FB = {
  _id: 'fb-550', text: 'Il menu perde le voci.', name: 'Menu', seq: 700, subSeq: 0,
  status: 'revision_security', clientId: 'tester@example.com', createdAt: '2026-09-10T10:00:00Z', images: [],
  pipeline: { action: 'human_review', l1Category: 'clean', verdicts: [], stage: 'L2' },
};

function richiesta(over = {}) {
  return Object.assign({
    id: 'ab12cd34ef56ab12cd34ef56', branch: 'claude/allegati', sha: SHA, who: 'owner@esempio',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 60_000, expiresAtMs: Date.now() + GIORNO,
    expired: false, used: false, discarded: false,
  }, over);
}

async function apri(page, feedbacks, pending, approveReply) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__chiamate = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: cfg.pending, failed: [], recent: [], preapproved: [], ttlMs: 7 * cfg.GIORNO };
      if (t === 'merge_approval_approve') { window.__chiamate.push('approve'); await new Promise((r) => setTimeout(r, 300)); return cfg.approveReply || { ok: true, result: 'merged', sha: 'deadbeefcafe' }; }
      if (t === 'merge_approval_discard') { window.__chiamate.push('discard'); return { ok: true, result: 'discarded' }; }
      return orig(msg);
    };
  }, { pending, approveReply, GIORNO });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), feedbacks);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

async function sotto(page, x, y) {
  return page.evaluate(([px, py]) => {
    const e = document.elementFromPoint(px, py);
    const b = e && e.closest('button');
    return b ? b.className : (e ? e.tagName : null);
  }, [x, y]);
}


test('doppio clic su Approva e fondi: arma soltanto, e un clic voluto dopo fonde', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [FB], [richiesta({ num: '#700', origin: 'routine' })]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), FB._id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const go = page.locator('#mgSideBody .sn-mac-btn-go');
  await expect(go).toBeVisible({ timeout: 8_000 });
  await go.dblclick();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__chiamate)).toEqual([]);
  await expect(go).toHaveText('Confermi?');
  await go.click();
  await expect.poll(() => page.evaluate(() => window.__chiamate)).toEqual(['approve']);
});
