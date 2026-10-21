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
- **Grande quanto la scheda, in cima a tutto.** Un clic fuori dal menu cade sullo strato: lo chiude e
  basta, alla pagina sotto non arriva. Diversa dalle viste grandi quanto il contenuto
  (`patterns/la-shell-non-disegna-sopra-la-pagina.md`), che rigirano i gesti del vuoto alla pagina.
- **Il punto viene dal `context-menu` della scheda**, `params.x/y`: px della vista, già fuori da zoom e
  riquadri incorporati (Chromium li riporta alla vista principale), uguali con lo schermo al 125%. Mai
  dalla posizione del cursore sullo schermo: su Linux con Wayland non è affidabile. La pagina dello strato
  ha zoom 1, così i suoi px sono quelli del punto.
- **Si chiude da solo** quando cambia la scheda davanti o la sua area (layout), quando la scheda naviga a un
  documento nuovo, si chiude o il suo renderer muore, entrando o uscendo dallo schermo intero, quando la
  finestra perde il fuoco, con Esc
  (dalla scheda, dallo strato o dalla barra: prima di ogni altro uso del tasto) e con un clic fuori, anche
  sulla barra. Se aveva la tastiera, la restituisce alla scheda.
- **Test:** `tests/strato-del-menu.spec.mjs`. Il tasto destro passa da `page.mouse` (lo smistamento di
  Chromium lo porta dentro un riquadro di un altro sito; un `sendInputEvent` andrebbe sempre al documento
  principale). La pagina dello strato e il suo stato si chiedono a `paginaDelloStrato` e
  `statoDelloStrato` in `tests/helpers/menuContestuale.mjs`. Nessuno l'ha provato su un Mac o su un Linux
  desktop vero.
