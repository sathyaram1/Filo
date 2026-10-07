// VERIFICA #496 — giro 17. «Quando sono arrivati».
//
// Il grafico degli arrivi non ha un asse del tempo: disegna una colonna solo
// per i periodi che contengono qualcosa e le mette una accanto all'altra. Tre
// mesi di silenzio fra due gruppi non si vedono, e la riga sotto il titolo
// («Una colonna per settimana») promette una scala che non c'è.
//
// Si vede anche dalla parte opposta: la data di fine è scritta in fondo a
// destra sotto il grafico, mentre l'ultima colonna resta a sinistra, lontana
// dalla sua etichetta.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa, segnalazione, apriStatistiche, testoDi } from './giro17-aiuto-comune.mjs';

test('#496 giro17 — il grafico degli arrivi salta i periodi vuoti', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  // Novanta giorni: due segnalazioni all'inizio della finestra, una alla fine.
  // In mezzo, dodici settimane senza niente.
  const feedbacks = [
    segnalazione({ seq: 970, createdAt: giorniFa(89) }),
    segnalazione({ seq: 971, createdAt: giorniFa(89) }),
    segnalazione({ seq: 972, createdAt: giorniFa(0) }),
  ];
  await apriStatistiche(page, { feedbacks, workerLog: [] }, feedbacks);
  await page.locator('[data-fs-range="90g"]').click();

  const riquadro = await page.locator('#mgFsTrend').boundingBox();
  const colonne = await page.locator('.mg-fs-trend-col').evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { titolo: e.getAttribute('title'), sinistra: r.x, destra: r.x + r.width };
  }));
  expect(colonne.length, 'il grafico non disegna le due punte').toBeGreaterThanOrEqual(2);

  // Quello che l'owner deve poter leggere: il vuoto in mezzo. Le due punte
  // distano tre mesi, quindi non possono stare appiccicate all'inizio del
  // riquadro. Oggi la seconda comincia 50 pixel dopo la prima, su un riquadro
  // largo più di mille.
  const primaFine = colonne[0].destra;
  const ultimaInizio = colonne[colonne.length - 1].sinistra;
  const vuoto = ultimaInizio - primaFine;
  expect(vuoto, 'fra le due punte, distanti tre mesi, non c\'è nessuno spazio')
    .toBeGreaterThan(riquadro.width * 0.5);

  // E l'ultima colonna sta sotto la data che la riga dell'asse le assegna, che
  // è scritta in fondo a destra.
  const ultimaFine = colonne[colonne.length - 1].destra;
  expect(ultimaFine, 'l\'ultima colonna è lontana dalla data di fine scritta sotto di lei')
    .toBeGreaterThan(riquadro.x + riquadro.width * 0.8);

  // La riga sotto il titolo dichiara la scala: se dice «una colonna per
  // settimana», le colonne sono quante le settimane della finestra (tredici),
  // non due.
  const scala = await testoDi(page, '#mgFsTrendHint');
  if (/per settimana/.test(scala)) {
    expect(colonne.length, 'la riga promette una colonna per settimana, ma le settimane della finestra sono tredici')
      .toBeGreaterThanOrEqual(12);
  }
});
