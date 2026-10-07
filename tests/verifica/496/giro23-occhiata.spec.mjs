// VERIFICA #496 — giro 23. Un'occhiata dopo la correzione: i numeri dentro la
// frase sotto la torta, il riquadro degli arenamenti e i numeri all'italiana,
// nei due temi. Non asserisce numeri: guarda che niente si sia storto.
import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

test('#496 giro23 — la scheda corretta si legge nei due temi', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const feedbacks = [];
  for (let i = 0; i < 1200; i++) {
    feedbacks.push(fb({ _id: 'o' + i, seq: 300 + i, createdAt: g(2), name: 'titolo ' + i, clientId: 'tester@example.com' }));
  }
  feedbacks[0].status = 'done';
  feedbacks[1].status = 'done';
  feedbacks[2].status = 'done';
  feedbacks[2].stalls = 2;
  const workerLog = [
    { role: 'fixer', startedAt: g(2), num: '300' },
    { role: 'verifier', startedAt: g(2), num: '300' },
    { role: 'fixer', startedAt: g(2), num: '301' },
    { role: 'verifier', startedAt: g(2), num: '301' },
    { role: 'verifier', startedAt: g(2), num: '301' },
    { role: 'fixer', startedAt: g(2), num: '302' },
    { role: 'fixer', startedAt: g(3), num: '999' },
    { role: 'verifier', startedAt: g(2), num: '999' },
  ];
  await apriStatistiche(page, { feedbacks, workerLog }, feedbacks.slice(0, 40));
  await page.locator('[data-fs-range="tutto"]').click();

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
    await page.locator('#mgFsRoot').screenshot({ path: `tests/.shots/496-giro23-${tema}.png` });
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
    'sbordo orizzontale',
  ).toBe(false);
});
