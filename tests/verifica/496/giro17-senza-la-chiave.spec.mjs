// VERIFICA #496 — giro 17. Senza la chiave dell'owner.
//
// Le segnalazioni viaggiano cifrate: chi apre la gestione da un computer dove
// la chiave privata non è configurata riceve, al posto dei campi, un
// segnaposto che comincia con «[cifrato». Succede allo stato — e la scheda lo
// dichiara: la riga della categoria dice «Non leggibile con questa chiave» —
// ma succede anche a CHI HA MANDATO la segnalazione, e lì la scheda non lo
// dice: attribuisce tutto a «Utente».
//
// Il filtro per creatore è una delle tre cose chieste per nome nella
// segnalazione, e in questa situazione risponde con numeri inventati.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa, segnalazione, apriStatistiche, testoDi } from './giro17-aiuto-comune.mjs';

// Il segnaposto che il main mette al posto di un campo cifrato quando la
// chiave privata non c'è (src/main/services/handlers/auth.js).
const SENZA_CHIAVE = '[cifrato — chiave privata non configurata]';

test('#496 giro17 — senza la chiave, i mittenti diventano tutti «Utente» e nessuno lo dice', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const feedbacks = [0, 1, 2].map((i) => segnalazione({
    seq: 960 + i,
    createdAt: giorniFa(i + 1),
    status: SENZA_CHIAVE,
    clientId: SENZA_CHIAVE,
  }));

  await apriStatistiche(page, { feedbacks, workerLog: [] }, feedbacks);
  await page.locator('[data-fs-range="7g"]').click();

  // La scheda sa già di non saper leggere questi documenti: lo scrive nella
  // divisione per categoria.
  await page.locator('[data-fs-tile="ricevuti"]').click();
  const dettaglio = await testoDi(page, '.mg-fs-detail');
  expect(dettaglio, 'la categoria non dichiara l\'illeggibilità').toContain('Non leggibile con questa chiave');

  // Quello che l'owner deve poter credere: dove il mittente non si legge, la
  // scheda non ne inventa uno. Oggi le tre segnalazioni finiscono su «Utente».
  expect(dettaglio, 'i mittenti illeggibili vengono attribuiti a «Utente»')
    .not.toMatch(/Utente \| 3/);

  // E la pasticca del filtro dice la stessa bugia: «Utente 3» invita a
  // filtrare per un mittente che nessuno ha letto.
  const pasticche = await testoDi(page, '#mgFsCreators');
  expect(pasticche, 'la pasticca «Utente» conta segnalazioni di cui non si conosce il mittente')
    .not.toMatch(/Utente \| 3/);

  // Almeno una riga della scheda deve dire che i mittenti non si sono letti,
  // come già fa per il registro e per le segnalazioni senza data.
  const nota = (await page.locator('#mgFsNota').isVisible())
    ? await testoDi(page, '#mgFsNota')
    : '';
  expect(nota.toLowerCase(), 'nessuna riga avverte che i mittenti non si sono letti')
    .toMatch(/mittent|chiave/);
});
