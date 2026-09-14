# Un permesso si concede col verbo stretto: `read` è anche `list`

[← Tutti i pattern](../PATTERNS.md)

Nelle regole di Firebase i verbi grossi sono contenitori. `read` vuol dire
`get` **e** `list`; `write` vuol dire `create`, `update` **e** `delete`. Chi
scrive `allow read` pensando «che si veda l'immagine» ha anche detto «e che si
possa chiedere l'elenco di tutte le altre». Chi scrive `allow write` pensando
«che si possa caricare» ha anche detto «e sovrascrivere quelle di prima, e
cancellarle».

Il caso (audit pre-alpha, #582). Gli allegati dei feedback — gli screenshot
dello schermo dei tester — stavano su `feedback/{file=**}` con `allow read: if
true` e una `allow write` che guardava solo dimensione e content-type. Le tre
conseguenze non erano tre bug: era lo stesso bug letto tre volte.

- Con `list`, il nome del deposito (che sta nel repo, accanto alla chiave web)
  bastava a farsi dare tutti i nomi e a scaricarli uno dopo l'altro. Non
  serviva conoscere nessun feedback: il deposito rispondeva da solo.
- Con `update`, chi conosceva il nome di un allegato ci scriveva sopra — uno
  screenshot sostituito dopo che il giudice l'ha visto.
- E un deposito aperto in lettura è hosting gratuito sul progetto di qualcun
  altro.

**La regola: concedi il verbo più stretto che serve, e scrivi cosa NON
concedi.** `allow get` dove serve aprire un oggetto; `allow create` dove serve
caricarne uno nuovo; `list` lasciato fuori, per tutti, perché la dashboard
apre gli allegati che il documento nomina e non ha mai bisogno dell'elenco.
Un permesso che nessuno usa non è gratis: è una porta aperta che nessuno sta
guardando. Il «solo in creazione» si scrive `resource == null`, che è anche ciò
che rende impossibile la cancellazione (in una `delete` `resource` c'è).

**Il secondo mezzo passo: se il percorso è un segreto, pretendilo.** Chiudere
la lettura non serve a niente se il nome si indovina. Il nome di un allegato
porta un uuid e le regole lo ESIGONO con una `matches()` — la stessa forma che
genera `SN_FEEDBACK.attachmentPath` (`src/shared/feedback.js`), con una
sentinella negli unit test che confronta i due e diventa rossa se divergono.
Il giorno che il codice cambia il nome e le regole non lo sanno, non si carica
più niente: meglio saperlo dal test che dagli utenti.

**Un link con un token è una credenziale, non un indirizzo.** Chiuse le regole,
resta sempre una strada che le scavalca per costruzione: i download URL di
Storage (`?alt=media&token=…`) valgono per chiunque li abbia, ed è il loro
mestiere — servono al server dei giudici, che l'immagine la passa a un modello
con ingresso visivo. Quindi il confine non finisce nelle regole del deposito:
continua dove quel link è scritto, cioè nel documento del feedback. **Chiudere
metà confine e dichiararsi a posto è il modo tipico di non chiudere niente**:
l'altra metà si nomina, e se è di un altro lavoro lo si dice.

Dove vive: `storage.rules`, con la sentinella
`tests/unit/storageRulesAllegati.test.mjs` (rilegge il file che si deploya, in
millisecondi) e la prova col motore vero
`tests/rules/storage-allegati-motore-vero.mjs` (emulatori ufficiali, si lancia
a mano: ha in testa le istruzioni). E ricordati che **una regola cambia solo
quando la pubblichi**: finché `firebase deploy --only storage:rules` non gira,
la porta in produzione è quella di prima.

Vicino: [«Sei loggato» non è un permesso](sei-loggato-non-e-un-permesso.md) —
l'altra metà di come si legge una regola: il verbo dice *cosa*, la condizione
dice *chi*, e «autenticato» non è un chi.
