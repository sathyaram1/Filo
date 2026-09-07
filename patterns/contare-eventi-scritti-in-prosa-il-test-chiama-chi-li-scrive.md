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
