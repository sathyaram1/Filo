// VERIFICA #496 — giro 18. La finestra scritta a mano torna vuota.
//
// La scheda ricorda QUALE finestra avevi scelto, ma non le due date che la
// definiscono (e nemmeno il filtro per mittente). Riaperta Filo, la pasticca
// «Scegli tu» è accesa, i due campi sono vuoti e la finestra senza estremi vuol
// dire TUTTO: i numeri sullo schermo sono quelli di sempre, sotto una pasticca
// che promette un periodo scelto da te, e nessuna riga dice quale periodo stai
// guardando davvero.
//
// Senza il fix il controllo è rosso: il numero dopo la ricarica è quello di
// «Tutto», non quello della finestra salvata.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

const oggi = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const DATI = {
  feedbacks: [
    fb({ _id: 'g18-r1', seq: 1001, createdAt: g(0.5) }),   // dentro la finestra stretta
    fb({ _id: 'g18-r2', seq: 1002, createdAt: g(40) }),    // fuori: si vede solo su «Tutto»
  ],
  workerLog: [],
};

test('#496 giro18 — «Scegli tu» ricordata torna con le sue date, o dice cosa stai guardando', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);

  await page.locator('[data-fs-range="custom"]').click();
  const da = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await page.locator('#mgFsFrom').fill(iso(da));
  await page.locator('#mgFsFrom').dispatchEvent('change');
  await page.locator('#mgFsTo').fill(iso(oggi));
  await page.locator('#mgFsTo').dispatchEvent('change');
  await expect(page.locator('[data-fs-id="ricevuti"] .mg-tile-n')).toHaveText('1');

  // Filo si riapre.
  await page.reload();
  await apriStatistiche(page, DATI, DATI.feedbacks);

  await expect(page.locator('.mg-chip--on[data-fs-range]')).toHaveText('Scegli tu');
  // I numeri devono restare quelli della finestra che avevi scelto: due campi
  // vuoti sotto «Scegli tu» mostrano invece tutto quello che c'è.
  await expect(page.locator('[data-fs-id="ricevuti"] .mg-tile-n')).toHaveText('1');
});
