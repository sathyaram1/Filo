# Il menu del tasto destro sta in uno strato sopra la scheda

[← Tutti i pattern](../PATTERNS.md)

Il menu del tasto destro esce dal documento del sito e si disegna in uno **strato di Filo**: una
WebContentsView trasparente per finestra, posata sopra la scheda attiva, con la sua pagina
`filo://menu/`. Il sito non la vede e non la tocca, perché non sta nel suo documento.

- **Perché:** disegnato nella pagina, il menu lo legge e lo preme il sito: la cronologia degli appunti
  letta, un «Incolla» travestito (#586, #589.11, #592.13). L'owner ha deciso di portarlo tutto fuori
  (29/09/2026) con un piano in cinque passi: 1 le prove che lo trovano ovunque sia
  (`tests/helpers/menuContestuale.mjs`), 2 lo strato, 3 il menu nello strato, 4 l'accensione, 5 via le
  vecchie difese nella pagina.
- **Spento di serie** fino al passo 4: `ACCESO_DI_SERIE` in `src/main/stratoDelMenu.js`, e nelle prove
  `test.use({ stratoDelMenu: true })` (ambiente `FILO_STRATO_MENU=1`). Spento, non nasce nessuna vista e
  Filo fa quello che faceva.
- **Una vista per finestra, pronta e nascosta.** Nasce dopo la shell e carica fuori dalla finestra (dentro
  si prenderebbe la tastiera di chi scrive); ci entra alla prima apertura. Niente finestra nuova a ogni
  clic, come invece fa `src/main/popup-menu.js` (fuoco a un'altra finestra, trasparenza che su Linux
  dipende dal compositore).
- **Grande quanto la scheda, in cima a tutto tranne la barra laterale**, che resta raggiungibile a menu aperto
  (#871). Le icone delle azioni sulla pagina stanno solo lì (#1246): lo strato non le riproduce. Un clic fuori dal menu cade sullo strato: lo chiude e basta, alla pagina sotto
  non arriva. Diversa dalle viste grandi quanto il contenuto
  (`patterns/la-shell-non-disegna-sopra-la-pagina.md`), che rigirano i gesti del vuoto alla pagina.
- **Il punto viene dal `context-menu` della scheda**, `params.x/y`: px della vista, già fuori da zoom e
  riquadri incorporati (Chromium li riporta alla vista principale), uguali con lo schermo al 125%. Mai
  dalla posizione del cursore sullo schermo: su Linux con Wayland non è affidabile. La pagina dello strato
  ha zoom 1, così i suoi px sono quelli del punto.
- **Si chiude da solo** quando cambia la scheda davanti, quando la scheda naviga a un
  documento nuovo, si chiude o il suo renderer muore, entrando o uscendo dallo schermo intero, quando la
  finestra perde il fuoco, con Esc
  (dalla scheda, dallo strato o dalla barra: prima di ogni altro uso del tasto) e con un clic fuori, anche
  sulla barra. Se aveva la tastiera, la restituisce alla scheda.
- **Segue la scheda sotto come il menu nella pagina.** La stessa scheda con l'area cambiata (finestra accorciata,
  barra compatta) non lo chiude: lo strato prende la nuova area e il menu rientra da sé (#500). La pagina che scorre
  chiude il menu normale e lascia quello di una selezione: lo strato non scorre con lei.
- **Anche la finestrella di accesso aperta da un sito ha il suo strato**, grande quanto la finestra: è lì che si
  incollano le password.
- **Il menu ci entra come dati (#1054).** Il content script capisce il contesto come sempre e, a strato acceso,
  `src/content/menuNelloStrato.js` manda al main una descrizione delle voci (`src/shared/menuDescritto.js`): le
  funzioni restano lì, tenute per numero, e il clic torna come numero. Lo strato disegna con `src/content/menu.js`,
  `src/styles/menu.css` e `src/styles/popup.css` per la spiegazione (le guardie contro i siti lì non servono e si spengono da sole). Le sezioni che crescono dopo
  (spiegazioni) nascono in un documento senza finestra e arrivano allo strato come HTML ripulito, e un suo collegamento lo apre il content script dalla porta delle uscite; le righe che cambiano
  (correttore, spiegazioni) come aggiornamenti dello stesso menu.
- **Il menu si apre solo dal riquadro del tasto destro appena visto dal main**, entro pochi secondi: un sito non apre lo
  strato. Una voce vale solo dopo un gesto sullo strato che il main ha visto (`input-event`), non per quello che la
  pagina dichiara.
- **Incolla e la cronologia degli appunti non passano dalla scheda.** Lo strato riceve la cronologia dal main; Incolla
  e la voce scelta li legge il main dopo il clic nello strato, e alla scheda arriva solo il testo da scrivere nel campo
  catturato al tasto destro, col fuoco rimesso lì. Il sito vede quello che si incolla, come in ogni browser.
- **Alla pagina non si regala il gesto** (`patterns/un-clic-vero-dato-a-una-pagina-e-un-gesto-regalato.md`): la voce
  scelta parte col fuoco tornato alla scheda.
- **Un tasto destro fuori dal menu** chiude e il main lo rigioca sulla scheda: il menu nuovo si apre lì, come oggi.
- **Test:** `tests/strato-del-menu.spec.mjs` (lo strato) e `tests/menu-nello-strato.spec.mjs` (il menu, e il sito
  ostile di #586 giro 16). Gli spec che trovano il menu da `menuDi` lo trovano nello strato da soli. Il tasto destro passa da `page.mouse` (lo smistamento di
  Chromium lo porta dentro un riquadro di un altro sito; un `sendInputEvent` andrebbe sempre al documento
  principale). La pagina dello strato e il suo stato si chiedono a `paginaDelloStrato` e
  `statoDelloStrato` in `tests/helpers/menuContestuale.mjs`. Nessuno l'ha provato su un Mac o su un Linux
  desktop vero.
