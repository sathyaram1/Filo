// #497 — quinto giro: "scrivo la frase e chiudo il feedback" sulle due pagine.
import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const FEEDBACK = 'filo://feedback/feedback.html';

function fb(over) {
  return {
    _id: 'x', text: 'Il bottone non fa niente', name: 'Bottone morto',
    seq: 700, subSeq: 0, clientId: 'tester@example.com',
    createdAt: '2026-09-01T10:00:00Z', images: [],
    status: 'todo', statusPublic: 'open', notes: '', ...over,
  };
}

test('#497 X — manage: scrivo la frase e premo ✓ Risolto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
  });
  await page.evaluate((l) => window.__mgTest.setData(l), [fb({ _id: 'y1', status: 'todo' })]);
  await page.evaluate(() => { window.__mgTest.setTab('queue'); window.__mgTest.openDetail('y1'); });
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('Ora puoi rimuovere il modello dalle impostazioni.');
  await page.locator('#mgResolveBtn').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBeGreaterThanOrEqual(1);
  const u = await page.evaluate(() => window.__updates);
  console.log('MANAGE ✓ Risolto →', JSON.stringify(u.map((x) => ({ status: x.status, userNote: x.userNote }))));
});

test('#497 X bis — gemella: scrivo la frase e premo ✓ Risolto', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForFunction(() => window.__fbTest && window.filo);
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__fbTest.setAdmin(true, { email: 'owner@example.com' });
  });
  await page.evaluate((l) => window.__fbTest.setData(l), [fb({ _id: 'y2', status: 'todo' })]);
  await page.evaluate(() => window.__fbTest.setTab('queue'));
  await page.waitForTimeout(300);
  await page.locator('.fb-usernote').first().fill('Ora puoi rimuovere il modello dalle impostazioni.');
  await page.locator('.fb-act', { hasText: 'Risolto' }).first().click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBeGreaterThanOrEqual(1);
  const u = await page.evaluate(() => window.__updates);
  console.log('GEMELLA ✓ Risolto →', JSON.stringify(u.map((x) => ({ status: x.status, userNote: x.userNote }))));
});
