// #509 — giro 3, seconda tornata: le AZIONI offerte dentro «Archiviati».
//
// Il ticket parla di due pagine che chiamano le sezioni con gli stessi nomi e
// le riempiono con regole diverse. Qui si guarda un gradino più in dentro:
// preso lo STESSO feedback, nella STESSA sezione, le due pagine offrono la
// stessa azione?

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';
const VERSIONE = '1.0.0';

async function apriFeedback(openTab, items) {
  const page = await openTab(FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: true, profile: { email: 'o@e.com' } };
      if (msg && msg.type === 'automation_get') return { ok: true, enabled: false };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__fbTest.setAdmin(true, { email: 'o@e.com' }));
  await page.evaluate((v) => window.__fbTest.setReleasedVersion(v), VERSIONE);
  await page.evaluate((i) => window.__fbTest.setData(i), items);
  return page;
}

async function apriManage(openTab, items) {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: true, profile: { email: 'o@e.com' } };
      if (msg && msg.type === 'automation_get') return { ok: true, enabled: false };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((v) => window.__mgTest.setReleasedVersion(v), VERSIONE);
  await page.evaluate((i) => window.__mgTest.setData(i), items);
  return page;
}

const updates = (p) => p.evaluate(() => window.__updates.slice());

// Tutti in «Archiviati» su ENTRAMBE le pagine (verificato dal giro precedente).
const ARCHIVIATI = [
  { _id: 'z1', seq: 1, status: 'archived',         name: 'archiviato normale', text: '1', createdAt: '2026-08-01T10:00:00Z' },
  { _id: 'z2', seq: 2, status: 'attack_confirmed', name: 'attacco confermato', text: '2', createdAt: '2026-08-02T10:00:00Z' },
  { _id: 'z3', seq: 3, status: 'spam_confirmed',   name: 'spam confermato',    text: '3', createdAt: '2026-08-03T10:00:00Z' },
  { _id: 'z4', seq: 4, status: 'verified',         name: 'verificato (vecchio)', text: '4', createdAt: '2026-08-04T10:00:00Z' },
  { _id: 'z5', seq: 5, status: 'ignored',          name: 'ignorato (vecchio)',   text: '5', createdAt: '2026-08-05T10:00:00Z' },
];

test('#509/3b — in «Archiviati» le due pagine offrono la stessa azione su ogni segnalazione', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, ARCHIVIATI);
  const mg = await apriManage(openTab, ARCHIVIATI);

  await fb.locator('#tabs [data-tab="archived"]').click();
  await expect(fb.locator('.fb-card')).toHaveCount(5);
  await mg.evaluate(() => window.__mgTest.setTab('archived'));
  await mg.waitForTimeout(200);
  await expect(mg.locator('#mgList .mg-item')).toHaveCount(5);

  const problemi = [];
  for (const item of ARCHIVIATI) {
    // Pagina dei feedback: il pulsante dentro la scheda.
    const bottoneFb = (await fb.locator(`.fb-card[data-id="${item._id}"] .fb-act`).first().innerText()).trim();
    // Dashboard di gestione: il pulsante nel pannello di gestione.
    await mg.evaluate((id) => window.__mgTest.openDetail(id), item._id);
    await mg.waitForTimeout(150);
    const bottoneMg = (await mg.locator('#mgArchiveBtn').innerText()).trim();
    const visibileMg = await mg.locator('#mgArchiveBtn').isVisible();
    problemi.push(`${item.name} [${item.status}] → feedback: "${bottoneFb}" · gestione: "${visibileMg ? bottoneMg : '(nascosto)'}"`);
  }
  test.info().annotations.push({ type: 'azioni', description: problemi.join('\n') });

  // L'invariante: una segnalazione che sta negli Archiviati si deve poter
  // TOGLIERE dagli archiviati, da tutt'e due le strade.
  for (const item of ARCHIVIATI) {
    const bottoneFb = (await fb.locator(`.fb-card[data-id="${item._id}"] .fb-act`).first().innerText()).trim();
    expect(bottoneFb, `feedback/${item.status}`).toContain('Ripristina');
    await mg.evaluate((id) => window.__mgTest.openDetail(id), item._id);
    await mg.waitForTimeout(150);
    const bottoneMg = (await mg.locator('#mgArchiveBtn').innerText()).trim();
    expect(bottoneMg, `gestione/${item.status}`).toBe('Ripristina');
  }
});

test('#509/3b — «Ripristina» su un attacco confermato: le due pagine scrivono la stessa cosa', async ({ openTab }) => {
  const uno = [ARCHIVIATI[1]]; // attack_confirmed
  const fb = await apriFeedback(openTab, uno);
  const mg = await apriManage(openTab, uno);

  await fb.locator('#tabs [data-tab="archived"]').click();
  await fb.locator('.fb-card .fb-act').first().click();
  await fb.waitForTimeout(400);
  const scritturaFb = (await updates(fb))[0];

  await mg.evaluate(() => window.__mgTest.setTab('archived'));
  await mg.evaluate(() => window.__mgTest.openDetail('z2'));
  await mg.waitForTimeout(200);
  await mg.locator('#mgArchiveBtn').click();
  await mg.waitForTimeout(400);
  const scritturaMg = (await updates(mg))[0];

  test.info().annotations.push({
    type: 'scritture',
    description: `feedback: ${JSON.stringify(scritturaFb)} · gestione: ${JSON.stringify(scritturaMg)}`,
  });
  expect(scritturaMg.status).toBe(scritturaFb.status);
});
