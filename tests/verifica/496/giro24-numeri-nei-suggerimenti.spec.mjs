// VERIFICA #496 — giro 24. I numeri della scheda si scrivono all'italiana
// (giro 23), ma tre superfici sono rimaste fuori: i due suggerimenti che
// compaiono col mouse (fetta della torta, colonna del grafico) e la riga di
// avviso sotto i filtri. Sulla stessa schermata lo stesso conto si legge in
// due modi.
import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

test('#496 giro24 — il suggerimento della fetta e della colonna scrive il numero come la legenda', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const feedbacks = [];
  const workerLog = [];
  for (let i = 0; i < 1200; i++) {
    feedbacks.push(fb({ _id: 'x' + i, seq: 1000 + i, createdAt: g(2), status: 'done' }));
    workerLog.push({ role: 'fixer', startedAt: g(2), num: String(1000 + i) });
    workerLog.push({ role: 'verifier', startedAt: g(2), num: String(1000 + i) });
  }
  await apriStatistiche(page, { feedbacks, workerLog }, feedbacks.slice(0, 40));
  await page.locator('[data-fs-range="tutto"]').click();

  await expect(page.locator('#mgFsLegend .mg-fs-legend-n').first()).toHaveText('1.200');
  const suTorta = await page.locator('#mgFsPie title').first().innerText();
  expect(suTorta, 'il suggerimento della fetta').toContain('1.200');
  const suColonna = await page.locator('#mgFsTrend [data-fs-punto]').first().getAttribute('title');
  expect(suColonna, 'il suggerimento della colonna').toContain('1.200');
});

test('#496 giro24 — l avviso delle segnalazioni senza data scrive il numero all italiana', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const feedbacks = [];
  for (let i = 0; i < 1200; i++) feedbacks.push(fb({ _id: 'y' + i, seq: 2000 + i, createdAt: 'data storta' }));
  await apriStatistiche(page, { feedbacks, workerLog: [] }, feedbacks.slice(0, 40));
  await page.locator('[data-fs-range="tutto"]').click();
  const nota = await page.locator('#mgFsNota').innerText();
  expect(nota, 'la riga di avviso sotto i filtri').toContain('1.200 segnalazioni');
});
