// VERIFICA #496 — giro 20. La torta vuota lascia un quadrato bianco.
//
// Quando una finestra non contiene nessun lavoro arrivato al via libera — per
// esempio «Oggi» in un giorno tranquillo — la sezione «Quanto è costato ogni
// lavoro» tiene lo stesso il suo disegno da 200×200 pixel, vuoto, con la frase
// «Nessun lavoro verificato in questa finestra» schiacciata dentro il buco
// della ciambella che non c'è e un secondo «Niente da mostrare.» accanto.
//
// È la porta del giro 1 («la sezione dei giri di verifica lascia un rettangolo
// vuoto dove starebbero le torte»), che il giro 2 aveva dichiarato chiusa
// («le torte si tolgono invece di lasciare un rettangolo»).
//
// Senza il fix il controllo è rosso: il disegno vuoto misura 200×200.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

const altezzaTorta = (page) => page.evaluate(() => {
  const svg = document.querySelector('#mgFsPie');
  if (!svg) return 0;
  const r = svg.getBoundingClientRect();
  return Math.round(r.height);
});

test('#496 giro20 — senza lavori verificati la torta si toglie invece di lasciare un vuoto', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const vuoto = {
    feedbacks: [fb({ _id: 't1', seq: 931, createdAt: g(1) }), fb({ _id: 't2', seq: 932, createdAt: g(2) })],
    workerLog: [],
  };
  await apriStatistiche(page, vuoto, vuoto.feedbacks);
  await page.evaluate(() => window.__mgTest.setFsRange('30g'));

  expect(await page.locator('#mgFsPie [data-group]').count(), 'ci sono delle fette: la finestra non è vuota, controllo da riscrivere').toBe(0);
  const h = await altezzaTorta(page);
  expect(h, `senza niente da disegnare la torta occupa ancora ${h} pixel di altezza, vuoti`).toBeLessThan(40);

  // E la frase non sta dentro il buco di una ciambella che non c'è: si legge
  // dove la si cerca, sotto il titolo della sezione.
  const dentro = await page.evaluate(() => {
    const mid = document.getElementById('mgFsPieMid');
    if (!mid || !mid.innerText.trim()) return false;
    const r = mid.getBoundingClientRect();
    return r.width >= 150 && r.height >= 150;
  });
  expect(dentro, 'la spiegazione dello stato vuoto è centrata dentro il quadrato della torta invece che sotto il titolo').toBe(false);
});
