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
li ha dimenticati. `tests/unit/copiaSuFile.test.mjs` tiene le regole della copia:
fresca risponde, scaduta o illeggibile no, e dopo un'applicazione si butta.

Vicino: [Una pagina dei più recenti non è «tutto»](una-pagina-dei-piu-recenti-non-e-tutto.md)
— lì il difetto è l'opposto e la cura si incontra a metà: si leggono tutte le
righe, ma non tutti i campi.
