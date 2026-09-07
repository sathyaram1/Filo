# Contare eventi scritti in prosa: il test chiama chi li scrive

[← Tutti i pattern](../PATTERNS.md)

Quando un conteggio si ricava da testo che scrive un ALTRO pezzo di Filo — le
note di lavorazione di un feedback, un report, un changelog — il riconoscitore
e chi scrive sono accoppiati da frasi, non da un campo. Allora lo unit test del
riconoscitore **non ricopia quelle frasi: le fa produrre alla funzione che le
scrive** e le dà in pasto al parser.

- **Perché:** una copia a mano nel test racconta com'era il testo il giorno in
  cui è stato scritto il test. Chi cambia le parole dall'altra parte non ha
  nessun modo di accorgersene: il test resta verde perché verifica il parser
  contro la sua stessa fotografia. Il conteggio, intanto, va a zero — e uno
  zero in un grafico non urla, si legge come «non è successo niente». Lo si
  scopre mesi dopo, guardando una statistica che sembrava plausibile.
  Chiamando il produttore il rosso arriva sulla macchina di chi cambia le
  parole, nel momento in cui le cambia.
- **Il formato vecchio non si butta.** I documenti già scritti restano com'erano:
  il riconoscitore tiene entrambe le forme (quella di oggi e quella storica) e
  il test le prova tutte e due. Ricavare i conti dal testo significa ereditare
  la storia del testo.
- **Meglio ancora sarebbe un campo**, ovviamente: quando il dato esiste come
  campo lo si legge da lì. Questo pattern vale dove il campo non c'è e la
  conversazione è l'unica traccia durevole.
- **Si legge solo la prosa di chi produce l'evento.** La conversazione di un
  feedback la scrivono anche le persone, e una persona può usare le stesse
  identiche parole: «Verifica superata? non mi pare» diventava un lavoro passato
  senza critiche, «Verifica: 2 rilievi ancora aperti» una critica, e finivano
  tutti e due nella torta e nella media. Le note dicono già a chi appartiene ogni
  turno (i marcatori di riapertura e di risposta aprono un turno dell'utente): il
  conteggio salta quei turni e legge il resto. È l'unico modo di distinguerle,
  perché sul testo sono indistinguibili.
- **Le frasi si cercano dove il produttore le SCRIVE, non in tutto il testo.**
  Saltare i turni delle persone chiude metà della porta: l'altra metà è la prosa
  dell'agente stesso, perché chi scrive una critica parla proprio di verifiche.
  «Verifica superata» a inizio riga dentro un rilievo faceva diventare quel giro
  un pass a zero critiche; «il lavoro si ferma», che in italiano si scrive senza
  pensarci («quando il registro non risponde il lavoro si ferma»), lo faceva
  diventare una fermata; una citazione della frase vecchia gli faceva perdere
  anche il conto dei rilievi, da tre a uno. Il produttore scrive una forma
  fissa: riga di apertura, riassunto, riga della decisione, elenco dei rilievi.
  Il riconoscitore legge apertura e decisione ancorate a inizio riga, e taglia
  via l'elenco dei rilievi (`testaNota`). Regola generale: se il produttore ha
  una struttura, il parser la usa; cercare una sottostringa nel blocco intero
  significa dare al testo libero il potere di cambiare i numeri.
- **Un conteggio ricavato così dichiara la sua fonte.** Se la traccia è
  parziale — un registro che tiene solo le esecuzioni recenti, una lista che
  si ferma ai primi N — il numero è un MINIMO, e la superficie che lo mostra lo
  dice accanto al numero invece di lasciarlo leggere come un totale.
- **Dove:** `parseVerifications`/`verificationSummary` in
  `src/shared/feedbackStats.js` (i giri di verifica ricavati dalle note dei
  feedback, #496); i produttori sono `roundNote` in
  `src/shared/verifierRound.js` e `verifierNoteText` in `scripts/dispatch.mjs`.
  Il test che li chiama: `tests/unit/feedbackStats.test.mjs`. La resa a
  schermo di quei conti segue
  [Grafici/chart: SVG generato a mano, niente librerie esterne](grafici-chart-svg-generato-a-mano-niente-librerie-esterne.md).
