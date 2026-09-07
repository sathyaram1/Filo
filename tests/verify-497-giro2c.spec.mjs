// Verifica avversariale #497 — giro 2, terza ondata: la finestra di tempo in
// cui il cambio di stato è già partito e il pannello sta per chiudersi.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const BASE = {
  _id: 'v497c',
  text: 'Il tasto non fa niente',
  name: 'Tasto muto',
  seq: 497,
  subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-09-01T10:00:00Z',
  images: [],
  notes: 'Report della lavorazione.',
  status: 'todo',
  reviewDecision: 'accepted',
};

test('scrivere la frase mentre il cambio di stato è in volo', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => {
    window.__updates = [];
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__updates.push(msg);
        await new Promise((r) => setTimeout(r, 1200));   // rete lenta ma reale
        return { ok: true };
      }
      return { ok: true };
    };
  });
  await page.evaluate((f) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([f]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(f._id);
  }, BASE);

  await page.locator('#mgActionsRow button', { hasText: 'Risolto' }).click();
  // Mentre la scrittura è in volo l'owner si ricorda della frase e la scrive.
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').type('Scritta mentre chiudevo.', { delay: 5 });
  await page.waitForTimeout(2500);
  const inviati = await page.evaluate(() => window.__updates);
  const frase = inviati.find((u) => typeof u.userNote === 'string');
  console.log('MESSAGGI:', JSON.stringify(inviati.map((u) => Object.keys(u))));
  console.log('FRASE PARTITA?', !!frase, frase ? frase.userNote : '');
  const dettaglioChiuso = await page.evaluate(() => document.getElementById('mgDetail').hidden);
  console.log('DETTAGLIO CHIUSO:', dettaglioChiuso);
});
