// Giro 2 (#957): tolte le vie da riga di comando, le tre decisioni restano all'owner in Gestione e funzionano.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function fb(over = {}) {
  return Object.assign({
    _id: 'u-957', name: 'Una richiesta di un utente', text: 'Testo di un utente.',
    seq: 957, subSeq: 0, status: 'design', statusReason: 'locale', statusPublic: 'open',
    clientId: 'utente-xyz', createdAt: '2026-10-04T07:00:00Z', images: [],
  }, over);
}

async function apri(page, lista, tab = 'inbox') {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') { window.__updates.push(msg); return { ok: true, by: 'owner@esempio' }; }
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}

test('Ricevuti: «💻 Lavoro locale» su un feedback di un utente lo approva e lo porta nei Lavori locali', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()]);
  await page.locator('.mg-item').click();
  await page.locator('#mgAcceptLocalBtn').click();
  await expect(page.locator('.mg-tab[data-tab="local"]')).toHaveText('Lavori locali (1)');
  const u = await page.evaluate(() => window.__updates);
  expect(u).toHaveLength(1);
  expect(u[0].localApproval).toBe(true);
  expect(u[0].localOnly).toBe(true);
});

test('In coda: «Fondi senza chiedermelo» su un feedback di un utente lo mette l’owner da Gestione', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ status: 'todo', statusReason: '' })], 'queue');
  await page.locator('.mg-item').click();
  const btn = page.locator('#mgPreapproveBtn');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const u = await page.evaluate(() => window.__updates);
  expect(u[0]).toMatchObject({ type: 'feedback_update', id: 'u-957', mergePreapproved: true });
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
});

test('«🙋 È mio» su un mittente di sessione senza prova dà la prova del mittente', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ clientId: 'local:claude', status: 'aligned', statusReason: '' })]);
  await page.locator('.mg-item').click();
  const btn = page.locator('#mgSenderBtn');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const u = await page.evaluate(() => window.__updates);
  expect(u[0]).toMatchObject({ type: 'feedback_update', id: 'u-957', senderProof: 'admin' });
});
