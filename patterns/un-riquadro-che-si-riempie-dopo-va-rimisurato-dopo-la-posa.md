# Un riquadro che si riempie dopo va rimisurato dopo: la posa non è un fatto solo

Menu, popup e tooltip di Filo contengono roba che arriva **più tardi**: la
spiegazione AI di una selezione o di un link, il suggerimento del correttore, i
metadati di una pagina. Misurare l'altezza al momento dell'apertura e non
tornarci più vuol dire posare il riquadro su un numero che scade un secondo
dopo. Il contenuto cresce verso il basso, il fondo esce dalla finestra, e quel
che sta in coda resta tagliato a metà: nel menu le ultime voci (in Filo sempre
Invia feedback e Aiuto), nel riquadro della risposta la riga del modello e il
campo dove si scrive la domanda successiva — cioè, lì, la fine della
conversazione (#500).

- **Regola.** Ogni overlay posizionato con una misura presa dal DOM tiene un
  `ResizeObserver` sul proprio contenitore e ripete la posa a ogni cambio
  d'altezza, finché resta aperto. Se l'altezza non cambia non costa niente.
- **L'osservatore non basta da solo.** La consegna del `ResizeObserver` è legata
  al ciclo di disegno: se la finestra non sta dipingendo può arrivare molto
  tardi (in cloud, sotto Xvfb, anche secondi). Dove si SA già cosa fa crescere
  il riquadro — l'arrivo di un pezzo di risposta — chiedi la rimisura anche lì,
  fusa per fotogramma. L'osservatore resta la rete per tutto il resto.
- **Le superfici che crescono sono due.** Il menu del tasto destro e il riquadro
  della risposta di Filo hanno lo STESSO difetto: chi ne sistema uno sistemi
  anche l'altro, o chi ha segnalato il primo incontra il secondo il giorno dopo
  (#500 il menu, #502 il riquadro). Le cure oggi sono due: il menu usa la
  geometria condivisa di `src/shared/overlayPlacement.js`; il riquadro ha la sua
  posa ancorata al lato fermo (vedi
  [Un riquadro che si riempie dopo si ancora dal lato che non si muove](un-riquadro-che-si-riempie-dopo-si-ancora-dal-lato.md)).
  Se le si unifica, la geometria va in un posto solo, non ricopiata.
- **A muoversi sono in due: il riquadro e la finestra.** Quello che conta non è
  che il riquadro sia cresciuto, è che il posto per stargli non basti più — e ci
  si arriva anche dall'altro verso, con la finestra che si accorcia sotto a un
  riquadro fermo (o l'area della pagina che si accorcia da sola: un riquadro
  incorporato che cambia misura, una barra che compare). Il sintomo è identico,
  quindi il conto va rifatto uguale: `ResizeObserver` sul contenitore **e**
  `resize` sulla finestra, tutti e due che chiamano la stessa riposa. E il
  `resize` non è un buon motivo per CHIUDERE l'overlay: chi rimpicciolisce la
  finestra non sta chiedendo di annullare quello che stava per fare.
- **Ricrescita ≠ prima posa.** Alla prima apertura il menu si **ribalta** sopra
  al cursore se sotto non ci sta. Ripetere quel ribaltamento a ogni ricrescita
  farebbe schizzare via il menu da sotto la mano proprio mentre l'utente sta per
  cliccare. Da posato in poi ci si muove del **minimo**: si scivola in su quanto
  basta a rientrare, mai si salta.
- **Rimisura pulita.** Prima di misurare togli il tetto (`max-height`) messo dal
  giro precedente, altrimenti misuri il tetto e non il contenuto, e un riquadro
  che si è ACCORCIATO si tiene addosso per sempre una barra di scorrimento che
  non gli serve più. Toglilo e rimettilo nello stesso giro sincrono, così non si
  vede nessuno sfarfallio.
- **`max-height` non è l'altezza finale.** Morde il box scelto dal CSS, e in
  `content-box` (il valore di partenza, quello che si prende un overlay dentro
  una pagina qualunque) bordo e imbottitura restano fuori dal conto: il riquadro
  resta più alto del tetto quel tanto che basta a sforare comunque. Dopo aver
  messo il tetto **rimisura** e togli l'eccedenza.
- **Zoom.** Il menu è disegnato scalato per non crescere con Ctrl+/-, quindi
  quello che occupa davvero è `offsetHeight * scala`. È quel numero a dover
  stare dentro `innerHeight`, non l'altezza di layout.
- **Chi è appeso al riquadro si muove col riquadro.** Un pannello ancorato (la
  griglia "Altro…", la cronologia incolla, un sotto-menu) viene posato una volta
  e poi il menu gli si muove sotto: scivola perché la spiegazione è arrivata,
  oppure scorre perché è più alto della finestra. Se il pannello resta fermo si
  stacca dalla freccetta che l'ha aperto e galleggia sopra alle voci. Quindi la
  posa del pannello è una funzione richiamabile, non un calcolo fatto una volta
  all'apertura, e la si richiama a ogni riposizionamento e a ogni scorrimento
  del menu. Se l'ancora è scorsa fuori dal bordo del menu non c'è più niente a
  cui stare attaccati: il pannello si chiude.
- **L'etichetta di un'icona vale finché l'icona sta ferma.** Il tooltip nasce da
  un hover e muore con l'hover — ma solo se a muoversi è il puntatore. Quando è
  il MENU a muoversi (scorre, scivola perché la spiegazione è arrivata, rientra
  perché la finestra si è accorciata) l'etichetta resta ferma dov'era, staccata
  dall'icona di cui parla e sovrapposta alle voci. Non contare sul browser: il
  `mouseleave` sintetico che segue un cambio di layout arriva solo se sotto al
  puntatore finisce un altro elemento — se il menu scivola di pochi pixel non
  arriva affatto, e l'etichetta resta lì appesa. Quindi la si toglie a mano,
  insieme all'attesa che sta per farla comparire (`dismissTooltip`), ogni volta
  che il menu si è MOSSO davvero. Se invece è solo cresciuto restando fermo,
  l'etichetta non si tocca: farla sparire sotto il naso di chi la sta leggendo
  sarebbe un dispetto, non una correzione.
- **Un riquadro che scorre deve trattenere lo scorrimento.** Senza
  `overscroll-behavior: contain` il giro di rotella che arriva dopo l'ultima riga
  passa alla pagina, la pagina scorre e uno scroll di pagina chiude il menu: chi
  legge fino in fondo una spiegazione lunga perde il menu proprio lì. Col
  trackpad succede quasi sempre, perché l'inerzia continua da sola dopo che hai
  staccato le dita. Vale per ogni contenitore scorrevole dentro un overlay
  (`.sn-menu-history-list` e chiunque altro).
- **Un riquadro trascinato a mano non si sposta più da solo.** La posa è
  diventata una scelta dell'utente: muoverglielo sotto le dita mentre legge è
  peggio del difetto. Quello che si può ancora fare senza spostarlo è
  impedirgli di crescere oltre il bordo — cresce verso il basso finché tocca la
  fine della finestra, poi scorre — così la riga del modello e il campo della
  domanda restano dove l'utente li ha messi. L'unica eccezione è il riquadro
  trascinato così in basso che nemmeno il minimo utile ci starebbe: lì
  scivolare è il male minore.
- **Dove:** `computeCap` / `computeOffset` / `computePinnedLimit` / `applyCap` /
  `observeGrowth` in `src/shared/overlayPlacement.js`; `place` /
  `computeSubOffset` / `repositionSub` / `dismissTooltip` e il gestore `resize`
  in `src/content/menu.js`. Va caricato PRIMA di `menu.js` in
  `src/preload/page-preload.js` e `src/preload/internal-preload.js`.
  Il riquadro della risposta ha la sua posa in `src/content/popup.js` (sezione
  «si ancora dal lato che non si muove»). Test: `tests/unit/menuPlacement.test.mjs`
  e `tests/unit/popupPlacement.test.mjs` (geometria pura),
  `tests/context-menu-grow.spec.mjs` (il menu vero che cresce, scorre, si porta
  dietro il pannello, rientra quando la finestra si accorcia e non lascia
  etichette appese); per il riquadro `tests/popup-pose-streaming.spec.mjs`,
  `tests/popup-pose-casi-limite.spec.mjs` e `tests/popup-scroll-streaming.spec.mjs`.
