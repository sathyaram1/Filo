// Verifica #582, giro 4 — la coda della stessa causa.
//
// I giri 2 e 3 hanno tolto il clic a quello che chi manda la segnalazione
// mette nel documento: la pillola di un allegato non porta più fuori, e
// l'indirizzo della pagina dice dove va. Resta però la PAROLA: davanti a un
// «allegato» che punta al sito di un estraneo — cioè a una cosa che nel
// deposito di Filo non è mai entrata — Filo scrive che è stato consegnato e
// che viaggia cifrato con la chiave di chi riceve le segnalazioni. Non è vero,
// e lo dice di un pezzo di UI costruito da chi ha mandato la segnalazione:
// la pillola finta diventa indistinguibile da una vera, con Filo che la
// avvalora.
//
// La causa sta nell'ordine di due controlli: si guarda prima CHI sta guardando
// e poi DOVE punta l'allegato, quindi a chi non riceve le segnalazioni si
// risponde «consegnato» senza aver mai guardato l'indirizzo.
//
// Questa prova diventa verde quando un indirizzo fuori dal deposito di Filo
// riceve la stessa risposta per tutti: non è un allegato di Filo.

import { test, expect } from '../../fixtures/electron.mjs';

const RIQUADRO = 'filo://feedback/feedback.html';
const ESTRANEO = 'https://sito-di-un-estraneo.invalid/esca.html';
const DENTRO = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1757000000000_11111111-2222-3333-4444-555555555555.txt?alt=media';

test('il canale degli allegati guarda l’indirizzo prima di dire che è consegnato', async ({ openTab }) => {
  const page = await openTab(RIQUADRO);
  const risposte = await page.evaluate(async ({ fuori, dentro }) => {
    // La pagina ha già la sua porta verso il main: la si usa com'è.
    const invia = (msg) => {
      if (window.filo?.message) return window.filo.message(msg);
      return new Promise((res) => window.chrome.runtime.sendMessage(msg, res));
    };
    return {
      fuori: await invia({ type: 'feedback_decrypt_image', url: fuori, mime: 'text/plain' }),
      dentro: await invia({ type: 'feedback_decrypt_image', url: dentro, mime: 'text/plain' }),
    };
  }, { fuori: ESTRANEO, dentro: DENTRO });

  // Dentro il deposito di Filo, a chi non riceve le segnalazioni si dice che
  // l'allegato è consegnato: è vero e serve (giro 3).
  expect(risposte.dentro?.soloDestinatario, 'un allegato vero non si dichiara più consegnato').toBe(true);

  // Fuori dal deposito di Filo, no: quell'allegato non è mai arrivato.
  expect(
    risposte.fuori?.soloDestinatario,
    `Filo dichiara consegnato un allegato che punta fuori dal suo deposito: ${JSON.stringify(risposte.fuori)}`,
  ).not.toBe(true);
});

test('la pillola di un allegato che punta fuori non dice «consegnato»', async ({ openTab }) => {
  const page = await openTab(RIQUADRO);
  await page.evaluate((fuori) => {
    window.SN_FEEDBACK.list = async () => [{
      _id: 'consegnato-582',
      status: 'open',
      name: 'Aggiornamento per i tester',
      text: 'in allegato le istruzioni',
      url: 'https://esempio.invalid/x',
      images: [],
      files: [{ name: 'istruzioni.pdf', url: fuori, type: 'application/pdf' }],
      createdAt: '2026-09-11T10:00:00Z',
    }];
  }, ESTRANEO);
  await page.locator('#refresh').click();
  await expect(page.locator('a.fb-file')).toHaveCount(1, { timeout: 10_000 });
  // Il segnaposto arriva dal main: si aspetta che compaia.
  await page.waitForTimeout(1500);
  const nota = ((await page.locator('a.fb-file .fb-file-note').first().textContent().catch(() => '')) || '').trim();
  expect(
    nota,
    `la pillola di un allegato che sta fuori dal deposito di Filo si dichiara «${nota}»`,
  ).not.toContain('consegnato');
});
