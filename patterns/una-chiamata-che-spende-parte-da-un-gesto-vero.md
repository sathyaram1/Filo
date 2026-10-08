# Una chiamata che spende parte da un gesto vero

[← Tutti i pattern](../PATTERNS.md)

Alcune chiamate al modello partono senza che l'utente prema niente: la
spiegazione preparata mentre seleziona, il correttore mentre scrive. Partono da
eventi della pagina, e la pagina li sa fabbricare.

Il caso (#1070): su un sito qualunque, in una scheda visibile e senza un clic,
uno script cambiava la selezione ogni 400 ms (una spiegazione a ogni giro) e
scriveva in una casella ogni 1,5 s (un controllo del correttore più uno per
parola). Il budget del mese finiva in un'ora e con lui tutte le funzioni AI;
l'utente vedeva solo i crediti calare.

## Cosa è un gesto

`isTrusted` non basta: Chromium dà `isTrusted: true` anche a eventi che causa
uno script.

- `selectionchange` dopo un `addRange`;
- `input` dopo un `document.execCommand('insertText')`, che non chiede nessun
  gesto (verificato in Electron);
- `focus`/`focusin` dopo un `el.focus()`.

Un gesto è un **input fisico vero e recente**: tasti, mouse, dito, incolla,
trascina, fine di una composizione IME. Lo conta `SN_GESTO`
(`src/content/gesto.js`), in ascolto in cattura sulla finestra, con una finestra
di 1,5 s. Il movimento del mouse non conta: passarci sopra non è chiedere.

## Le regole

1. **Chi fa partire da solo una chiamata a pagamento chiede prima a
   `SN_GESTO.recente()`.** La spiegazione in anticipo e il correttore lo
   chiedono sull'evento che li fa partire (selezione, `input`, fuoco), non al
   momento della chiamata: lo scan parte 1,5 s dopo.
2. **Un gesto paga una chiamata per chi lo prende** (`SN_GESTO.prendi(chi)`): uno
   script che dopo un clic vero cambia la selezione tre volte ne ottiene una, e
   quello che scrive quaranta parole nella casella ottiene un solo controllo del
   correttore. Chi scrive davvero fa un gesto per tasto, e il controllo resta
   uno per parola. `recente()` da solo non basta mai a far partire una chiamata.
   **Un gesto è una pressione**: le ripetizioni di un tasto tenuto e il suo
   rilascio tengono vivo il gesto della pressione, non ne aprono uno nuovo
   (trenta ripetizioni al secondo sarebbero trenta chiamate); lo scan già
   chiesto si sposta soltanto. Il rilascio del mouse invece è un gesto suo e
   prepara la spiegazione: chi si ferma prima di rilasciare non cambia più la
   selezione.
3. **Un gesto paga solo la chiamata che chiede** (`prendi(chi, tipo)`): la
   spiegazione in anticipo la paga un gesto che seleziona (mouse, dito, Maiusc
   con un tasto di spostamento, seleziona tutto), il controllo della parola il
   tasto che chiude una parola (spazio, punteggiatura, Invio, incolla). Con
   «un tasto qualunque» una pagina trasformava ogni lettera scritta in una
   spiegazione o in un controllo (#1070, terzo giro della stessa famiglia: un
   gesto valeva troppe chiamate, poi un tasto tenuto troppi gesti, poi un tasto
   qualunque ogni chiamata). Una chiamata automatica nuova dice il suo tipo; lo
   scan del testo, uno per pausa, si accontenta di un gesto qualunque.
4. **Un'azione chiesta a Filo vale come gesto** (`SN_GESTO.segna()`): incolla e
   dettatura arrivano da un menu fuori dalla pagina, o molto dopo il clic.
4. **A scheda nascosta non si spende**: la chiamata si rimanda e parte al ritorno.
5. **Il main ha un tetto per scheda** (`src/main/services/tettoAutomatiche.js`),
   la difesa che resta se un sito trova un'altra porta. Si conta nel main, mai
   nella pagina. È dimensionato sul doppio del caso peggiore di chi usa Filo
   davvero, non si raggiunge per caso, e quando ferma avvisa una volta nella
   scheda con il numero. Il tasto destro porta `suRichiesta: true` e non si
   ferma mai.
6. **Il costo si riduce senza tagliare in silenzio**: una selezione oltre i 2000
   caratteri non si prepara in anticipo e al tasto destro parte intera; la frase
   di contesto è al massimo 600 caratteri per lato, perché senza un punto vicino
   (codice, tabelle) diventava il blocco intero.

Cosa si perde: sui siti che selezionano o scrivono da script (editor ricchi,
autocompletamento) senza un tasto premuto, l'anticipo. Il calcolo al tasto
destro resta.

Prove: `tests/chiamate-automatiche-solo-da-gesto.spec.mjs` (la pagina vera),
`tests/unit/chiamateAutomatiche.test.mjs` (cosa conta come gesto, il tetto).
