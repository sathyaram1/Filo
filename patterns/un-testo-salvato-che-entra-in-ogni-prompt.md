# Un testo salvato che entra in ogni prompt

[← Tutti i pattern](../PATTERNS.md)

Una frase che un modello può salvare e che poi rientra in ogni conversazione
trasforma un inganno di un turno in un comando permanente. Nel #592 era lo stile
dell'agente: testo libero, nessun tetto, impostabile dal modello senza chiedere,
e accodato in fondo al messaggio di sistema come istruzione «richiesta
dall'utente», cioè dopo le regole che dicono cosa non è un ordine. Bastava che
una pagina convincesse il modello a «salvarlo come preferenza».

Valgono insieme quattro cose:

- **Se lo propone il modello, l'utente conferma il testo esatto.** Livello 2, e
  il popup mostra il testo per intero (via i caratteri invisibili che lo
  travestirebbero), non «stile aggiornato». Anche toglierlo passa dal popup: si
  perde il testo dell'utente.
- **Un tetto dichiarato, e oltre si rifiuta dicendolo.** Mai un taglio: il
  modello riceve il perché, il diario lo mostra, la pagina Preferenze tiene il
  testo nel campo, dice quanto è lungo e non lo salva finché non si accorcia.
- **Nel prompt entra imbustato e prima delle regole anti-inganno.** Busta di
  `SN_ESTERNO` (il contenuto non può chiuderla da sé), e un'intestazione che
  dice cosa può decidere: la forma delle risposte, mai cosa fa l'agente. Le
  regole anti-inganno chiudono la parte fissa del prompt, quindi il prefisso
  comune resta quasi intero (#422). L'ancora è per azione: nel messaggio di
  sistema dell'editor c'è il documento dell'utente, che può avere un titolo
  qualunque.
- **Resta visibile e cancellabile** dove l'utente lo cerca.

Dove: `stile_agente` in `src/shared/preferences.js`, `injectAgentStyle` e
`INIZIO_ANTI_INGANNO` in `src/shared/constants.js`, `STILE_UTENTE` in
`src/shared/contenutoEsterno.js`. Sentinelle in
`tests/unit/preferences.test.mjs` (ogni setter a testo libero è confermato e
con tetto, o dichiara di non finire in un prompt) e
`tests/unit/stileAgentePrompt.test.mjs` (nessuna frase anti-inganno prima dello
stile, in nessun prompt che lo riceve).
