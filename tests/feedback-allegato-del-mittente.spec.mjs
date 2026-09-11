// Chi manda una segnalazione con uno screenshot, riaprendola, trova un
// segnaposto al posto dell'immagine: l'allegato viaggia cifrato con la chiave
// di chi riceve le segnalazioni e lui non lo rivedrà. È voluto. Quello che non
// andava era il messaggio, che gli diceva «Operazione riservata agli
// amministratori» e lo mandava a cercare permessi che non avrà mai.
//
// Trovato nella verifica #582, giro 1.
//
// Pre-condizione che senza il fix fallirebbe: il segnaposto diceva «(immagine
// non disponibile)» e l'hover parlava di amministratori. Qui si asserisce che
// dice invece che l'allegato è partito.
//
// Niente finzioni sul canale: la pagina è aperta da un utente NON amministratore
// e la risposta arriva dal main vero. È l'unico modo di provare le due metà
// insieme (il main che distingue il caso, la pagina che lo scrive).

// Gli altri due casi (trovati nella verifica #582, giro 2) riguardano gli
// allegati che immagini non sono, nella stessa bolla:
//   · l'indirizzo di un allegato lo scrive chi manda la segnalazione, e una
//     segnalazione la manda chiunque senza account: se diventa un collegamento
//     cliccabile, una segnalazione con un finto allegato «schermata.png» che
//     punta al sito di un estraneo è un'esca dentro una pagina di Filo, davanti
//     a ogni tester che apre l'elenco;
//   · il documento che il mittente ha allegato parte cifrato come lo screenshot,
//     quindi il collegamento diretto ai byte gli consegnava un file col nome
//     giusto e il contenuto illeggibile, senza dire niente.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

// Un allegato del bucket di Filo, nella forma esatta che il modulo dei feedback
// salva nella segnalazione. Non verrà mai scaricato: il main si ferma prima,
// perché chi guarda non è amministratore.
const ALLEGATO = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1788891497000_3f2a1b0c-1111-4222-8333-444455556666.png?alt=media&token=abc';

test('il mittente vede che il suo screenshot è partito, non un errore di permessi', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  await page.evaluate((url) => {
    window.SN_FEEDBACK.list = async () => [{
      _id: 'mittente-582',
      status: 'open',
      text: 'il tasto salva non risponde',
      images: [url],
      createdAt: new Date().toISOString(),
    }];
  }, ALLEGATO);

  await page.locator('#refresh').click();

  const segnaposto = page.locator('.fb-img-broken');
  await expect(segnaposto).toHaveText('(allegato inviato)', { timeout: 10_000 });

  // L'hover dice perché, e non manda a cercare permessi di amministratore.
  const motivo = await segnaposto.getAttribute('title');
  expect(motivo).toMatch(/inviat/i);
  expect(motivo).not.toMatch(/amministrat/i);
  expect(motivo).not.toMatch(/riservata/i);
});
