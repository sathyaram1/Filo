// VERIFICA #496 — giro 20. Due dettagli piccoli, tutti e due asimmetrie.
//
//  1. La riga sotto i filtri conta le segnalazioni senza una data d'arrivo
//     leggibile senza guardare il filtro per mittente: con «solo Persone»
//     acceso continua a contare quelle delle routine. Ogni altro conto della
//     scheda il filtro lo rispetta.
//  2. La pasticca «Tutti» del filtro per creatore è l'unica della sua barra a
//     non avere un menu suo col tasto destro: esce il menu generale della
//     pagina, quello che si ha anche su uno spazio bianco. Le altre otto e le
//     due di gruppo hanno le loro voci (porta chiusa al giro 17).

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

const DATI = {
  feedbacks: [
    fb({ _id: 'd1', seq: 941, clientId: 'tizio@example.com', createdAt: g(1) }),
    // Data illeggibile, e mandata da una routine: con «solo Persone» non
    // dovrebbe essere in nessun conto.
    fb({ _id: 'd2', seq: 942, clientId: 'routine:fixer', createdAt: 'non-una-data' }),
  ],
  workerLog: [],
};

test('#496 giro20 — la riga delle date illeggibili rispetta il filtro per mittente', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);
  await page.evaluate(() => window.__mgTest.setFsRange('30g'));
  const senza = (await page.locator('#mgFsNota').innerText()).replace(/\s+/g, ' ');
  expect(senza, 'senza filtro la riga non parla più delle date illeggibili: controllo da riscrivere').toMatch(/data d'arrivo leggibile/);

  await page.locator('[data-fs-creator="__persone"]').click();
  const conFiltro = (await page.locator('#mgFsNota').innerText()).replace(/\s+/g, ' ');
  expect(
    /data d'arrivo leggibile/.test(conFiltro),
    `con «solo Persone» la riga dice ancora «${conFiltro}», ma quella segnalazione l'ha mandata una routine`,
  ).toBe(false);
});

test('#496 giro20 — anche «Tutti» ha il suo menu col tasto destro', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);
  await page.evaluate(() => window.__mgTest.setFsRange('30g'));

  // Una pasticca qualunque della stessa barra: il menu c'è.
  await page.locator('[data-fs-creator="__persone"]').first().click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toBeVisible();
  await page.keyboard.press('Escape');

  // «Tutti», con nessun filtro acceso: niente.
  await page.locator('[data-fs-creator="__tutti"]').click({ button: 'right' });
  const n = await page.locator('.mg-ctxmenu').count();
  expect(n, 'la pasticca «Tutti» non offre niente col tasto destro, mentre tutte le sue vicine sì').toBeGreaterThan(0);
});
