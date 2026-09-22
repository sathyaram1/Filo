// VERIFICA #496 — giro 20. L'elenco aperto sotto un numero resta fermo.
//
// Tutta la scheda segue i feedback che arrivano mentre è aperta (porta chiusa
// al giro 16) e da poco anche il registro delle esecuzioni (giro 18). L'elenco
// che si apre cliccando un numero, invece, resta quello dell'istante in cui
// l'hai aperto: la riga sopra passa da 3 a 4 e l'elenco continua a dire «3
// segnalazioni» e a mostrarne tre. È il posto dove si va proprio per sapere
// QUALI, e il titolo porta un conteggio: due numeri della stessa cosa, sulla
// stessa schermata, che non sono d'accordo.
//
// Senza il fix il controllo è rosso: riga «Utente 4», elenco «Utente · 3
// segnalazioni».

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

const TRE = [
  fb({ _id: 'e1', seq: 911, clientId: 'tizio@example.com', createdAt: g(3) }),
  fb({ _id: 'e2', seq: 912, clientId: 'tizio@example.com', createdAt: g(2) }),
  fb({ _id: 'e3', seq: 913, clientId: 'tizio@example.com', createdAt: g(1) }),
];
const QUATTRO = TRE.concat([fb({ _id: 'e4', seq: 914, clientId: 'tizio@example.com', createdAt: g(0.2) })]);

test('#496 giro20 — l\'elenco aperto segue i feedback come i numeri sopra', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, { feedbacks: TRE, workerLog: [] }, TRE);
  await page.evaluate(() => window.__mgTest.setFsRange('30g'));

  await page.locator('[data-fs-tile="ricevuti"]').click();
  const riga = page.locator('#mgFsTiles [data-fs-bargroup="creatori"]').first();
  await riga.click();
  await expect(page.locator('#mgFsDrill')).toBeVisible();
  expect((await page.locator('#mgFsDrillTitle').innerText()).trim()).toContain('3');

  // Arriva una segnalazione nuova mentre la scheda è aperta, come fa il giro
  // della pagina: la riga sopra si aggiorna da sola.
  await page.evaluate((f) => window.__mgTest.setFsData({ feedbacks: f, workerLog: [] }), QUATTRO);
  const testoRiga = (await page.locator('#mgFsTiles [data-fs-bargroup="creatori"]').first().innerText()).replace(/\s+/g, ' ');
  expect(testoRiga, 'la riga sopra non si è aggiornata: cambiato il comportamento, questo controllo va riscritto').toContain('4');

  const titolo = (await page.locator('#mgFsDrillTitle').innerText()).trim();
  const righe = await page.locator('#mgFsDrillList li').count();
  expect(righe, `la riga conta 4 segnalazioni, l'elenco aperto su quella riga ne mostra ${righe}`).toBe(4);
  expect(titolo, `il titolo dell'elenco dice «${titolo}» mentre la riga da cui è nato dice 4`).toContain('4');
});
