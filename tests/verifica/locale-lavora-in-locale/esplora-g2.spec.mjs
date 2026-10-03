import { test, expect } from '../../fixtures/electron.mjs';
const MANAGE = 'filo://manage/manage.html';
const FEEDBACK = 'filo://feedback/feedback.html';
const SEGNO = { by: 'owner@esempio', at: 1790000000000 };
function fb(over = {}) {
  return Object.assign({ _id: 'u-1', name: 'Serve un lavoro sul terminale', text: 'Il terminale non parte.', seq: 950, subSeq: 0,
    status: 'unlabeled', statusPublic: 'open', clientId: 'utente-abc', createdAt: '2026-10-01T07:00:00Z', images: [] }, over);
}
async function stub(page) {
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') { window.__updates.push(msg); await new Promise((r) => setTimeout(r, 400)); return msg.localOnly ? { ok: true, by: 'owner@esempio', at: 1790000000000 } : { ok: true }; }
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
}
async function apri(page, lista, tab) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stub(page);
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}
test('doppio clic veloce su Lavoro locale', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()], 'inbox');
  await page.locator('.mg-item').click();
  const b = page.locator('#mgActionsRow button', { hasText: 'Lavoro locale' });
  await b.dblclick();
  await page.waitForTimeout(1500);
  console.log('UPDATES', JSON.stringify(await page.evaluate(() => window.__updates)));
  console.log('TABS', await page.locator('.mg-tab').allInnerTexts());
});
test('approvato nei Lavori locali: dettaglio e menu', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ status: 'todo', localOnly: SEGNO, localApproval: SEGNO, statusReason: 'locale' })], 'local');
  await page.locator('.mg-item').click();
  await page.waitForTimeout(500);
  console.log('ITEM', await page.locator('.mg-item').innerText());
  console.log('ACTIONS', await page.locator('#mgActionsRow').innerText());
  console.log('LOCALBTN', await page.locator('#mgLocalBtn').isVisible(), await page.locator('#mgLocalBtn').getAttribute('title'));
  const det = await page.locator('#mgDetail').innerText();
  console.log('DETAIL', det.slice(0, 1500));
  await page.screenshot({ path: 'tests/.shots/g2-locale-dettaglio.png' });
  await page.locator('.mg-item').click({ button: 'right' });
  const voci = page.locator('.mg-ctxmenu .sn-select-option');
  for (const v of await voci.all()) console.log('VOCE', await v.innerText(), '|', await v.getAttribute('title'));
});
test('approvato, rimesso alle routine: in coda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ status: 'todo', localApproval: SEGNO })], 'queue');
  await page.locator('.mg-item').click();
  await page.waitForTimeout(500);
  console.log('Q ACTIONS', await page.locator('#mgActionsRow').innerText());
  console.log('Q LOCALBTN', await page.locator('#mgLocalBtn').isVisible(), await page.locator('#mgLocalBtn').getAttribute('title'));
  console.log('Q ITEM', await page.locator('.mg-item').innerText());
});
test('approvato e risolto: in Risolti', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ status: 'done', statusPublic: 'closed', localOnly: SEGNO, localApproval: SEGNO, resolvedInVersion: '0.0.1' })], 'resolved');
  console.log('TABS', await page.locator('.mg-tab').allInnerTexts());
  await page.locator('.mg-item').first().click();
  await page.waitForTimeout(500);
  console.log('R ACTIONS', await page.locator('#mgActionsRow').innerText());
  console.log('R LOCALBTN', await page.locator('#mgLocalBtn').isVisible(), await page.locator('#mgLocalBtn').getAttribute('title'));
});
