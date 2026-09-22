// VERIFICA #496 — giro 19. «N verifiche in tutto» non è un totale.
//
// Sotto «Feedback lavorati» c'è la riga «N verifiche in tutto». Quel numero
// conta solo le verifiche partite DENTRO la finestra; la torta poco sotto, per
// dichiarata scelta, conta le critiche di un lavoro su tutto il registro,
// anche fuori dalla finestra. Con una finestra stretta le due cose si
// contraddicono a vista: la riga dice «1 verifica in tutto» e la torta mette
// lo stesso, unico lavoro nella fetta «2 critiche» — cioè tre verifiche.
// «In tutto» è la parola che promette il totale, ed è quella che mente.
//
// Senza il fix il controllo è rosso: con la finestra «Oggi» la riga dice «1
// verifica in tutto» mentre la torta racconta 2 critiche sullo stesso lavoro.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';
import { oggiFa } from '../../helpers/istanti.mjs';

// Un solo lavoro, verificato tre volte: due volte tre settimane fa, la terza
// oggi. Costo vero: 2 critiche prima del via libera.
const DATI = {
  feedbacks: [fb({ _id: 'v19-a', seq: 230, status: 'done', createdAt: g(30) })],
  workerLog: [
    { role: 'new-work', startedAt: g(20), num: '230' },
    { role: 'verifier', startedAt: g(19), num: '230' },
    { role: 'fixer', startedAt: g(18), num: '230' },
    { role: 'verifier', startedAt: g(17), num: '230' },
    // Gli ultimi due devono cadere DENTRO «Oggi», che parte dalla mezzanotte:
    // «dodici ore fa» lo è solo dopo mezzogiorno (tests/helpers/istanti.mjs).
    { role: 'fixer', startedAt: oggiFa(12, 1000), num: '230' },
    { role: 'verifier', startedAt: oggiFa(9.6, 2000), num: '230' },
  ],
};

test('#496 giro19 — la riga sotto «Feedback lavorati» non promette un totale che non ha', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);
  await page.evaluate(() => window.__mgTest.setFsRange('oggi'));

  const sotto = (await page.locator('[data-fs-id="lavorati"] .mg-tile-sub').innerText()).trim();
  const fetta = (await page.locator('#mgFsLegend li[data-group]').first().innerText()).replace(/\s+/g, ' ').trim();

  // La torta, dentro «Oggi», racconta il costo vero del lavoro: 2 critiche.
  expect(fetta, 'la torta non racconta più il costo intero del lavoro').toContain('2 critiche');

  // Quindi la riga sopra non può dire «1 verifica in tutto»: o conta quanto
  // conta la torta, o non usa la parola che promette il totale.
  const numero = Number((sotto.match(/\d+/) || [0])[0]);
  const prometteIlTotale = /in tutto|complessiv|totale/i.test(sotto);
  expect(
    !prometteIlTotale || numero >= 3,
    `«${sotto}» promette un totale ma conta solo le verifiche della finestra, mentre la torta conta tutta la storia del lavoro`,
  ).toBe(true);
});
