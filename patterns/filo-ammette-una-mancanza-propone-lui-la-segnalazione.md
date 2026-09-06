# Filo ammette una mancanza → propone lui la segnalazione, non la chiede

Quando l'agente risponde "non lo so fare / non ho accesso a quel dato", il buco
non deve morire lì: nella **stessa risposta** compare una segnalazione **già
scritta**, e il popup di conferma si apre **da solo** con il testo per intero
(azione `INVIA_FEEDBACK`, livello 2 → niente parte senza l'OK dell'utente).

- **Deterministico, non affidato al prompt**: il prompt lo chiede al modello, ma
  l'invariante è garantito nel main (`maybeProposeFeedbackAction` in
  `src/main/services/handlers.js`) analizzando la risposta con
  `SN_AUTO_FEEDBACK.analyzeReply` + `composeProposal`.
- **Due canali distinti, mai insieme**: la segnalazione **proposta** cita le
  parole dell'utente (le legge prima di autorizzarla, ed è ciò che la rende
  utile); quella **anonima automatica** resta generica come prima. Se in un turno
  compare la proposta, l'anonima non parte: una sola segnalazione per lo stesso
  buco.
- **Non insistere**: una proposta per conversazione, e nessuna sui turni di
  prosecuzione automatica (il "messaggio utente" lì è un nudge interno, non una
  richiesta: il client li marca `internal: true`).
