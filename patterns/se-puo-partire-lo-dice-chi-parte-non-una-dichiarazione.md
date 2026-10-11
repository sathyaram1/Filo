# Se può partire lo dice chi parte, non una dichiarazione a parte

[← Tutti i pattern](../PATTERNS.md)

«Filo è pronto?» si decideva guardando il campo `provider` della configurazione
condivisa e cercando una chiave intestata a quel nome. Il fornitore lì dentro
era rimasto Gemini, uscito da Filo il 4 settembre 2026; la chiave vera è di
OpenRouter, e ogni voce del registro dei modelli dichiara OpenRouter per conto
suo. Le chiamate funzionavano. Il controllo di prontezza no, e con lui si
spegnevano l'intervista di accoglienza del primo avvio e la home su misura. Per
settimane nessuno se n'è accorto, perché l'unica cosa visibile era un'assenza
(#663, trovato al sesto giro di verifica di un altro lavoro).

- **Regola:** un controllo che decide se qualcosa può partire interroga la
  STESSA strada che poi parte. Non un campo che la descrive, non una copia
  aggiornata a mano. Se la richiesta vera costruisce una catena di tentativi, la
  domanda è «questa catena è vuota?», e la lista dei fornitori che le due cose
  leggono è una sola costante condivisa.
- **Due dichiarazioni sulla stessa cosa divergono sempre**, e chi le tiene
  allineate è una persona che si dimentica. Quando ne trovi due, quella che
  comanda dev'essere quella che il codice usa davvero; l'altra o sparisce o
  resta come etichetta senza potere.
- **Un'assenza non è un messaggio.** Se la risposta è «non posso», l'utente deve
  leggerlo dove sta guardando, con il motivo giusto: mandare a riscattare un
  invito chi i crediti ce li ha già è peggio del silenzio. Vicino:
  [Un controllo che RIFIUTA non rifiuta mai in silenzio](un-controllo-che-rifiuta-non-rifiuta-mai-in-silenzio.md).
- **Quello che calcoli in assenza di una capacità va marcato.** La home
  costruita senza AI finiva nella stessa cache di quella vera: tornata la
  chiave, continuava a servirla. La voce in cache dice ora `noAi: true`, e
  quella voce non si riserve mai quando Filo può di nuovo rispondere.
- **La capacità che torna sveglia chi aspettava.** L'accesso già riapriva
  l'accoglienza rimasta in attesa; i crediti no, e chi entrava con un invito la
  vedeva solo alla scheda dopo. Ogni evento che rende Filo capace di rispondere
  chiama lo stesso risveglio.
- **Censisci le sorgenti, non i casi che ti vengono in mente.** Se l'avviso
  parte solo quando la capacità CAMBIA, una sorgente dimenticata non perde un
  caso: fa mentire il conto da lì in avanti, e l'avviso non parte più in
  nessuna direzione. Le sorgenti della prontezza di Filo sono tre — le
  impostazioni, la configurazione condivisa e il portafoglio, dove vive la
  chiave di chi entra con un invito — e la terza non passa dalle prime due.
  L'avviso si chiama dal punto in cui il dato cambia, non dal chiamante di
  turno, che si dimentica.
- **Dove:** `canServeAction` e `PROVIDER_ORDER` in `src/shared/constants.js`,
  usati da `gatherDashboardInputs`/`buildAttemptChain`
  (`src/main/services/handlers.js`), dalla porta dell'accoglienza
  (`src/main/services/handlers/filo.js`) e dal risveglio su `CREDITS_CHANGED`
  (`src/pages/dashboard/dashboard.js`). Test
  `tests/unit/filoPronto.test.mjs` (sentinella compresa: nessun cammino di
  prontezza torna a leggere `apiKeys[settings.provider]`) e
  `tests/onboarding-fornitore-ritirato.spec.mjs`.
