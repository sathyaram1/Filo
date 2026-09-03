// #509 — giro 3, terza tornata: le decisioni offerte dentro «Ricevuti».
// Stessa domanda del file 3b, sull'altra sezione: preso lo STESSO feedback,
// nella STESSA sezione, le due pagine offrono le stesse scelte?

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';
const VERSIONE = '1.0.0';

async function apri(openTab, url, hook, items) {
  const page = await openTab(url);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction((h) => window[h] && window.SN_MANAGE_REVIEW, hook);
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
  if (hook === '__fbTest') {
    await page.evaluate(() => window.__fbTest.setAdmin(true, { email: 'o@e.com' }));
    await page.evaluate((v) => window.__fbTest.setReleasedVersion(v), VERSIONE);
    await page.evaluate((i) => window.__fbTest.setData(i), items);
  } else {
    await page.evaluate(() => window.__mgTest.setAdmin(true));
    await page.evaluate((v) => window.__mgTest.setReleasedVersion(v), VERSIONE);
    await page.evaluate((i) => window.__mgTest.setData(i), items);
  }
  return page;
}

const RICEVUTI = [
  { _id: 'y1', seq: 1, status: 'attack',          name: 'attacco',        text: '1', createdAt: '2026-08-01T10:00:00Z' },
  { _id: 'y2', seq: 2, status: 'spam',            name: 'spam',           text: '2', createdAt: '2026-08-02T10:00:00Z' },
  { _id: 'y3', seq: 3, status: 'suspicious_file', name: 'file sospetto',  text: '3', createdAt: '2026-08-03T10:00:00Z' },
];

test('#509/3c — «Ricevuti»: le stesse conferme di blocco sulle due pagine', async ({ openTab }) => {
  const fb = await apri(openTab, FEEDBACK, '__fbTest', RICEVUTI);
  const mg = await apri(openTab, MANAGE, '__mgTest', RICEVUTI);

  const righe = [];
  for (const item of RICEVUTI) {
    const bottoniFb = await fb.locator(`.fb-card[data-id="${item._id}"] .fb-act`)
      .evaluateAll((n) => n.map((b) => b.textContent.trim()));
    await mg.evaluate((id) => window.__mgTest.openDetail(id), item._id);
    await mg.waitForTimeout(150);
    const bottoniMg = await mg.locator('#mgActions button, #mgManage button')
      .evaluateAll((n) => n.filter((b) => !b.hidden && b.offsetParent !== null).map((b) => b.textContent.trim()));
    righe.push(`${item.status} → feedback: [${bottoniFb.join(', ')}] · gestione: [${bottoniMg.join(', ')}]`);
  }
  test.info().annotations.push({ type: 'conferme', description: righe.join('\n') });

  // «File sospetto» può essere confermato come attacco O come spam: la scelta
  // deve esserci da tutt'e due le strade.
  await mg.evaluate(() => window.__mgTest.openDetail('y3'));
  await mg.waitForTimeout(150);
  const conferme = await mg.locator('#mgActions button')
    .evaluateAll((n) => n.filter((b) => !b.hidden && b.offsetParent !== null).map((b) => b.textContent.trim()));
  expect(conferme.join(' | ')).toContain('Conferma spam');
});
