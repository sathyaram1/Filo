// #1358 giro 1, rilievo 1: dalla pagina dei feedback l'owner che trova un lavoro fermo su una domanda deve poter
// rispondere da lì o arrivarci con un clic; prima la casella c'era (con gli allegati), ora resta un segno muto.
import { test, expect } from '../../fixtures/electron.mjs';

const base = { clientId: 'tester@example.com', createdAt: '2026-10-01T08:00:00Z', images: [], subSeq: 0, text: 'x' };
const giudici = (c) => ({ action: 'human_review', verdicts: [{ judge: 'a', class: c }, { judge: 'b', class: c }, { judge: 'c', class: c }] });
const ATTESA = { ...base, _id: 'fb-att', seq: 901, name: 'Colore del tema', status: 'design', statusReason: 'clarify', domandaId: 'D-7', pipeline: giudici('aligned'), notes: 'Report.\n\n[Filo]\nCaldo o freddo?' };
const VECCHIO = { ...base, _id: 'fb-old', seq: 904, name: 'Domanda di prima', status: 'design', statusReason: 'clarify', pipeline: giudici('aligned'), notes: 'Report.\n\n[Filo]\nQuale?' };

test('r1 pagina dei feedback: un lavoro che aspetta una domanda offre una strada per rispondere', async ({ openTab }) => {
  const fb = await openTab('filo://feedback/feedback.html');
  await fb.waitForLoadState('domcontentloaded');
  await fb.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW);
  await fb.evaluate(() => window.__fbTest.whenReady());
  await fb.evaluate(() => window.__fbTest.setAdmin(true));
  await fb.evaluate((items) => window.__fbTest.setData(items), [ATTESA, VECCHIO]);
  // Controllo: senza domanda la casella di risposta c'è, quindi la pagina è in modalità owner.
  await fb.evaluate(() => window.__fbTest.setTab('inbox'));
  await expect(fb.locator('.fb-card', { hasText: 'Domanda di prima' }).locator('.fb-reply-text')).toHaveCount(1);
  await fb.evaluate(() => window.__fbTest.setTab('queue'));
  const card = fb.locator('.fb-card', { hasText: 'Colore del tema' });
  await expect(card).toHaveCount(1);
  // Successo: o la casella, o un rimando cliccabile alla domanda.
  await expect(card.locator('.fb-reply-text, button.fb-domanda, a.fb-domanda, button[data-domanda], a[data-domanda]')).not.toHaveCount(0);
});
