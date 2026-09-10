// Verifica #496 — giro 8. Dove si apre l'elenco: sotto la pastiglia di un
// creatore (che sta in una fila flex) e in fondo alla tessera (che ha già la
// sua ripartizione sotto la testata).

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const OUT = 'tests/.shots';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();

test.beforeAll(() => { try { mkdirSync(OUT, { recursive: true }); } catch (_) { /* c'è già */ } });

test('l’elenco si apre dove è stato chiesto, e non dentro un riquadro chiuso', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((d) => window.__mgTest.setData([
    { _id: 'p1', seq: 1, subSeq: 0, clientId: 'routine:prober', name: 'da prober', text: 'a', status: 'todo', createdAt: d },
    { _id: 'p2', seq: 2, subSeq: 0, clientId: 'utente@example.com', name: 'da utente', text: 'b', status: 'done', createdAt: d, _updateTime: d, notes: "Report.\n\n--- Aggiornamento dell'agente del 07/09/2026, 18:00 ---\nVerifica superata." },
  ]), iso(1));
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(150);

  // La voce di legenda «Passata subito» ha la stessa chiave della riga
  // «Passate alla prima verifica», che sta in una tessera CHIUSA: l'elenco
  // deve nascere sotto la legenda, non dentro il riquadro nascosto.
  await page.locator('#mgStPieLegend [data-drill="giri:0"]').click();
  const sottoLegenda = page.locator('#mgStPieLegend .mg-st-drill');
  await expect(sottoLegenda).toBeVisible();
  await expect(sottoLegenda.locator('.mg-st-drill-item')).toHaveCount(1);
  await page.screenshot({ path: `${OUT}/496-giro8-elenco-legenda.png`, fullPage: true });

  // Sotto la pastiglia di un creatore: prende la riga intera, non una
  // colonnina schiacciata fra le pastiglie.
  await page.locator('#mgStCreators .mg-st-chip[data-creator="prober"]').click({ button: 'right' });
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: /Mostra l[ae] segnalazion/ }).click();
  const sottoChip = page.locator('#mgStCreators .mg-st-drill');
  await expect(sottoChip).toBeVisible();
  const largo = await sottoChip.evaluate((el) => el.getBoundingClientRect().width);
  const fila = await page.locator('#mgStCreators').evaluate((el) => el.getBoundingClientRect().width);
  expect(largo).toBeGreaterThan(fila * 0.9);
  await page.screenshot({ path: `${OUT}/496-giro8-elenco-chip.png`, fullPage: true });

  // In fondo alla tessera: l'elenco non si infila fra il numero e la riga che
  // lo spiega.
  await page.locator('.mg-st-card[data-card="ricevuti"] .mg-st-card-head').click({ button: 'right' });
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: /Mostra l[ae] segnalazion/ }).click();
  const dentroTessera = page.locator('.mg-st-card[data-card="ricevuti"] .mg-st-drill');
  await expect(dentroTessera).toBeVisible();
  const ordine = await page.evaluate(() => {
    const c = document.querySelector('.mg-st-card[data-card="ricevuti"]');
    return Array.from(c.children).map((el) => el.className.split(' ')[0]);
  });
  expect(ordine[ordine.length - 1]).toBe('mg-st-drill');
  await page.screenshot({ path: `${OUT}/496-giro8-elenco-tessera.png`, fullPage: true });
});
