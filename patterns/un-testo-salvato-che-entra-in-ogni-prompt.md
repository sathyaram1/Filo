# Un testo salvato che entra in ogni prompt

[← Tutti i pattern](../PATTERNS.md)

Una frase che un modello può salvare e che poi rientra in ogni conversazione
trasforma un inganno di un turno in un comando permanente. Nel #592 era lo stile
dell'agente: testo libero, nessun tetto, impostabile dal modello senza chiedere,
e accodato in fondo al messaggio di sistema come istruzione «richiesta
dall'utente», cioè dopo le regole che dicono cosa non è un ordine. Bastava che
una pagina convincesse il modello a «salvarlo come preferenza».

Le sorelle dello stile sono le lezioni che Filo si fissa (SALVA_LEZIONE) e i
moduli di memoria in cui finiscono (profilo, preferenze apprese): stessa
portata, stesse regole.

Valgono insieme queste regole:

- **Se lo propone il modello, l'utente conferma il testo esatto.** Livello 2, e
  il popup mostra il testo per intero, non «stile aggiornato». Si mostra e si
  salva quello che si legge (`testoLeggibile`): via ogni carattere che non si
  disegna (i «tag» Unicode il modello li legge come lettere) e le righe vuote
  in fila, che spingerebbero il resto oltre il bordo del popup. Vuota è la riga
  in cui niente si disegna, non quella senza caratteri: una riga di soli spazi a
  larghezza zero o giuntori a schermo è bianca. Anche toglierlo passa dal popup:
  si perde il testo dell'utente.
- **Si conferma quello che si è visto.** La pulizia dei caratteri non basta da
  sola: tre giri di verifica di fila hanno spinto l'istruzione sotto il bordo
  con righe vuote, poi di spazi a larghezza zero, poi di righe innocue o di un
  simbolo che il font disegna vuoto. La regola sta sul riquadro: se il testo non
  ci sta, OK resta grigio finché non lo si fa scorrere fino in fondo, e un clic
  su OK grigio porta avanti il testo di una pagina invece di non rispondere; nelle
  Preferenze il riquadro dello stile cresce col testo. Il popup non si mangia i
  tasti battuti per la chat: finiscono nel campo, e alla chiusura il fuoco
  torna lì.
- **All'OK vale quello che il popup ha mostrato.** Una conferma su un elenco
  (righe da dimenticare, sveglie da togliere) agisce su quelle voci, non su
  quelle che lo stesso riferimento trova al momento dell'OK.
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
- **Resta visibile e cancellabile** dove l'utente lo cerca: lo stile nel suo
  riquadro, la memoria riga per riga nelle Preferenze («Memoria di Filo»),
  con canali solo per le pagine di Filo.

Le lezioni che Filo si scrive da solo dopo ogni scambio non passano dal popup
(sarebbe un popup a ogni risposta): per loro valgono il tetto, il recinto e la
pagina che le mostra. La memoria sta nella parte variabile del prompt, dopo le
regole anti-inganno, per non rompere il prefisso comune (#422): le regole la
nominano, e il recinto le toglie l'autorità di un ordine.

Dove: `stile_agente` e `lezioneDaAzione` in `src/shared/preferences.js`,
`memoriaImbustata` e `MEMORIA_FILO` accanto allo stile, `testoLeggibile`,
`injectAgentStyle` e `INIZIO_ANTI_INGANNO` in `src/shared/constants.js`,
`STILE_UTENTE` in `src/shared/contenutoEsterno.js`, `bersagliMostrati` in
`src/main/services/handlers.js`. Sentinelle in
`tests/unit/preferences.test.mjs` (ogni setter a testo libero è confermato e
con tetto, o dichiara di non finire in un prompt) e
`tests/unit/stileAgentePrompt.test.mjs` (nessuna frase anti-inganno prima dello
stile, in nessun prompt che lo riceve).
