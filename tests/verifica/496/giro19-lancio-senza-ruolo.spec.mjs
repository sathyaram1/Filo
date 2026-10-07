// VERIFICA #496 — giro 19. Un'esecuzione senza mestiere sparisce dal conto.
//
// «Lanci delle routine» promette «tutte le esecuzioni delle routine nella
// finestra, di qualunque mestiere». Una riga del registro che arriva senza il
// mestiere scritto viene invece scartata in silenzio: il numero grande non la
// conta e la divisione per mestiere non la nomina. La scheda Log, che legge lo
// stesso registro, quella riga la mostra — quindi due superfici della stessa
// pagina contano lo stesso registro in due modi, e la differenza non la
// dichiara nessuno.
//
// Senza il fix il controllo è rosso: cinque righe nel registro, il riquadro
// ne conta quattro e nessuna riga dice dov'è finita la quinta.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

const DATI = {
  feedbacks: [fb({ _id: 'r19-a', seq: 250, createdAt: g(2) })],
  workerLog: [
    { role: 'new-work', startedAt: g(2), num: '250' },
    { role: 'fixer', startedAt: g(1.8), num: '250' },
    { role: 'verifier', startedAt: g(1.6), num: '250' },
    { role: 'prober', startedAt: g(1.4) },
    { startedAt: g(1.2) },   // il mestiere non è stato scritto
  ],
};

test('#496 giro19 — un\'esecuzione senza mestiere non sparisce dai lanci', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);

  const totale = Number(await page.locator('[data-fs-id="lanci"] .mg-tile-n').innerText());
  await page.locator('[data-fs-tile="lanci"]').click();
  const righe = (await page.locator('.mg-fs-detail').innerText()).replace(/\s+/g, ' ');
  const somma = [...righe.matchAll(/(\d+)/g)].reduce((s, m) => s + Number(m[1]), 0);

  expect(totale, 'il riquadro dei lanci lascia fuori l\'esecuzione senza mestiere').toBe(5);
  expect(somma, 'la divisione per mestiere non rende conto di tutte e cinque le esecuzioni').toBe(5);
});
