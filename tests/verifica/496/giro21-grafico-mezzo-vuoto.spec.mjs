// VERIFICA #496 — giro 21. Il grafico degli arrivi e la sua scala non stanno
// sullo stesso pezzo di riquadro.
//
// «Quando sono arrivati» disegna una colonna per periodo della finestra. Sotto
// le otto colonne si accende un tetto di larghezza (48 pixel a colonna) e le
// colonne restano tutte a sinistra; la riga delle date sotto resta invece
// giustificata agli estremi. Con «7 giorni» — la finestra che la segnalazione
// stessa nomina — le sette colonne occupano meno di un terzo del riquadro e la
// data di fine è scritta all'estremo destro, centinaia di pixel dopo l'ultima
// colonna che dovrebbe nominare: la scala dice una cosa e il disegno un'altra.
//
// È la terza volta che questa porta si apre (giri 8 e 9).
//
// Senza il fix il controllo è rosso: con «7 giorni» la distanza fra l'ultima
// colonna e la data che la nomina è di centinaia di pixel.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

const DATI = {
  feedbacks: [
    fb({ _id: 'p1', seq: 501, status: 'done', createdAt: g(0.2) }),
    fb({ _id: 'p2', seq: 502, status: 'done', createdAt: g(1) }),
    fb({ _id: 'p3', seq: 503, status: 'todo', createdAt: g(3) }),
    fb({ _id: 'p4', seq: 504, status: 'todo', createdAt: g(5) }),
    fb({ _id: 'p5', seq: 505, status: 'todo', createdAt: g(25) }),
  ],
  workerLog: [{ role: 'verifier', startedAt: g(1), num: '501' }],
};

const misura = (page) => page.evaluate(() => {
  const t = document.getElementById('mgFsTrend');
  const cols = [...t.querySelectorAll('.mg-fs-trend-col')];
  const box = t.getBoundingClientRect();
  const ultima = cols.length ? cols[cols.length - 1].getBoundingClientRect() : null;
  const spans = [...document.getElementById('mgFsTrendAxis').querySelectorAll('span')];
  const fine = spans.length ? spans[spans.length - 1] : null;
  return {
    colonne: cols.length,
    larghezza: Math.round(box.width),
    finiscono: ultima ? Math.round(ultima.right - box.left) : 0,
    etichettaFine: fine ? fine.textContent.trim() : '',
    xEtichettaFine: fine ? Math.round(fine.getBoundingClientRect().right - box.left) : 0,
  };
});

test('#496 giro21 — con «7 giorni» la scala del grafico sta sopra le colonne che nomina', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);

  // Il metro: su «30 giorni» le colonne arrivano in fondo e la data di fine è
  // scritta lì, sotto l'ultima. È così che questo grafico si legge.
  await page.locator('[data-fs-range="30g"]').click();
  const lunga = await misura(page);
  expect(lunga.colonne, 'con «30 giorni» le colonne non sono trenta: controllo da riscrivere').toBe(30);
  expect(
    Math.abs(lunga.xEtichettaFine - lunga.finiscono),
    'con «30 giorni» la data di fine non è più sotto l\'ultima colonna: cambiato il metro, questo controllo va riscritto',
  ).toBeLessThan(120);

  await page.locator('[data-fs-range="7g"]').click();
  const m = await misura(page);
  expect(m.colonne, 'con «7 giorni» le colonne non sono sette: controllo da riscrivere').toBe(7);
  expect(
    Math.abs(m.xEtichettaFine - m.finiscono),
    `con «7 giorni» le colonne finiscono a ${m.finiscono} pixel su ${m.larghezza} `
      + `(${m.larghezza - m.finiscono} pixel di riquadro restano bianchi) mentre la data di fine `
      + `«${m.etichettaFine}» è scritta a ${m.xEtichettaFine}: la scala nomina un punto dove non c'è niente`,
  ).toBeLessThan(120);
});
