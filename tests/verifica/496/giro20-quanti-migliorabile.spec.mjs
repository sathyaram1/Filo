// VERIFICA #496 — giro 20. «Quanti passati lasciando indietro dei rilievi».
//
// La segnalazione chiedeva per nome «quanti di questi sono fail e quanti
// migliorabile». I due numeri stanno sotto la torta: «fermati» e «passati
// lasciando indietro dei rilievi, raccolti in una segnalazione derivata». Il
// secondo si conta solo su una parte delle lavorazioni, e da tutte e due le
// parti sbaglia.
//
//  · per ECCESSO: un lavoro FERMATO che ha una segnalazione derivata viene
//    contato anche fra i «passati», cioè è insieme fallito e passato;
//  · per DIFETTO: un lavoro passato davvero, ma tenuto fuori dalla torta
//    perché le sue verifiche sono più vecchie del registro, non viene contato
//    fra i «passati lasciando indietro dei rilievi» nemmeno se la segnalazione
//    derivata c'è.
//
// Senza il fix il controllo è rosso da tutte e due le parti.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

const numeroEsito = async (page, chiave) => page.evaluate((k) => {
  const el = document.querySelector(`[data-fs-esito="${k}"] b`);
  return el ? Number(el.textContent.trim()) : null;
}, chiave);

test('#496 giro20 — un lavoro fermato non è anche «passato lasciando indietro dei rilievi»', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const dati = {
    feedbacks: [
      // Fermato: aspetta una decisione dell'owner. Ha una derivata sul numero.
      fb({ _id: 'q1', seq: 921, status: 'design', createdAt: g(2) }),
      fb({ _id: 'q1r', seq: 921, subSeq: 1, clientId: 'routine:residuo', status: 'todo', createdAt: g(2) }),
    ],
    workerLog: [
      { role: 'new-work', startedAt: g(2), num: '921' },
      { role: 'verifier', startedAt: g(1.9), num: '921' },
    ],
  };
  await apriStatistiche(page, dati, dati.feedbacks);
  await page.evaluate(() => window.__mgTest.setFsRange('30g'));

  expect(await numeroEsito(page, 'fermati'), 'il lavoro fermato non è più contato fra i fermati: controllo da riscrivere').toBe(1);
  const passati = await numeroEsito(page, 'rimandati');
  expect(passati, 'lo stesso lavoro è contato insieme fra i fermati e fra i passati che hanno lasciato indietro dei rilievi').toBe(0);
});

test('#496 giro20 — un lavoro passato con rilievi lasciati indietro si conta anche se il registro è corto', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const dati = {
    feedbacks: [
      // Passato davvero, e con la sua segnalazione derivata.
      fb({ _id: 'q2', seq: 922, status: 'done', createdAt: g(40) }),
      fb({ _id: 'q2r', seq: 922, subSeq: 1, clientId: 'routine:residuo', status: 'todo', createdAt: g(40) }),
    ],
    // Il registro conserva solo l'ultima lavorazione: le verifiche di questo
    // numero sono più vecchie e non ci sono più.
    workerLog: [{ role: 'fixer', startedAt: g(2), num: '922' }],
  };
  await apriStatistiche(page, dati, dati.feedbacks);
  await page.evaluate(() => window.__mgTest.setFsRange('30g'));

  const passati = await numeroEsito(page, 'rimandati');
  expect(passati, 'un lavoro passato lasciando indietro dei rilievi non viene contato solo perché le sue verifiche sono più vecchie del registro').toBe(1);
});
