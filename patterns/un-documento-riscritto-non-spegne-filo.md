# Un documento riscritto non spegne Filo

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Una pagina che si riscrive da capo (`document.open`, anche quello
implicito in un `document.write` dopo il caricamento) cancella gli ascoltatori
della finestra e del documento, e con la testa porta via i fogli di stile di
Filo. Il preload installa per primo `src/preload/riscrittura.js`: segna ogni
ascoltatore che il mondo isolato di Filo mette su `window` o `document`, e
appena la radice del documento cambia li rimette, gli stessi e nello stesso
ordine. Nello stesso momento ricopia sulla radice nuova i segni di Filo
(`data-sn-*`, `data-filo-*`, tranne quelli dello zoom, la cui modalità si è
chiusa col documento vecchio) e il preload rimette i fogli di stile. Un
ascoltatore «una volta» già scattato non torna, uno col segnale annullato
nemmeno.

Chi aggiunge un ascoltatore su finestra o documento non deve fare niente, basta
che la regola sia installata prima di lui: lo controlla una sentinella in
`tests/unit/zoomPagina.test.mjs`. Chi tiene nel documento un elemento suo creato
una volta e riusato deve ricrearlo se lo trova staccato.

**Il caso.** #686.1 giro 7: dopo una riscrittura il tasto destro non apriva più
il menu di Filo, e con lui spariva «Dimensione reale». I gesti dello zoom si
erano già curati con la stessa idea ristretta ai loro ascoltatori (vedi
[Lo zoom lo tiene Filo, non la pagina](lo-zoom-lo-tiene-filo-non-la-pagina.md)).

**Cosa resta.** Un sito che nel documento nuovo mette, nello stesso script, un
suo ascoltatore in cattura sulla finestra arriva prima di Filo: la regola rimette
gli ascoltatori in un microtask.

Prove: `tests/pagina-riscritta.spec.mjs`.
