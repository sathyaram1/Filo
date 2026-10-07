// VERIFICA #496 — giro 24. L'elenco che si apre sotto un numero si chiude con
// Esc o con «chiudi», e il fuoco della tastiera finisce in cima al documento:
// chi usa la tastiera riparte dall'inizio della pagina invece che dal numero
// da cui era partito.
import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

async function scheda(openTab) {
  const page = await openTab(URL_GESTIONE);
  const feedbacks = [
    fb({ _id: 'f1', seq: 1, createdAt: g(2), status: 'done' }),
    fb({ _id: 'f2', seq: 2, createdAt: g(2), status: 'done' }),
  ];
  const workerLog = [
    { role: 'fixer', startedAt: g(2), num: '1' }, { role: 'verifier', startedAt: g(2), num: '1' },
    { role: 'fixer', startedAt: g(2), num: '2' }, { role: 'verifier', startedAt: g(2), num: '2' },
  ];
  await apriStatistiche(page, { feedbacks, workerLog }, feedbacks);
  await page.locator('[data-fs-range="tutto"]').click();
  return page;
}

const dove = (page) => page.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return 'niente';
  return a.closest('#mgFsLegend') ? 'legenda' : (a.id || a.tagName);
});

test('#496 giro24 — Esc riporta il fuoco sulla voce che aveva aperto l elenco', async ({ openTab }) => {
  const page = await scheda(openTab);
  await page.locator('#mgFsLegend li').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#mgFsDrill')).toBeVisible();
  await page.locator('#mgFsDrillList button:not([disabled])').first().focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mgFsDrill')).toBeHidden();
  expect(await dove(page), 'dove sta il fuoco dopo Esc').toBe('legenda');
});

test('#496 giro24 — «chiudi» riporta il fuoco sulla voce che aveva aperto l elenco', async ({ openTab }) => {
  const page = await scheda(openTab);
  await page.locator('#mgFsLegend li').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#mgFsDrill')).toBeVisible();
  await page.locator('#mgFsDrillClose').click();
  await expect(page.locator('#mgFsDrill')).toBeHidden();
  expect(await dove(page), 'dove sta il fuoco dopo «chiudi»').toBe('legenda');
});
