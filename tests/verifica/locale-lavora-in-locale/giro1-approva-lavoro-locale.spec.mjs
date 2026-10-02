// Verifica locale, giro 1: l'owner approva come lavoro locale il feedback di un utente o di una routine dai Ricevuti.
// Dati finti, main simulato: si guarda cosa arriva al main e dove finisce la pratica.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const FEEDBACK = 'filo://feedback/feedback.html';

function fb(over = {}) {
  return Object.assign({
    _id: 'u-1', name: 'Serve un lavoro sul terminale', text: 'Il terminale non parte.',
    seq: 950, subSeq: 0, status: 'unlabeled', statusPublic: 'open',
    clientId: 'utente-abc', createdAt: '2026-10-01T07:00:00Z', images: [],
  }, over);
}

async function stubMain(page) {
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') {
        window.__updates.push(msg);
        return msg.localOnly ? { ok: true, by: 'owner@esempio', at: 1790000000000 } : { ok: true };
      }
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
}

async function apri(page, lista, tab = 'inbox') {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubMain(page);
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}

const tabBtn = (page, tab) => page.locator(`.mg-tab[data-tab="${tab}"]`);

for (const [nome, over] of [
  ['utente', {}],
  ['routine rimandata nei Ricevuti perché serve lavoro locale', { _id: 'r-1', clientId: 'routine:worker', senderProof: 'server', status: 'design', statusReason: 'locale' }],
]) {
  test(`Ricevuti, ${nome}: «Lavoro locale» lo porta nei Lavori locali col sì dell'owner`, async ({ openTab }) => {
    const page = await openTab(MANAGE);
    const pratica = fb(over);
    await apri(page, [pratica]);
    await expect(tabBtn(page, 'inbox')).toHaveText('Ricevuti (1)');
    await page.locator('.mg-item').click();
    const btn = page.locator('#mgActionsRow button', { hasText: 'Lavoro locale' });
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(tabBtn(page, 'local')).toHaveText('Lavori locali (1)');
    await expect(tabBtn(page, 'inbox')).toHaveText('Ricevuti (0)');
    const updates = await page.evaluate(() => window.__updates.filter((u) => u.status));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ id: pratica._id, status: 'todo', localOnly: true, localApproval: true, reviewDecision: 'accepted' });
    await tabBtn(page, 'local').click();
    await expect(page.locator('.mg-item')).toContainText('#950');
  });
}

test('tasto destro nei Ricevuti: «Approva come lavoro locale» fa la stessa scrittura del tasto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()]);
  await page.locator('.mg-item').click({ button: 'right' });
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Approva come lavoro locale' }).click();
  await expect(tabBtn(page, 'local')).toHaveText('Lavori locali (1)');
  const updates = await page.evaluate(() => window.__updates.filter((u) => u.status));
  expect(updates[0]).toMatchObject({ status: 'todo', localOnly: true, localApproval: true });
});

test('fuori dai Ricevuti, e senza admin, l’approvazione non c’è', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ status: 'todo' })], 'queue');
  await page.locator('.mg-item').click();
  await expect(page.locator('#mgActionsRow button', { hasText: 'Lavoro locale' })).toHaveCount(0);
  await expect(page.locator('#mgLocalBtn')).toBeHidden();
  await page.locator('.mg-item').click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toBeVisible();
  await expect(page.locator('.mg-ctxmenu')).not.toContainText('lavoro locale');
});

test('pagina gemella dei feedback: nei Ricevuti lo stesso tasto, con la stessa scrittura', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW && window.filo);
  await stubMain(page);
  await page.evaluate((items) => { window.__fbTest.setAdmin(true); window.__fbTest.setData(items); }, [fb()]);
  await page.evaluate(() => window.__fbTest.setTab('inbox'));
  const btn = page.locator('.fb-act[data-local="1"]');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator('#tabs [data-tab="local"]')).toHaveText('Lavori locali (1)');
  const updates = await page.evaluate(() => window.__updates.filter((u) => u.status));
  expect(updates[0]).toMatchObject({ status: 'todo', localOnly: true, localApproval: true });
});
