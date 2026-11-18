# Filo ammette una mancanza → propone lui la segnalazione, non la chiede

[← Tutti i pattern](../PATTERNS.md)

Quando l'agente risponde "non lo so fare / non ho accesso a quel dato", il buco
non deve morire lì: nella **stessa risposta** compare una segnalazione **già
scritta**, e il popup di conferma si apre **da solo** con il testo per intero
(azione `INVIA_FEEDBACK`, livello 2 → niente parte senza l'OK dell'utente).

- **Deterministico, non affidato al prompt**: il prompt lo chiede al modello, ma
  l'invariante è garantito nel main (`maybeProposeFeedbackAction` in
  `src/main/services/osservazioniPerModello.js`) analizzando la risposta con
  `SN_AUTO_FEEDBACK.analyzeReply` + `composeProposal`.
- **Solo su una richiesta** (#2348): se il messaggio dell'utente riflette o
  discute senza chiedere di fare o sapere qualcosa, niente proposta e niente
  invio. Una voce del manifesto non è mai «non disponibile», e una voce che ha
  uno strumento della chat (mappa `STRUMENTO` del manifesto) non è mai «non sa
  azionare»: lì doveva usarlo il modello. La proposta nomina la funzione.
- **L'assistente la vede** (#2371): nel registro la proposta e l'invio
  automatico portano l'autore «segnalazione automatica», il clic di conferma
  l'autore «utente»; il testo arriva intero al turno dopo.
- **L'anonima una volta sola** per voce e per versione di Filo, con un conto su
  disco (`src/main/services/autoFeedbackInviati.js`).
- **Due canali distinti, mai insieme**: la segnalazione **proposta** cita le
  parole dell'utente (le legge prima di autorizzarla, ed è ciò che la rende
  utile); quella **anonima automatica** resta generica come prima. Se in un turno
  compare la proposta, l'anonima non parte: una sola segnalazione per lo stesso
  buco.
- **Non insistere**: una proposta per conversazione, e nessuna sui turni di
  prosecuzione automatica (il "messaggio utente" lì è un nudge interno, non una
  richiesta: il client li marca `internal: true`).
