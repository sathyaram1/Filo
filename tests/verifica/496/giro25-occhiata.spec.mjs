// VERIFICA #496 — giro 25. Un giro di ricognizione sulla scheda: nei due temi,
// a finestra stretta e con l'elenco aperto sotto un numero.
// Non asserisce numeri: guarda che niente si sia storto.
import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

function scenario() {
  const feedbacks = [];
  const mittenti = ['tester@example.com', 'claude-worker', 'claude-prober', 'owner@example.com'];
  for (let i = 0; i < 40; i++) {
    feedbacks.push(fb({
      _id: 'x' + i, seq: 100 + i, createdAt: g(1 + (i % 25)),
      name: 'segnalazione numero ' + i, clientId: mittenti[i % mittenti.length],
      status: ['todo', 'working', 'done', 'archived', 'design'][i % 5],
    }));
  }
  const workerLog = [];
  for (let i = 0; i < 20; i++) {
    workerLog.push({ role: 'fixer', startedAt: g(2 + (i % 10)), num: String(100 + i) });
    for (let k = 0; k <= i % 4; k++) workerLog.push({ role: 'verifier', startedAt: g(2 + (i % 10)), num: String(100 + i) });
  }
  for (let i = 0; i < 6; i++) workerLog.push({ role: 'prober', startedAt: g(3) });
  return { feedbacks, workerLog };
}

test('#496 giro25 — la scheda si legge nei due temi, larga e stretta', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const { feedbacks, workerLog } = scenario();
  await apriStatistiche(page, { feedbacks, workerLog }, feedbacks);
  await page.locator('[data-fs-range="tutto"]').click();
  await page.locator('[data-fs-tile="ricevuti"]').click();
  await page.locator('#mgFsLegend li').first().click();
  await expect(page.locator('#mgFsDrill')).toBeVisible();

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
    await page.locator('#mgFsRoot').screenshot({ path: `tests/.shots/496-giro25-${tema}.png` });
  }
  await page.setViewportSize({ width: 760, height: 900 });
  await page.locator('#mgFsRoot').screenshot({ path: 'tests/.shots/496-giro25-stretto.png' });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
    'sbordo orizzontale a 760',
  ).toBe(false);
});
