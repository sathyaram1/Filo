// La frase per chi ha segnalato, salvata su un pacchetto dalla Gestione, arriva anche alle segnalazioni unite: l'owner
// legge su quali è arrivata, e un'unita rimasta senza frase si dice col suo numero e si rimanda al salvataggio dopo.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const PACCHETTO = {
  _id: 'fb-pacco', seq: 950, subSeq: 0, status: 'done', statusPublic: 'closed', reviewDecision: 'accepted',
  text: 'Il menu del tasto destro', name: 'Menu del tasto destro', clientId: 'owner', createdAt: '2026-10-30T10:00:00Z',
  images: [], notes: 'Pacchetto di #812, #815.', unisce: [{ id: 'fb-812', num: '812' }, { id: 'fb-815', num: '815' }],
};
const FRASE = 'Ora il menu del tasto destro si apre anche sulle immagini.';

async function apri(page, risposte) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.evaluate((r) => {
    window.__updates = [];
    window.__risposte = r;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      // Il salvataggio automatico può partire prima del clic: finite le risposte, vale l'ultima.
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return window.__risposte.length > 1 ? window.__risposte.shift() : window.__risposte[0]; }
      return orig(msg);
    };
  }, risposte);
  await page.evaluate((p) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([p]);
    window.__mgTest.setTab('done');
    window.__mgTest.openDetail(p._id);
  }, PACCHETTO);
  await expect(page.locator('#mgDetail')).toBeVisible();
  await page.locator('#mgUserNoteToggle').click();
  await expect(page.locator('#mgUserNoteText')).toBeVisible();
}

test('salvata sul pacchetto, la frase dice su quali unite è arrivata', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [{ ok: true, unite: { aggiornate: ['812', '815'], fallite: [] } }]);
  // La frase parte da sola alla pausa dopo la scrittura, come la scrive l'owner.
  await page.locator('#mgUserNoteText').fill(FRASE);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata, anche su #812, #815');
  await expect(page.locator('#mgUserNoteMsg')).toHaveClass(/mg-ok/);
  expect(await page.evaluate(() => window.__updates.map((u) => [u.id, u.userNote]))).toEqual([['fb-pacco', FRASE]]);
});

test('un\'unita rimasta senza frase si dice col numero, e il salvataggio dopo la rimanda invece di dire «Nessuna modifica»', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    { ok: true, unite: { aggiornate: ['812'], fallite: [{ num: '815', motivo: 'rete giù' }] } },
    { ok: true, unite: { aggiornate: ['812', '815'], fallite: [] } },
  ]);
  await page.locator('#mgUserNoteText').fill(FRASE);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata, ma non sulle unite #815: riprova');
  await expect(page.locator('#mgUserNoteMsg')).toHaveClass(/mg-err/);
  const prima = await page.evaluate(() => window.__updates.length);

  await page.locator('#mgUserNoteBtn').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(prima + 1);
  expect(await page.evaluate(() => window.__updates[window.__updates.length - 1].userNote)).toBe(FRASE);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata, anche su #812, #815');
});
