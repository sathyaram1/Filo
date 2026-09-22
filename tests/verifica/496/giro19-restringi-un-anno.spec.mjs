// VERIFICA #496 — giro 19. «Restringi la finestra a questo periodo» su una
// colonna che vale un anno.
//
// Quando la finestra scritta a mano è lunga più di dieci anni, il grafico
// degli arrivi fa una colonna per ANNO. Il tasto destro su una colonna offre
// «Restringi la finestra a questo periodo»: scegliendolo, la finestra dovrebbe
// diventare quell'anno. Diventa invece il 1° gennaio, un giorno solo — e le
// segnalazioni che la colonna aveva appena contato spariscono dai numeri.
// Il mese e la settimana sono stati previsti, l'anno no: è il pezzo rimasto
// indietro quando il passo «anno» è stato aggiunto.
//
// Senza il fix il controllo è rosso: la colonna conta 2 segnalazioni, e dopo
// aver restretto la finestra il riquadro «Feedback ricevuti» ne conta 0.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

const ANNO = new Date().getFullYear();

const DATI = {
  feedbacks: [
    fb({ _id: 'a19-a', seq: 240, createdAt: new Date(ANNO, 2, 5).toISOString() }),
    fb({ _id: 'a19-b', seq: 241, createdAt: new Date(ANNO, 8, 5).toISOString() }),
    fb({ _id: 'a19-c', seq: 242, createdAt: new Date(ANNO - 6, 1, 1).toISOString() }),
  ],
  workerLog: [],
};

test('#496 giro19 — restringere a una colonna da un anno tiene dentro quell\'anno', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);
  // Una finestra lunga abbastanza da far diventare le colonne degli anni.
  await page.evaluate((a) => window.__mgTest.setFsRange('custom', { da: '1990-01-01', a: `${a}-12-31` }), ANNO);
  await expect(page.locator('#mgFsTrendHint')).toContainText('Una colonna per anno');

  const colonna = page.locator(`.mg-fs-trend-col[data-fs-punto="${ANNO}"]`);
  expect(await colonna.getAttribute('title'), 'la colonna di quest\'anno non conta le due segnalazioni')
    .toBe(`${ANNO}: 2`);

  await colonna.click({ button: 'right' });
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Restringi' }).click();

  await expect(
    page.locator('[data-fs-id="ricevuti"] .mg-tile-n'),
    'restringendo la finestra a un anno le segnalazioni di quell\'anno spariscono',
  ).toHaveText('2');
  await expect(page.locator('#mgFsFinestra')).toContainText(`31/12/${ANNO}`);
});
