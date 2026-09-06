# Un mittente nuovo si classifica su DUE assi: da dove viene, e quanto ci si fida

Quando nasce una provenienza nuova di feedback (un prefisso di `clientId`: l'agente
esploratore, i ruoli delle routine, i rilievi residui, la sessione locale di Claude),
ci sono **due domande diverse** e vanno risposte separatamente:

- **Chi l'ha scritto** — serve a LEGGERE la coda: un ritrovamento nato esplorando l'app,
  uno nato scrivendo il codice, uno nato verificando il lavoro di un altro e uno nato in
  chat con l'owner vanno letti in contesti diversi. Qui ogni provenienza è una categoria
  **propria** (`authorKind` in `src/shared/feedbackThread.js` + `AUTHOR_META`/`AUTHOR_RANK`
  in `manage.js`): farla collassare su un'altra cancella l'unica informazione che il
  mittente serve a dare.
- **Quanto ci si fida** — serve a DECIDERE se entra in coda da sola
  (`autoApproveGroup`, specchiato in `filo-security/functions/src/autoApprove.js`) e se è
  un'identità fidata che non va mai flaggata come attacco/spam (`identities.js`). Dal
  2026-08-22 i due assi COINCIDONO per l'ingresso in coda: un interruttore per ogni
  categoria d'autore, sessione locale e istanze cloud comprese. Prima ne bastava uno per
  tutte le istanze di Claude, e non ci si poteva fidare di una senza fidarsi delle altre.

**Regola operativa:** una provenienza nuova aggiunge una categoria d'autore E il suo
interruttore di fiducia — con un test che lo inchioda su entrambi i repo, e ricordando
che costa: voce in `manage.html`, copia sul server, rideploy delle functions. Se per una
volta si sceglie di NON dargliene uno proprio, la motivazione va scritta accanto al
codice e l'etichetta dell'interruttore che la copre deve dire onestamente cosa copre.
Una mappa salvata prima non deve mai riaccendere da sola ciò che l'owner aveva spento:
chi sdoppia un interruttore scrive anche il ripiego sul vecchio.

**Perché il test:** senza, la scelta la fa il `return` in fondo alla funzione — e "è
finita lì da sola" e "l'abbiamo deciso" diventano indistinguibili il giorno dopo.
Precedenti: `routine:residuo` (SPEC-RIDISEGNO-MAX.md §13), `local:` (la sessione locale,
2026-08-22).

**Completezza da non dimenticare:** un mittente che è un processo dell'owner va aggiunto
**anche** alla lista delle identità fidate del backend di sicurezza
(`TRUSTED_CLIENT_RE` in `filo-security/functions/src/data/identities.js`, elencata in
`FEEDBACK-STATES.md` §3). Lasciarlo fuori non dà un errore: dà un rate-limit da spam
nelle giornate di lavoro fitto, e un'identità marcata pericolosa alla prima segnalazione
tecnica letta male — dopo di che tutti i feedback di quel mittente saltano i giudici.

**Dove:** `src/shared/feedbackThread.js` (classificazione pura + gruppi), `manage.js`
(icona, etichetta, ordinamento) e `manage.html` (interruttori). Test:
`tests/unit/feedbackThread.test.mjs`, `tests/unit/autoApprove.test.mjs`,
`tests/manage-author-sort.spec.mjs`, e i gemelli in `filo-security/functions/test/`.
