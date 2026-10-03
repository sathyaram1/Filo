import { test, expect } from '../../fixtures/electron.mjs';
const MANAGE = 'filo://manage/manage.html';
const FEEDBACK = 'filo://feedback/feedback.html';
function fb(over = {}) {
  return Object.assign({ _id: 'u-1', name: 'Serve un lavoro sul terminale', text: 'Il terminale non parte.', seq: 950, subSeq: 0, status: 'unlabeled', statusPublic: 'open', clientId: 'utente-abc', createdAt: '2026-10-01T07:00:00Z', images: [] }, over);
}
async function stubMain(page, fail) {
  await page.evaluate((fail) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') { window.__updates.push(msg); await new Promise((r) => setTimeout(r, 300)); return fail ? { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' } : { ok: true, by: 'owner@esempio', at: 1790000000000 }; }
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  }, fail);
}
const tabBtn = (page, tab) => page.locator(`.mg-tab[data-tab="${tab}"]`);
async function apri(page, lista, fail, tab = 'inbox') {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubMain(page, fail);
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}
test('manage: tasto, scrittura rifiutata', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()], true);
  await page.locator('.mg-item').click();
  await page.locator('#mgActionsRow button', { hasText: 'Lavoro locale' }).click();
  await page.waitForTimeout(1000);
  console.log('TASTO', await tabBtn(page, 'inbox').textContent(), await tabBtn(page, 'local').textContent(), await page.locator('body').innerText().then(t => t.includes('Sessione scaduta')));
});
test('manage: menu, scrittura rifiutata', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()], true);
  await page.locator('.mg-item').click({ button: 'right' });
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Approva come lavoro locale' }).click();
  await page.waitForTimeout(1000);
  console.log('MENU', await tabBtn(page, 'inbox').textContent(), await tabBtn(page, 'local').textContent(), await page.locator('body').innerText().then(t => t.includes('Sessione scaduta')));
});
test('feedback: tasto, scrittura rifiutata', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW && window.filo);
  await stubMain(page, true);
  await page.evaluate((items) => { window.__fbTest.setAdmin(true); window.__fbTest.setData(items); }, [fb()]);
  await page.evaluate(() => window.__fbTest.setTab('inbox'));
  await page.locator('.fb-act[data-local="1"]').click();
  await page.waitForTimeout(1200);
  console.log('TWIN', await page.locator('#tabs [data-tab="inbox"]').textContent(), await page.locator('#tabs [data-tab="local"]').textContent(), await page.locator('body').innerText().then(t => t.includes('Sessione scaduta')));
});
test('manage: sotto-feedback e titolo con HTML', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ subSeq: 2, name: '<img src=x onerror="window.__xss=1"> terminale', text: '<b>grassetto</b> ' + 'a'.repeat(20000) })], false);
  await page.locator('.mg-item').click();
  await page.locator('#mgActionsRow button', { hasText: 'Lavoro locale' }).click();
  await page.waitForTimeout(1200);
  console.log('SUB', await tabBtn(page, 'local').textContent(), await page.evaluate(() => window.__xss), await page.locator('body').innerText().then(t => (t.match(/#950\.2[^\n]*/) || [''])[0]));
  await tabBtn(page, 'local').click();
  await page.locator('.mg-item').click();
  await page.waitForTimeout(500);
  console.log('SUBDETAIL', (await page.locator('#mgDetail').innerText()).slice(0, 400).replace(/\n/g, ' | '));
  await page.screenshot({ path: 'C:/Users/AGENTI~1/AppData/Local/Temp/claude/C--Users-agenti-AI-Desktop-Filo-Filo/719c2395-0225-45f7-a9be-6a87b48a8913/scratchpad/g3/local-detail.png' });
});
