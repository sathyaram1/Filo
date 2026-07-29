// Spec Playwright per la tab "Log" della pagina di gestione (filo://manage/).
//
// La tab mostra l'elenco dei worker spawnati dalle routine: per ciascuno il
// RUOLO (etichetta amichevole) e QUANDO è partito (tempo relativo + assoluto).
//
// Assert di COMPORTAMENTO (fallirebbero senza la feature):
//   - la tab "Log" esiste e, cliccata, mostra il pannello dedicato;
//   - con voci finte renderizzate, ogni riga porta il ruolo tradotto e il tempo
//     d'avvio; l'ordine ricevuto (più recenti prima) è preservato;
//   - lista vuota → messaggio "nessun worker", non righe;
//   - un ruolo sconosciuto degrada senza rompersi (non resta vuoto).
//
// Il render è esercitato via __mgTest.renderWorkerLog (niente Firestore né
// sessione admin): si verifica la resa e la traduzione dei ruoli.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const FAKE_LOG = [
  { role: 'new-work', startedAt: '2026-07-29T10:05:00.000Z', num: '374' },
  { role: 'verifier', startedAt: '2026-07-29T10:00:00.000Z', num: '374' },
  { role: 'prober',   startedAt: '2026-07-29T09:00:00.000Z', num: '' },
];

test('la tab Log apre il pannello dedicato', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  await page.click('.mg-tab[data-tab="log"]');
  await expect(page.locator('#panel-log')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('.mg-tab[data-tab="log"]')).toHaveClass(/mg-tab--active/);
});

test('le voci del log mostrano ruolo tradotto e istante d avvio, più recenti prima', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderWorkerLog);

  await page.evaluate(() => window.__mgTest.setTab('log'));
  await page.evaluate((entries) => window.__mgTest.renderWorkerLog(entries), FAKE_LOG);

  const rows = page.locator('#mgLogList .mg-log-row');
  await expect(rows).toHaveCount(3);

  // Ordine preservato (la lista arriva già "più recenti prima").
  await expect(rows.nth(0).locator('.mg-log-role')).toHaveText('Nuovo lavoro');
  await expect(rows.nth(1).locator('.mg-log-role')).toHaveText('Verifica');
  await expect(rows.nth(2).locator('.mg-log-role')).toHaveText('Esplorazione');

  // Ogni riga dice QUANDO è partito (tempo relativo non vuoto) e porta la data
  // assoluta nel title (hover) — la prova che l'istante d'avvio è mostrato.
  const when0 = await rows.nth(0).locator('.mg-log-when').textContent();
  expect((when0 || '').trim().length).toBeGreaterThan(0);
  // Il numero del feedback lavorato compare quando presente.
  expect(when0).toContain('#374');

  const title0 = await rows.nth(0).getAttribute('title');
  expect(title0).toContain('29/07/2026');

  // Il prober (senza feedback) non mostra un "#": niente numero fasullo.
  const when2 = await rows.nth(2).locator('.mg-log-when').textContent();
  expect(when2).not.toContain('#');

  // La lista è visibile, i messaggi vuoto/denied no.
  await expect(page.locator('#mgLogList')).toBeVisible();
  await expect(page.locator('#mgLogEmpty')).toBeHidden();
});

test('log vuoto → messaggio dedicato, nessuna riga', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderWorkerLog);

  await page.evaluate(() => window.__mgTest.setTab('log'));
  await page.evaluate(() => window.__mgTest.renderWorkerLog([]));

  await expect(page.locator('#mgLogList .mg-log-row')).toHaveCount(0);
  await expect(page.locator('#mgLogEmpty')).toBeVisible();
});

test('ruolo sconosciuto degrada senza rompersi', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderWorkerLog);

  await page.evaluate(() => window.__mgTest.setTab('log'));
  await page.evaluate(() =>
    window.__mgTest.renderWorkerLog([{ role: 'weird-role', startedAt: '2026-07-29T10:00:00.000Z', num: '' }]));

  const role = page.locator('#mgLogList .mg-log-row .mg-log-role').first();
  // Non tradotto (non in mappa) → mostra il valore grezzo, mai vuoto.
  await expect(role).toHaveText('weird-role');
});
