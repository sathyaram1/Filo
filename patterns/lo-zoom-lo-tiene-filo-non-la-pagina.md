# Lo zoom lo tiene Filo, non la pagina

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Lo zoom di una scheda è dell'utente, e quello che lo muove sta
dove il sito non arriva, o ci arriva solo per chiedere:

- **I tasti** (Ctrl/Cmd + / - / 0) li prende il main in `before-input-event`
  (`src/main/tabs/tabZoom.js`), prima del documento e di qualunque riquadro, e
  li consegna al preload del frame principale su `filo:zoom-key`. Il preload
  ha una porta sola (`eseguiZoom`) per tasti, barra dei menu, chat e tasto
  destro, e lì sta l'eccezione dell'editor, che scala il foglio.
- **Rotella e clic centrale** non avevano un gancio nel main fino a Electron 33 (la 44 ha
  `before-mouse-event`, da provare prima di contarci), quindi
  si ascoltano nel preload: solo eventi `isTrusted`, sulla finestra in cattura
  (prima degli script della pagina), e **rimessi** quando il documento cambia
  radice, perché `document.open` cancella gli ascoltatori della finestra
  insieme ai suoi (la stessa regola, per tutto Filo:
  [Un documento riscritto non spegne Filo](un-documento-riscritto-non-spegne-filo.md)). Quello che arriva comunque a Chromium senza che nessuno
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
  (#686.1 giro 3). Agganciato, passa gesti come ogni altro riquadro
  (`gestiDiUnRiquadro`), mai eventi al frame principale: un suo punto misurato
  contro il riquadro con la percentuale cadeva sul numero (#686.1 giro 9).
- **Il clic centrale fuori da Mac e Windows incolla** la selezione del sistema:
  in un campo in cui si scrive (anche un editor in un riquadro) resta al
  sistema, come sui link (`SN_ZOOM.centraleIncolla`). Quando lo prende lo zoom,
  si ferma anche il rilascio, che incollerebbe nel campo col fuoco (#686.1 giro 8).
  Link e campi si leggono da tutto il percorso dell'evento: dentro un componente
  della pagina il bersaglio è solo il guscio (#686.1 giro 9). Il clic che chiude
  la modalità su un campo ci mette anche il cursore.
- **Il campo della percentuale** vale i tasti battuti dopo un clic vero nel
  campo, mai il `value` che ha nel documento: il sito lo scrive anche col
  comando di inserimento testo del browser, che conta come battuto. Si applica
  su Invio, Tab o un clic fuori; un'uscita dal campo (blur) non applica niente,
  perché la può fare anche il sito a metà numero. Mentre il campo è aperto i
  tasti li prende il main prima di qualunque frame (`filo:zoom-campo`), e uno che
  arriva comunque a un riquadro incorporato viene girato al campo: il sito può
  portare il fuoco anche dentro un suo riquadro (#686.1 giro 7).
- **Il riquadro con la percentuale** sta nello strato superiore del documento
  (popover), non nel corpo: sopra i frame di un frameset, un dialogo modale e il
  tutto schermo. Col dialogo modale aperto sta dentro il dialogo, perché il
  resto della pagina diventa intoccabile, e a ogni scatto ricontrolla il posto.
  È fatto di elementi HTML anche dove il documento non lo è (un'immagine SVG
  aperta da sola): prima lì la modalità si apriva senza riquadro (#686.1 giro 5).
  Dove sta non decide se si tocca: un clic vero che cade dove si vede il
  riquadro vale per il riquadro, qualunque cosa la pagina gli abbia messo
  sopra o reso intoccabile (un dialogo modale dentro un componente chiuso, uno
  aperto dopo il riquadro); le cifre le prende comunque la finestra. Lo sfondo
  che il sito dà a ogni livello in primo piano (`::backdrop`) lo spegne una
  regola dell'utente con `!important`, che vince su quelle del sito (#686.1 giro 6).
  Lo stile del testo del sito non lo raggiunge: `all: initial` in testa ai suoi
  stili, anche dentro il dialogo. Nello strato superiore vince l'ultimo arrivato,
  quindi mentre è aperto una guardia ogni 250 ms controlla che al suo posto si
  veda lui, e lo rimette in cima se una notifica del sito gli è arrivata sopra
  (#686.1 giro 7). Conta l'arrivo, non solo il punto: una notifica che non
  prende i clic copre lo stesso, e `elementFromPoint` non la vede.
  Sullo schermo ha sempre la stessa misura e lo stesso posto, come i riquadri di
  Filo nella pagina (`src/content/popup.js`): `zoom` CSS a 1/fattore, rimesso
  dalla stessa guardia quando lo zoom cambia altrove. Prima al 300% copriva il
  titolo e al 33% non si leggeva (#686.1 giro 10).

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
prende pizzico e clic centrale. Il main non può supplire: `input-event` non porta
né il tasto del mouse né il verso della rotella (`before-mouse-event`, arrivato con
la 44, porta il tasto e va provato). Il
colpo di rotella con Ctrl lo recupera `zoom-changed`, i tasti restano
all'utente comunque. Il riquadro con la percentuale sta ancora nel documento:
un sito che lo cerca apposta può nasconderlo o toglierlo, non cambiare il numero
che viene applicato né prenderne i tasti. Toglierlo del tutto dalla pagina vuol
dire una vista di Filo sopra la scheda: l'owner, interpellato su #686.1, l'ha
lasciato nella pagina. Si riapre solo se lo chiede lui. Dentro un componente
chiuso il percorso dell'evento si ferma al guscio: un link lì apre anche la
modalità, e su Linux un campo lì non incolla. Limite accettato dall'owner
(#686.1, ottobre 2026): sono rari, e la modalità si chiude con un clic.

Prove: `tests/zoom-fuori-dalla-pagina.spec.mjs` (con i riquadri riempiti dalla pagina, il frameset, l'SVG, il dialogo modale anche dentro un componente, lo sfondo dei livelli in primo piano, il fuoco portato in un riquadro, la notifica arrivata dopo, lo stile del testo, i link dentro un componente e il clic nell'editor all'altezza del riquadro), `tests/unit/zoomPagina.test.mjs`.
