# Errori in chat: mai il messaggio grezzo, sempre una frase + un modo di riprovare

[← Tutti i pattern](../PATTERNS.md)

Una bolla di chat non è un log. Il messaggio di un'eccezione (`fetch failed`,
`OpenRouter 400: …`, `ETIMEDOUT`, uno stack) non dice niente all'utente e lo
lascia bloccato: il dettaglio tecnico va nei log del main, in chat va **cosa non
ha funzionato e cosa fare**.

- **Traduzione unica**: `SN_CHAT_ERRORS` (`src/shared/chatErrors.js`).
  `friendly(err, { dataSource })` ritorna una proposizione con l'iniziale
  minuscola (da incastonare in "Non ha funzionato: …"), `sentence(err, …)` la
  stessa cosa come frase a sé (per chi la mostra da sola nella bolla). Gli errori
  con `code` applicativo (`NO_API_KEY`, `LIMIT_REACHED`) portano già un messaggio
  i18n per l'utente e passano invariati.
- **`dataSource` va passato solo da chi interroga un archivio esterno** oltre al
  servizio AI (es. la chat dei mazzi con Scryfall): serve ad attribuire un errore
  HTTP "nudo". Chi non lo passa ottiene una frase generica — meglio che
  incolpare il servizio sbagliato.
- **Il turno deve catturare**: se l'handler lascia scappare l'eccezione, il
  gestore IPC generico rimanda `e.message` e il grezzo arriva in chat comunque.
  Ogni chat cattura e traduce nel suo handler.
- **Guasti di rete passeggeri si ritentano prima di arrendersi**: la catena dei
  provider (`src/main/services/providers/index.js`) ripete lo stesso tentativo una
  volta dopo una breve pausa quando non è arrivata nessuna risposta HTTP; un
  400/401 non si ritenta mai (tornerebbe identico). In streaming, se dei delta
  erano già usciti si ritenta solo se il chiamante sa azzerare il buffer
  (`onReset`, #273).
- **Se il messaggio dice "riprova", il tasto per riprovare ci deve essere**: la
  bolla d'errore porta un "↻ Riprova" che rimanda lo stesso messaggio senza
  farlo riscrivere (parità col "Riprova" della pagina d'errore di una scheda).
- **Un ostacolo che riprovare non toglie non dice «riprova»**: dice quale modello,
  quale funzione e dove se ne sceglie un altro. Il caso «nessun host ammesso» lo
  riconoscono gli host dichiarati dal catalogo, non il testo del 404 (che il router
  può cambiare), e la frase la compone solo `fraseNessunHost`: chi ha un altro
  motivo o un altro rimedio li passa, senza scriverne una seconda (#828,
  `tests/unit/nessunHostAmmesso.test.mjs`).
- **Una frase che nomina una pagina di Filo porta il tasto per andarci**, su ogni
  superficie: chi la legge da un sito qualunque a Crediti o alle Opzioni non sa
  arrivare. Dove si rimedia lo dice `SN_CHAT_ERRORS.rimedioPagina`; sulle pagine
  web frase e tasto viaggiano insieme da `SN_POPUP.scriviErrore` (riquadri, menu,
  «Modifica») e `SN_POPUP.avvisoErrore` o `showToast(…, { rimedio })` (avvisi, che
  col tasto durano di più e lo offrono anche dal tasto destro). Il tasto in
  evidenza è quello che toglie l'ostacolo; «Riprova» resta, secondario, per
  dopo (#663, #828.1); le chat delle pagine di Filo (home, Editor, mazzi) fanno
  lo stesso coi loro tasti. Sentinella: `tests/unit/rimedioOvunque.test.mjs`,
  prove per superficie in `tests/rimedio-ovunque.spec.mjs`.
- **Una risposta che non arriva non si richiede da sola.** Un riquadro che chiede
  quando si disegna (il «Parere di Filo» dei mazzi) ricorda l'esito mancato col suo
  perché e lo mostra col tasto del rimedio e «Riprova»; senza, ogni ridisegno
  rifaceva la richiesta, centinaia al secondo coi crediti finiti (#1344.1). Anche
  una risposta riuscita ma senza la parte chiesta è un esito mancato, e «Riprova»
  salta la cache, che ridarebbe la stessa risposta.
- **Dove:** chat della home (`src/pages/dashboard/dashboard.js` +
  `src/main/services/handlers/filo.js`), chat dei mazzi
  (`src/main/services/handlers/scryfall.js`), assistente laterale
  (`src/content/sidebar.js`). Test: `tests/unit/chatErrors.test.mjs`,
  `tests/unit/providerNetworkRetry.test.mjs`,
  `tests/dashboard-chat-gap-feedback.spec.mjs`, `tests/verifica/331/verify-331-stress.spec.mjs`.
