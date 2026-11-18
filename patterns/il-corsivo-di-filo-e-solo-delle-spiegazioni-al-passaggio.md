# Il corsivo di Filo è solo delle spiegazioni al passaggio

[← Tutti i pattern](../PATTERNS.md)

**La regola.** In Filo il corsivo vuol dire «qui c'è una spiegazione al passaggio», e nient'altro: nelle risposte del
modello in ogni chat e nei testi dell'interfaccia. Una riga di servizio (Filo sta scrivendo, note di attività, stati,
«nessun risultato») è dritta, nel suo grigio. Il corsivo del modello senza spiegazione (`*parola*`) esce dritto. Restano
corsivi solo i contenuti dell'utente: i suoi documenti nell'Editor e i suoi messaggi.

**Perché.** Decisione dell'owner (#2388): con la spiegazione al passaggio Filo risponde breve senza perdere chi non
conosce un termine, e sceglie cosa spiegare guardando quello che sa dell'utente. Perché l'utente impari il segno al
primo passaggio, senza scritte che lo spieghino, il segno deve voler dire sempre la stessa cosa.

**Come funziona.**
- Il modello scrive `{{termine|spiegazione}}` (una riga, al più un SVG o un'altra spiegazione dentro). Il renderer
  `src/shared/filoMarkdown.js` lo disegna come `span.filo-spiega` e mette la spiegazione in un `<template>` accanto,
  inerte finché non si apre. Il codice fra backtick e le graffe senza barra restano testo.
- `src/shared/spiegazioni.js` (`SN_SPIEGAZIONI.attacca(contenitore, { chiedi, puoChiedere, copia, apriLink })`) apre
  i riquadri: passaggio con ritardo, clic o tocco che fissa, Esc o clic fuori che chiude, una parola dentro un riquadro
  che ne apre un altro accanto, tasto destro con «Spiegami di più» (va a `chiedi`, la chat da cui viene la parola) e
  «Copia la spiegazione». Una superficie nuova che disegna risposte del modello lo attacca al suo contenitore.
- Lo stile sta in `src/styles/theme.css`, che arriva a ogni superficie, siti compresi; le regole di scrittura che il
  modello riceve stanno in un blocco solo di `src/shared/constants.js`, usato da ogni prompt di chat.
- Un disegno del modello entra solo come `<img src="data:image/svg+xml,…">`: da immagine un SVG non esegue script e non
  carica indirizzi esterni.
- Il tipo «pagina» (`{{pagina:termine|…}}`) il renderer lo riconosce e per ora lo mostra come testo: la sua porta e il
  suo stile li porta un lavoro suo.

Sentinelle: `tests/unit/corsivoConvenzione.test.mjs` (nessun foglio di stile né script inclina il testo fuori dalle
classi delle spiegazioni), `tests/unit/filoMarkdown.test.mjs`, `tests/unit/stileRisposte.test.mjs`; il comportamento in
`tests/spiegazioni.spec.mjs`.
