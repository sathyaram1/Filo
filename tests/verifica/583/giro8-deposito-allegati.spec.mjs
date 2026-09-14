// Verifica #583, giro 8 — il deposito degli allegati: chiuso l'elenco, il
// singolo file resta aperto a chiunque.
//
// COSA HO TROVATO
//   Questo lavoro ha preso in mano le regole del deposito e ha chiuso metà
//   porta: l'ELENCO degli allegati non si chiede più (era la strada per
//   portarsi via i nomi di tutti i file mai caricati). L'altra metà è rimasta
//   spalancata: `allow get: if true`. Chi ha l'indirizzo di un allegato se lo
//   scarica, senza credenziali e — l'ho provato sul deposito vero — anche con
//   un gettone SBAGLIATO, perché con quella riga il gettone non lo guarda
//   nessuno.
//
//   La motivazione scritta accanto alla regola («i link della dashboard
//   portano già il loro token di download») è proprio il motivo per cui quella
//   riga non serve a chi ha diritto di leggere: se il link porta il gettone, il
//   gettone è ciò che apre il file, non la regola.
//
//   Il danno non è teorico e non si chiude da sé col tempo. Gli indirizzi degli
//   allegati stavano DENTRO i documenti dei feedback, che fino a questo lavoro
//   si leggevano senza nessuna credenziale: chiunque li abbia raccolti in
//   questi mesi continua a scaricarsi gli screenshot dei tester per sempre. La
//   cura di serie per un link scappato è cambiare il gettone del file; con
//   `get: if true` cambiare il gettone non serve a niente, perché il file si
//   prende lo stesso col solo indirizzo. Le due cose vanno fatte insieme.
//
//   Seconda porta nello stesso blocco: il permesso di SCRITTURA non chiede che
//   il file non ci sia già. Chi conosce l'indirizzo di un allegato può
//   RISCRIVERLO con un file suo (fino a 4 MB, dei tipi ammessi): lo screenshot
//   che il tester ha mandato diventa quello che decide un estraneo. Non l'ho
//   provato: sarebbe una scrittura sul deposito vero di chi usa Filo.
//
// PERCHÉ È UNA PROVA E NON UNA CHIACCHIERATA
//   Le regole del deposito si provano davvero solo con l'emulatore ufficiale
//   (Java, un servizio da avviare). Qui si rilegge il FILE che si pubblica, in
//   millisecondi, ed è lo stesso mestiere della sentinella già accesa in
//   tests/unit/firestoreRulesFeedbackRead.test.mjs, che però oggi mette per
//   iscritto il contrario («Il singolo `get` resta aperto»).
//
// COM'È FINITA (stesso giro, dopo la correzione)
//   La prima prova era rossa ed è diventata verde: il `get` è negato, quindi
//   l'unica chiave di un allegato torna a essere il codice di scarico nel link.
//   Provato con l'emulatore ufficiale di Storage prima di chiudere, perché
//   chiudere alla cieca avrebbe spento le immagini in dashboard: con
//   `get: if false` il link col codice risponde 200, il solo indirizzo 403, un
//   codice sbagliato 403.
//
//   La seconda (riscrivere l'allegato di un altro) è rimasta aperta: il server
//   l'ha tenuta fuori da questo giro e la apre come feedback a sé. È segnata
//   `fixme` apposta — la memoria del giro resta, senza far credere a chi
//   verifica dopo di aver trovato una regressione.

import { test, expect } from './../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Il corpo di un blocco `match <percorso> { … }`, contando le graffe: dentro
// ci sono condizioni su più righe, e una regex che si ferma alla prima
// parentesi chiusa leggerebbe mezzo blocco (un test che vede mezzo file passa
// sempre).
function blocco(testo, percorso) {
  const apre = testo.indexOf(`match ${percorso} {`);
  if (apre < 0) return null;
  const i = testo.indexOf('{', apre + `match ${percorso}`.length);
  let livello = 0;
  for (let j = i; j < testo.length; j += 1) {
    if (testo[j] === '{') livello += 1;
    else if (testo[j] === '}') {
      livello -= 1;
      if (livello === 0) return testo.slice(i + 1, j);
    }
  }
  return null;
}

test('un allegato di un feedback non si scarica col solo indirizzo', async ({ app, shell }) => {
  void app; void shell;
  // Il blocco si chiama `/feedback/{file}` da quando #582 ha ristretto la
  // scrittura a un solo segmento (le sottocartelle cadono nel diniego finale).
  // La forma larga si cerca lo stesso: se tornasse, queste asserzioni devono
  // girare su QUELLA invece di non trovare niente.
  const corpo = bloccoFeedback();
  expect(corpo, 'blocco /feedback delle storage.rules non letto').toBeTruthy();

  // L'elenco: questa metà il lavoro l'ha chiusa, e deve restare chiusa.
  expect(/allow\s+list\s*:\s*if\s+false/.test(corpo)).toBe(true);

  // Il singolo file: `if true` vuol dire «chiunque, senza niente in mano
  // tranne l'indirizzo». Gli indirizzi sono stati pubblici per mesi.
  const getAperto = /allow\s+(get|read)\s*:\s*if\s+true\s*;/.test(corpo);
  expect(getAperto, [
    'Gli allegati dei feedback si scaricano ancora col solo indirizzo.',
    'Gli indirizzi stavano dentro i documenti che fino a oggi chiunque poteva leggere,',
    'quindi chi li ha raccolti continua a prendersi gli screenshot dei tester per sempre,',
    'e cambiare il gettone del file — la cura di serie — non lo ferma.',
  ].join(' ')).toBe(false);
});

// Difetto noto, fuori da questo giro: il server l'ha messo da parte e lo apre
// come feedback a sé. Resta scritto qui perché la porta è la stessa della prova
// sopra (l'indirizzo come unica chiave), e chi la chiuderà trova già il caso.
test.fixme('un allegato già caricato non si può riscrivere da fuori', async ({ app, shell }) => {
  void app; void shell;
  // Il blocco si chiama `/feedback/{file}` da quando #582 ha ristretto la
  // scrittura a un solo segmento (le sottocartelle cadono nel diniego finale).
  // La forma larga si cerca lo stesso: se tornasse, queste asserzioni devono
  // girare su QUELLA invece di non trovare niente.
  const corpo = bloccoFeedback();
  expect(corpo, 'blocco /feedback delle storage.rules non letto').toBeTruthy();

  // Caricare un allegato nuovo è anonimo per scelta: un feedback si manda
  // senza login. Riscrivere quello di un ALTRO no — e per distinguere i due
  // casi la regola deve dire che al suo posto non c'era già qualcosa.
  const soloNuovi = /resource\s*==\s*null/.test(corpo);
  expect(soloNuovi, [
    'Chi conosce l\'indirizzo di un allegato può sostituirlo con un file suo:',
    'lo screenshot mandato da chi ha segnalato diventa quello che sceglie un estraneo.',
  ].join(' ')).toBe(true);
});
