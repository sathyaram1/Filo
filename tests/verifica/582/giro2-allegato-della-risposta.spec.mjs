// Verifica #582, giro 2 — l'altra direzione dello stesso confine.
//
// Il giro 1 ha sistemato il segnaposto di chi MANDA una segnalazione: il suo
// screenshot non lo rivedrà (viaggia cifrato con la chiave di chi riceve) e il
// segnaposto adesso glielo dice invece di parlargli di permessi.
//
// Resta l'altra direzione: l'allegato che viaggia dall'altra parte. Chi riceve
// le segnalazioni risponde e allega un'immagine (un ritaglio di come dovrebbe
// essere, la schermata dell'impostazione da cambiare); il turno della risposta
// finisce nella conversazione del feedback, che l'utente riapre dal riquadro
// delle sue segnalazioni. Quell'immagine è per LUI.
//
// Due cose da distinguere:
//   · l'immagine si vede o no;
//   · se non si vede, il segnaposto dice una cosa vera.
//
// Gli allegati di una RISPOSTA non passano dalla cifratura (solo quelli
// dell'invio lo fanno): dire all'utente che l'allegato «viaggia cifrato con la
// chiave di chi riceve le segnalazioni» su un'immagine che gli hanno mandato
// APPOSTA è una frase sbagliata sopra un'immagine che manca.

import { test, expect } from '../../fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

// Un allegato vero del bucket di Filo, nella forma che il modulo salva.
const ALLEGATO = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1788891497000_3f2a1b0c-1111-4222-8333-444455556666.png?alt=media&token=abc';

test('l’immagine allegata alla RISPOSTA arriva a chi ha segnalato', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  const att = `@@filo-attachment ${JSON.stringify({ kind: 'img', url: ALLEGATO })}`;
  const notes = [
    'Ecco come si fa, te lo segno nell’immagine.',
    att,
  ].join('\n');

  await page.evaluate((fb) => { window.SN_FEEDBACK.list = async () => [fb]; }, {
    _id: 'risposta-582',
    status: 'done',
    text: 'non trovo l’impostazione del tema',
    images: [],
    notes,
    createdAt: new Date().toISOString(),
  });

  await page.locator('[data-tab="resolved"]').click();
  await page.locator('#refresh').click();

  const img = page.locator('.fb-imgs img, .fb-img-broken');
  await expect(img.first()).toBeVisible({ timeout: 10_000 });

  // Quello che conta per l'utente: l'immagine che gli hanno mandato si vede.
  const rotta = page.locator('.fb-img-broken');
  const quante = await rotta.count();
  const motivo = quante ? await rotta.first().getAttribute('title') : '';
  const testo = quante ? await rotta.first().textContent() : '';
  console.log('[giro2] segnaposti:', quante, '| testo:', testo, '| motivo:', motivo);

  expect(quante, `l’immagine della risposta non arriva: «${testo}» — ${motivo}`).toBe(0);
});
