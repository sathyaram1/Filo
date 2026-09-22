// VERIFICA #496 — giro 21. Tre porte piccole, tutte sul riquadro e sul
// grafico della scheda delle statistiche.
//
// 1. Esc non chiude l'elenco che si apre sotto un numero, mentre chiude il
//    menu del tasto destro della stessa scheda: due riquadri aperti dalla
//    stessa mano, un solo tasto per chiuderne uno.
// 2. Con una finestra scritta a mano lunga più di tre secoli il grafico degli
//    arrivi non sta nella pagina: le colonne hanno una larghezza minima e la
//    pagina prende una barra di scorrimento orizzontale.
// 3. Scegliendo un anno di una o due cifre (0001) la riga sopra scrive «dal
//    1/1/1» e la prima colonna del grafico si chiama «1901».

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

const DATI = {
  feedbacks: [
    fb({ _id: 'y1', seq: 301, status: 'done', createdAt: g(3), reviewedAt: g(2) }),
    fb({ _id: 'y2', seq: 302, status: 'todo', createdAt: g(2) }),
  ],
  workerLog: [{ role: 'verifier', startedAt: g(2), num: '301' }],
};

test('#496 giro21 — Esc chiude l\'elenco aperto sotto un numero', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);
  await page.locator('[data-fs-range="tutto"]').click();

  // Il metro: Esc chiude il menu del tasto destro della stessa scheda.
  await page.evaluate(() => {
    document.querySelector('[data-fs-id="ricevuti"] .mg-tile-n')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
  });
  await expect(page.locator('.mg-ctxmenu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.mg-ctxmenu')).toHaveCount(0);

  // L'elenco: si apre dal menu, e poi?
  await page.evaluate(() => {
    document.querySelector('[data-fs-id="ricevuti"] .mg-tile-n')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
    document.querySelector('.mg-ctxmenu .sn-select-option').click();
  });
  await expect(page.locator('#mgFsDrill')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(
    await page.locator('#mgFsDrill').isHidden(),
    'l\'elenco aperto sotto un numero resta aperto dopo Esc: si chiude solo con «chiudi»',
  ).toBe(true);
});

test('#496 giro21 — una finestra di secoli non fa sbordare la pagina', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);

  await page.evaluate(() => window.__mgTest.setFsRange('custom', { da: '1700-01-01', a: '2026-12-31' }));
  const largo = await page.evaluate(() => ({
    colonne: document.querySelectorAll('#mgFsTrend .mg-fs-trend-col').length,
    sbordo: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    scroll: document.getElementById('mgFsTrend').scrollWidth,
    box: Math.round(document.getElementById('mgFsTrend').getBoundingClientRect().width),
  }));
  expect(
    largo.sbordo,
    `con la finestra 1/1/1700 – 31/12/2026 il grafico disegna ${largo.colonne} colonne larghe `
      + `${largo.scroll} pixel in un riquadro da ${largo.box}: la pagina prende una barra di scorrimento orizzontale`,
  ).toBe(false);
});

test('#496 giro21 — scegliendo l\'anno 1 il grafico non lo chiama 1901', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);

  await page.evaluate(() => window.__mgTest.setFsRange('custom', { da: '0001-01-01', a: '2026-12-31' }));
  const anno = await page.evaluate(() => ({
    finestra: document.getElementById('mgFsFinestra').textContent.trim(),
    prima: (document.getElementById('mgFsTrendAxis').querySelector('span') || {}).textContent,
  }));
  expect(
    anno.prima,
    `la riga sopra dice «${anno.finestra}» e la prima colonna del grafico si chiama «${anno.prima}»`,
  ).not.toBe('1901');
});
