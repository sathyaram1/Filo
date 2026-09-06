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
- **Dove:** chat della home (`src/pages/dashboard/dashboard.js` +
  `src/main/services/handlers/filo.js`), chat dei mazzi
  (`src/main/services/handlers/scryfall.js`), assistente laterale
  (`src/content/sidebar.js`). Test: `tests/unit/chatErrors.test.mjs`,
  `tests/unit/providerNetworkRetry.test.mjs`,
  `tests/dashboard-chat-gap-feedback.spec.mjs`, `tests/verify-331-stress.spec.mjs`.
