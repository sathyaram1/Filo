// Prove del giro 1 (verifica locale) sul lavoro «feedback aperti dalle routine e dalle sessioni», lato Gestione.
// Dati finti come li scrive il server: un derivato di una routine nato nei Ricevuti coi giudici saltati, una
// segnalazione di una sessione per le routine nata In coda, e un feedback dell'owner che una routine ha rimandato
// nei Ricevuti perché «richiede lavoro locale».

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'filo://manage/manage.html';
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');

const FBS = [
  {
    _id: 'R', seq: 950, subSeq: 1, priority: 2, priorityManual: true, derived: true, name: 'Derivato di una routine',
    clientId: 'routine:residuo', senderProof: 'server', status: 'aligned', createdAt: '2026-10-03T09:00:00Z',
    text: 'Trovato verificando #950, giro 1.',
    pipeline: { stage: 'nascita', action: 'human_review', reasons: ['routine_proven'], skipped: 'routine_proven', verdicts: [] },
  },
  {
    _id: 'S', seq: 951, subSeq: 0, name: 'Segnalazione di una sessione per le routine',
    clientId: 'local:claude', senderProof: 'admin', status: 'todo', createdAt: '2026-10-03T09:10:00Z',
    text: 'Il menu del tasto destro esce dallo schermo.',
    pipeline: { stage: 'nascita', action: 'owner_accepted', reasons: ['session_proven'], skipped: 'session_proven', verdicts: [] },
  },
  {
    _id: 'O', seq: 952, subSeq: 0, priority: 2, name: 'Feedback dell’owner rimandato dalla routine',
    clientId: 'owner:me', senderProof: 'admin', status: 'design', statusReason: 'locale',
    notes: 'Richiede lavoro locale. Serve un deploy delle functions.', createdAt: '2026-10-03T09:20:00Z',
    text: 'Le notifiche delle fusioni non arrivano.',
    pipeline: { stage: 'L2', action: 'candidate_change', reasons: [], verdicts: [{ judge: 'fixed_1', class: 'aligned' }] },
  },
];

async function seed(page) {
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW);
  await page.evaluate((fbs) => { window.__mgTest.setData(fbs); window.__mgTest.setTab('inbox'); }, FBS);
}

test('la routine nasce nei Ricevuti, la sessione In coda, e il ritorno «richiede lavoro locale» dice il vero', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page);
  mkdirSync(SHOTS, { recursive: true });

  // Ricevuti: il derivato della routine e il feedback dell'owner rimandato; la sessione no.
  await expect(page.locator('.mg-item[data-id="R"]')).toBeVisible();
  await expect(page.locator('.mg-item[data-id="O"]')).toBeVisible();
  await expect(page.locator('.mg-item[data-id="S"]')).toHaveCount(0);
  await page.locator('.mg-item[data-id="R"]').click();
  await expect(page.locator('#mgDetail')).toBeVisible();
  await page.screenshot({ path: resolve(SHOTS, 'v914-g1-routine-ricevuti.png') });

  // In coda: la segnalazione della sessione.
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await expect(page.locator('.mg-item[data-id="S"]')).toBeVisible();
  await page.locator('.mg-item[data-id="S"]').click();
  await page.screenshot({ path: resolve(SHOTS, 'v914-g1-sessione-in-coda.png') });

  // r3: il feedback dell'owner rimandato da una routine. È suo: in locale si può lavorare (il segno «solo in
  // locale» glielo concede), e la frase non deve dirgli che è il feedback di un utente.
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.locator('.mg-item[data-id="O"]').click();
  await page.screenshot({ path: resolve(SHOTS, 'v914-g1-owner-richiede-locale.png') });
  const esito = await page.evaluate((fb) => ({
    nota: (window.SN_MANAGE_REVIEW.judgesNote(fb) || {}).text || '',
    segno: window.SN_MANAGE_REVIEW.localSignCheck(fb, true),
  }), FBS[2]);
  expect(esito.segno.ok, 'all’owner il segno «solo in locale» su un suo feedback è concesso').toBe(true);
  expect(esito.nota).toContain('lavoro locale');
  expect(esito.nota, 'la frase in Gestione dice che è il feedback di un utente').not.toMatch(/feedback degli utenti/i);
});
