# Una scansione chiede i campi che usa, e si paga una volta

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Chi legge una collezione intera dichiara i campi che gli servono,
chiede al server di contare invece di scaricare per contare, dice a chi lo lancia
quanti documenti ha letto, e non rilegge in un minuto (o in cinque) quello che ha
già in mano.

## Il caso

Gli script di manutenzione dei feedback scaricavano l'intera collezione, documenti
interi, anche quando guardavano tre campi. Un feedback pesa qualche KB — testo
cifrato, note, allegati — e i campi che una decisione di manutenzione legge stanno
in duecento byte. Lanciati due o tre volte nello stesso pomeriggio (prova a secco,
applicazione, controllo) su settecento segnalazioni facevano una raffica: a
settembre 2026 un solo giorno ha fatto il 40% del conto mensile di Firestore, e il
riordino della numerazione del 18/09 è il candidato. Lo stesso pomeriggio, la
configurazione delle routine veniva riletta dal server a ogni invocazione di
dispatch e di verify-local: decine di letture per sessione, per nove sessioni, per
una risposta che cambia quando l'owner tocca un interruttore.

## Le quattro mosse

1. **I campi.** `select` (structuredQuery), `mask.fieldPaths` (REST), `fields:`
   (le liste di `SN_FEEDBACK`). L'elenco dei campi vive accanto alla decisione che
   li legge — `SN_BOARD_ARCHIVE.CAMPI_DECISIONE`, `SN_FEEDBACK.CAMPI_LISTA`,
   `SN_FEEDBACK_PUBLIC_VIEW.CARD_FIELDS` — non copiato nello script: un campo
   nuovo letto dalla decisione e dimenticato nello script arriverebbe sempre
   assente, senza errore.
2. **Il conteggio.** «Quanti sono?» si chiede con `runAggregationQuery`: costa una
   lettura ogni mille documenti, contro una a testa. Se i conti dicono che non c'è
   niente da fare, la scansione non si fa. Se il server non sa contare si torna
   alla scansione **dichiarandolo**, non in silenzio.
3. **Il costo a schermo.** L'ultima riga dice quanti documenti sono stati letti.
   Chi lancia il comando vede il prezzo subito, non in fattura.
4. **Una volta per giro.** La prova a secco mette da parte quello che ha letto;
   l'applicazione che la segue lo riusa e lo dice. Una prova a secco invece **non**
   riusa niente: chi la lancia vuole vedere il database di adesso.

## Quello che il database non sa filtrare

Filtrare lato server abbassa il numero di documenti letti, che è la voce che si
paga. Ma due filtri che sembrerebbero ovvi non si possono scrivere:

- **«solo quelli senza numero»** (il riordino della numerazione): Firestore non
  indicizza i campi assenti, quindi nessun filtro seleziona i documenti a cui
  manca `seq`. Il rimedio è il conteggio: se i numerati sono quanti i totali, non
  c'è niente da numerare e la collezione non si tocca.
- **«solo i risolti»** (l'archiviazione automatica): l'unico campo sempre in
  chiaro che distingue un chiuso è `statusPublic`, e i documenti più vecchi della
  sua introduzione non l'hanno. Filtrarci sopra li lascerebbe fuori dal verdetto —
  un taglio silenzioso su una decisione, non su un elenco. Restano la proiezione e
  il conteggio.

## Una copia in una cartella di tutti si difende da sola

La copia vive in `os.tmpdir()`, che su Mac e Linux è di tutti, e il suo nome è
l'impronta di una chiave che chiunque può ricavare. Chi crea quella cartella per
primo deciderebbe due cose: cosa ci troviamo dentro (per le routine sarebbero i
bilanci del giro e l'interruttore che le accende) e dove finisce quello che
scriviamo, se al posto del file lascia un rimando. Quindi:

- la cartella si crea `0700`; se esiste ed è di qualcun altro, o è un rimando, la
  copia non si fa e si rilegge dal server; se è nostra ma aperta (l'ha lasciata
  così una versione di prima) si chiude, invece di smettere di funzionare zitta;
- i file si aprono con `O_NOFOLLOW`, in lettura e in scrittura, e si scartano se
  non sono nostri o sono leggibili da altri;
- su Windows niente di tutto questo serve e `O_NOFOLLOW` non esiste: `%TEMP%` sta
  già dentro il profilo dell'utente. Il ramo di piattaforma è scritto intero.

Una copia rifiutata non è un errore: chi legge torna al server, come quando la
copia è scaduta.

## Dove vive

`scripts/lib/copia-su-file.mjs` (la copia con scadenza),
`scripts/lib/scansione-secco.mjs` (prova a secco → applicazione, una volta sola),
`scripts/lib/config-routine-copia.mjs` (la configurazione delle routine, un
minuto, condivisa fra dispatch e verify-local),
`scripts/lib/firestore-conta.mjs` (il conteggio),
`scripts/lib/letture.mjs` (la riga del costo).

Le sentinelle: `tests/unit/letturePerCampi.test.mjs` diventa rossa su una
scansione in `scripts/` che non dice quali campi le servono — per chiamata, non
per file, così uno script che altrove passa i campi non assolve la scansione che
li ha dimenticati, e su OGNI `list…` del modulo, non su un elenco di nomi: con
l'elenco, `listAll` e `listAllPublicPaged` passavano davanti senza una parola.
`tests/unit/copiaSuFile.test.mjs` tiene le regole della copia: fresca risponde,
scaduta o illeggibile no, dopo un'applicazione si butta, e quello che qualcun
altro ha preparato nella cartella temporanea non si legge né si riscrive.

Vicino: [Una pagina dei più recenti non è «tutto»](una-pagina-dei-piu-recenti-non-e-tutto.md)
— lì il difetto è l'opposto e la cura si incontra a metà: si leggono tutte le
righe, ma non tutti i campi.
