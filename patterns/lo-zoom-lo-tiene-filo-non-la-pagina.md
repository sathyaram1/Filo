# Lo zoom lo tiene Filo, non la pagina

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Lo zoom di una scheda è dell'utente, e quello che lo muove sta
dove il sito non arriva, o ci arriva solo per chiedere:

- **I tasti** (Ctrl/Cmd + / - / 0) li prende il main in `before-input-event`
  (`src/main/tabs/tabZoom.js`), prima del documento e di qualunque riquadro, e
  li consegna al preload del frame principale su `filo:zoom-key`. Il preload
  ha una porta sola (`eseguiZoom`) per tasti, barra dei menu, chat e tasto
  destro, e lì sta l'eccezione dell'editor, che scala il foglio.
- **Rotella e clic centrale** non hanno un gancio nel main (Electron 33), quindi
  si ascoltano nel preload: solo eventi `isTrusted`, sulla finestra in cattura
  (prima degli script della pagina), e **rimessi** quando il documento cambia
  radice, perché `document.open` cancella gli ascoltatori della finestra
  insieme ai suoi. Quello che arriva comunque a Chromium senza che nessuno
  l'abbia preso esce da `zoom-changed`, e il main lo gira al preload su un
  canale suo (`filo:zoom-rotella`). Chromium lo segnala anche quando il preload
  l'ha già preso, e a volte due volte nello stesso istante: il preload lo scarta
  se ha preso una rotella nell'ultimo secondo, e ne tiene uno per scatto
  (uno scatto valeva due passi, #686.1 giro 2).
- **Nei riquadri incorporati** il preload non zooma e non disegna: passa il
  gesto al main (`filo:zoom-gesto`), che accetta solo gesti di forma nota e
  solo da un sottoframe della stessa scheda, e li gira al frame principale. Lo
  stato della modalità rotella fa il giro inverso (`filo:zoom-modalita` →
  `framesInSubtree`), perché il riquadro deve fermare la rotella e i clic.
  Un riquadro che la pagina riempie da sé (about:blank scritto, come gli
  editor di testo ricco) un preload suo non ce l'ha: i suoi gesti li ascolta
  il frame che lo contiene, agganciandolo quando il puntatore passa sul suo
  elemento. Chi ha un preload suo lo dice con `__filoZoomQui` nel mondo
  isolato, e l'aggancio lo salta: un gesto vale una volta sola. Dentro un
  componente della pagina (shadow DOM) il puntatore arriva col suo ospite: se
  il componente è aperto il riquadro sta nel percorso dell'evento, se è chiuso
  lo si chiede all'albero dei frame (`webFrame`), e ogni figlio si presenta dal
  mondo isolato di Filo (999, dove il sito non arriva) al primo frame che veglia
  (#686.1 giro 3).
- **Il campo della percentuale** vale i tasti battuti dopo un clic vero nel
  campo, mai il `value` che ha nel documento: il sito lo scrive anche col
  comando di inserimento testo del browser, che conta come battuto. Si applica
  su Invio, Tab o un clic fuori; un'uscita dal campo (blur) non applica niente,
  perché la può fare anche il sito a metà numero.
- **Il riquadro con la percentuale** sta nello strato superiore del documento
  (popover), non nel corpo: sopra i frame di un frameset, un dialogo modale e il
  tutto schermo. Col dialogo modale aperto sta dentro il dialogo, perché il
  resto della pagina diventa intoccabile, e a ogni scatto ricontrolla il posto.
  È fatto di elementi HTML anche dove il documento non lo è (un'immagine SVG
  aperta da sola): prima lì la modalità si apriva senza riquadro (#686.1 giro 5).

**Il caso.** #686 aveva chiuso tre porte una dopo l'altra (eventi finti, il
marcatore «mi zoomo da solo» scritto dal sito, ascoltatori zittiti dal sito
che si registrava prima). Al quarto giro ne sono uscite altre tre, tutte dalla
stessa causa, gesti e campo che vivevano solo dentro la pagina (#686.1): il
campo riempito con `execCommand('insertText')` e lasciato col blur portava la
pagina dal 200% al 25%; un `document.open` spegneva Ctrl +/-/0, Ctrl+rotella e
clic centrale; un clic dentro un riquadro incorporato portava i tasti dove il
preload dello zoom non c'era, mentre dalla chat lo zoom lì funzionava.

**Cosa resta.** Un sito che riscrive il proprio documento e ci mette dentro,
nello stesso script, un suo ascoltatore sulla finestra arriva prima che gli
ascoltatori di Filo siano rimessi (l'osservatore è un microtask): da lì si
prende pizzico e clic centrale. Il main non può supplire: in Electron 33
`input-event` non porta né il tasto del mouse né il verso della rotella. Il
colpo di rotella con Ctrl lo recupera `zoom-changed`, i tasti restano
all'utente comunque. Il riquadro con la percentuale sta ancora nel documento:
un sito che lo cerca apposta può nasconderlo o toglierlo, non cambiare il numero
che viene applicato.

Prove: `tests/zoom-fuori-dalla-pagina.spec.mjs` (con i riquadri riempiti dalla pagina, il frameset, l'SVG e il dialogo modale), `tests/unit/zoomPagina.test.mjs`.
