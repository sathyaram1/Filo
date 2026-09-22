// VERIFICA #496 — giro 19. Senza la chiave dell'owner, un lavoro già chiuso
// viene dichiarato «ancora in mezzo al giro».
//
// Su un computer che non ha la chiave privata, lo stato fine di una
// segnalazione arriva cifrato. La scheda lo sa e lo dice dove divide per
// categoria: la riga si chiama «Non leggibile con questa chiave». Tre
// centimetri più in basso, però, la stessa schermata mette quel lavoro fra
// quelli «ancora in mezzo al giro: quanto costeranno non si sa ancora» — che
// è un'affermazione sullo stato, cioè proprio la cosa che la riga sopra
// dichiara di non saper leggere. E può essere il contrario del vero: l'enum
// grossolano che viaggia IN CHIARO (`statusPublic`) dice che quel lavoro è
// chiuso.
//
// Senza il fix il controllo è rosso: la riga degli esiti conta 1 «ancora in
// mezzo al giro» e da nessuna parte si legge che di quel lavoro lo stato non
// si è potuto leggere.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

// Il prefisso con cui arriva un campo cifrato che questo computer non apre.
const CIFRATO = 'FENC1:' + 'q'.repeat(48);

const DATI = {
  feedbacks: [
    fb({ _id: 'z19-a', seq: 220, status: CIFRATO, statusPublic: 'closed', createdAt: g(6) }),
  ],
  workerLog: [
    { role: 'new-work', startedAt: g(5), num: '220' },
    { role: 'verifier', startedAt: g(4), num: '220' },
  ],
};

test('#496 giro19 — un lavoro con lo stato illeggibile non viene dato per «in mezzo al giro»', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);

  // La scheda sa già di non saper leggere: lo scrive nella divisione per
  // categoria del riquadro «Feedback lavorati».
  await page.locator('[data-fs-tile="lavorati"]').click();
  await expect(page.locator('.mg-fs-detail')).toContainText('Non leggibile con questa chiave');

  const aperti = await page.locator('#mgFsEsiti [data-fs-esito="aperti"] b').innerText();
  // Dove si dichiara cosa entra e cosa resta fuori dal conto: la riga in cima
  // alla scheda e la riga che accompagna la torta.
  const dichiarazioni = (
    (await page.locator('#mgFsNota').innerText().catch(() => ''))
    + ' ' + await page.locator('#mgFsPieHint').innerText()
  ).replace(/\s+/g, ' ');

  const loDichiara = /stato/i.test(dichiarazioni) && /non (si )?legg|illeggibil|chiave/i.test(dichiarazioni);
  const contato = Number(aperti) > 0;
  expect(
    !contato || loDichiara,
    'un lavoro con lo stato cifrato viene dato per «ancora in mezzo al giro» e la sezione della torta non dice che quello stato non si è letto',
  ).toBe(true);
});
