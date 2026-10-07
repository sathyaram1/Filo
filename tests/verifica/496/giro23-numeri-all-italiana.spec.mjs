// VERIFICA #496 — giro 23. I numeri della scheda non passano dal formato
// italiano, mentre il resto di Filo sì (src/pages/redteam/redteam.js,
// src/shared/wallet.js, src/shared/campoNumero.js usano tutti
// Intl.NumberFormat('it-IT')).
//
//   1. la media al centro della torta — il numero che la segnalazione chiedeva
//      per nome — esce da toFixed(1), quindi col punto: «5.5» invece di «5,5»;
//   2. i conti a quattro cifre e più escono grezzi: «12345» invece di
//      «12.345».
//
// Senza il fix il primo controllo è rosso sul punto decimale e il secondo
// sull'assenza del separatore delle migliaia.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

/** Un lavoro passato con `verifiche` partenze del verificatore: giri = verifiche - 1. */
function lavoro(seq, verifiche) {
  const log = [{ role: 'fixer', startedAt: g(5), num: String(seq) }];
  for (let i = 0; i < verifiche; i++) log.push({ role: 'verifier', startedAt: g(5), num: String(seq) });
  return { doc: fb({ _id: 'it' + seq, seq, status: 'done', createdAt: g(6), name: 'lavoro ' + seq, clientId: 'tester@example.com' }), log };
}

test('#496 giro23 — la media al centro della torta si scrive con la virgola', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  // giri: 0 e 1 → media 0,5
  const pezzi = [lavoro(851, 1), lavoro(852, 2)];
  const dati = { feedbacks: pezzi.map((p) => p.doc), workerLog: pezzi.flatMap((p) => p.log) };
  await apriStatistiche(page, dati, dati.feedbacks);
  await page.locator('[data-fs-range="tutto"]').click();

  const media = (await page.locator('#mgFsPieMid b').innerText()).trim();
  expect(
    media,
    `al centro della torta, in grande, c'è scritto «${media}»: è il numero che la segnalazione chiedeva `
      + '(«il numero medio di giri prima del via libera»), e in italiano i decimali si separano con la virgola',
  ).toBe('0,5');
});

test('#496 giro23 — i numeri grandi hanno il punto delle migliaia', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const feedbacks = [];
  for (let i = 0; i < 1200; i++) {
    feedbacks.push(fb({ _id: 'q' + i, seq: 2000 + i, createdAt: g(2), name: 't' + i, clientId: 'tester@example.com' }));
  }
  await apriStatistiche(page, { feedbacks, workerLog: [] }, feedbacks.slice(0, 30));
  await page.locator('[data-fs-range="tutto"]').click();

  const n = (await page.locator('[data-fs-id="ricevuti"] .mg-tile-n').innerText()).trim();
  expect(
    n,
    `il riquadro «Feedback ricevuti» scrive «${n}»: la pagina delle statistiche del Red Team, quella che la `
      + 'segnalazione cita come metro, scrive gli stessi conti all\'italiana',
  ).toBe('1.200');
});
