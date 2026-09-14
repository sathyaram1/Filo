// Verifica #583, giro 9 — il codice di scarico è la chiave, e va chiesto da
// TUTTE le parti che caricano un allegato.
//
// IL CASO
//   La correzione del giro 8 nega il `get` sugli allegati: da lì in poi un
//   indirizzo senza codice di scarico non apre più niente, nemmeno al main di
//   chi i feedback li lavora. Perché quella chiusura non si porti via degli
//   allegati in silenzio, chi carica deve pretendere il codice invece di
//   costruire il link lo stesso omettendolo. In `src/shared/feedback.js` —
//   la strada di chi manda un feedback dall'app — adesso è così: senza codice
//   il caricamento rifiuta e chi invia si ritrova il nome del file fra quelli
//   non caricati.
//
//   Nel repo però i posti che costruiscono quel link sono DUE, e il secondo è
//   rimasto com'era: lo strumento che spedisce nella stessa collezione le cose
//   trovate dagli agenti che girano per Filo (`npm run test:explore`), con lo
//   screenshot allegato. Lì il link si costruisce ancora senza il codice se il
//   deposito non lo rilascia, e non lo dice a nessuno: l'errore che quello
//   strumento intercetta è il caricamento fallito, non il codice mancante.
//   L'effetto è quello che la correzione voleva evitare, su un'altra porta:
//   la segnalazione arriva, la fotografia che la spiegava no, e lo si scopre
//   settimane dopo aprendo il feedback e trovando un buco.
//
//   Le due strade sono gemelle e devono chiedere la stessa cosa. È una riga.
//
// OGGI QUESTA PROVA È ROSSA sulla metà dello strumento degli agenti.

import { test, expect } from './../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Il link di un allegato, come lo costruisce il sorgente: la riga che mette
// insieme `?alt=media` e il codice. Ne basta la forma per dire se il codice è
// obbligatorio o un ornamento: `token=${x}` senza scampo, oppure un
// `${token ? … : ''}` che lo salta quando non c'è.
function righeDelLink(testo) {
  return testo.split('\n').filter((r) => r.includes('alt=media'));
}

test('chi manda un feedback dall\'app non riceve mai un link senza il codice', async ({ app, shell }) => {
  void app; void shell;
  const src = readFileSync(join(ROOT, 'src', 'shared', 'feedback.js'), 'utf8');

  // Il caricamento si ferma prima di consegnare un link morto.
  expect(/if\s*\(\s*!token\s*\)/.test(src),
    'il caricamento dell\'app non controlla più che il codice di scarico ci sia').toBe(true);

  for (const riga of righeDelLink(src)) {
    expect(/token\s*\?/.test(riga),
      `il link dell'app salta il codice quando manca: ${riga.trim()}`).toBe(false);
  }
});

test('anche lo strumento degli agenti pretende il codice di scarico', async ({ app, shell }) => {
  void app; void shell;
  const src = readFileSync(join(ROOT, 'tests', 'agent', 'feedback.mjs'), 'utf8');
  const righe = righeDelLink(src);
  expect(righe.length, 'lo strumento degli agenti non costruisce più link di allegati').toBeGreaterThan(0);

  for (const riga of righe) {
    expect(/token\s*\?/.test(riga), [
      'Lo strumento che spedisce nella collezione dei feedback le cose trovate dagli agenti',
      'costruisce ancora il link dell\'allegato senza il codice di scarico quando il deposito',
      'non lo rilascia. Con il `get` chiuso dal giro 8 quel link non apre più niente:',
      'la segnalazione arriva senza la fotografia che la spiegava, e nessuno se ne accorge.',
      `Riga: ${riga.trim()}`,
    ].join(' ')).toBe(false);
  }
});
