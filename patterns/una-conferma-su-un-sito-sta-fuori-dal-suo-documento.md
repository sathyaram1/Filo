# Una conferma su un sito sta fuori dal suo documento

[← Tutti i pattern](../PATTERNS.md)

Il popup con cui Filo chiede un sì (`SN_CONFIRM_UI.confirm`, `confirmTyped`, `notify`) su una
**pagina web** non si disegna nel documento del sito: lo disegna il main in una **vista sua sopra la
scheda** (`src/main/confermeSopraPagina.js`). Dove il documento è di Filo (le pagine `filo://`) resta
nella pagina, in uno Shadow DOM chiuso.

- **Perché:** il documento è del sito. Lo Shadow DOM chiuso gli nasconde i bottoni (#249), ma il
  contenitore resta un nodo del suo `<body>`: il sito lo rende trasparente, disegna al suo posto un
  popup finto con un altro testo, e chi preme OK sul finto conferma quello vero. Basta anche meno:
  le variabili del tema attraversano lo shadow root, e un `--sn-fg: transparent` sul suo `<html>`
  cancella il testo. Ci si arriva dall'Aiuto, che legge la pagina: la stessa pagina che convince il
  modello a proporre un'azione copre il testo esatto con uno innocuo (#592.6). Nessuna pezza nel
  documento regge (riportare l'opacità, sorvegliare lo stile): il sito arriva sempre dopo.
- **Una porta sola.** Chi chiede un sì chiama `SN_CONFIRM_UI` come sempre. Su una pagina web il
  preload (`page-preload.js`) dà `SN_CONFERMA_FUORI`, e `confirmUi.js` manda lì la domanda invece di
  disegnarla: nessun chiamante sceglie la strada, quindi nessuno la sbaglia. Un content script nuovo
  che ha bisogno di un sì usa `SN_CONFIRM_UI`, mai un riquadro suo nella pagina: la proposta «Apri da
  un altro paese», che stava in uno Shadow DOM aperto, la pagina la premeva da sé (#592.6, giro 1).
  L'avviso di sito pericoloso o sospetto ha una vista sua sopra la scheda (`src/main/avvisoSito.js`,
  #813.5), con la stessa regola: non se ne fa una seconda. Vale anche dentro un pannello di Filo
  che sta nella pagina: il sì di «Ha funzionato?» dell'Aiuto, che pubblica i passi, si dà nel popup, e i
  bottoni del riquadro stanno in uno Shadow DOM chiuso perché la pagina non faccia comparire da sé la
  domanda (#592.6, giro 2). E vale per una proposta che deve stare accanto a quello che riguarda: la
  barra «Attivo i cookie di …» sopra un contenuto incorporato (`riquadroRotto.js`) resta nella pagina,
  ma il suo «Sì» apre il popup, ed è lì che il sì vale; il sito la rendeva trasparente e ci disegnava
  sotto una domanda sua (#592.6, giro 6). Il no che non concede niente può restare nella pagina.
- **Una domanda sulla pagina stessa** (`coprePagina`): copre la pagina quasi del tutto, rispondono solo i
  bottoni (Esc e il velo non scelgono, perché anche «Torna indietro» fa qualcosa), e i tasti non
  tornano al campo di chi scriveva, che potrebbe essere la password chiesta dal sito dell'avviso.
  Un verdetto che cambia ritira la domanda aperta (`segnale`, un AbortSignal) e ne fa un'altra.
- **La vista.** Una per finestra, nata alla prima domanda e caricata fuori dalla finestra (ci entra
  quando è pronta, come in `patterns/la-shell-non-disegna-sopra-la-pagina.md`). Copre **tutta la
  scheda**, non solo il riquadro: è una domanda modale, il velo scuro è suo e la pagina sotto non si
  tocca finché non si risponde. Sta in cima a tutto, anche agli avvisi della barra
  (`dopoInCima`), tranne la barra laterale: la sua striscia sul bordo sinistro e il pannello
  restano raggiungibili, e il clic nell'ombra del pannello cade sul velo, non sulla pagina. Dentro gira lo stesso `confirmUi.js` di sempre (stile, testo che si scorre fino in
  fondo, mezzo secondo prima che un clic vero valga), col tema e i token dell'utente mandati dal main.
- **Nemmeno una finestra del sito ci sta sopra.** Un sito apre senza gesto una finestrella «di accesso»
  (basta un `/login` nell'indirizzo), grande quanto e dove vuole: la posava sul testo del popup vero e
  lasciava scoperto l'OK (#592.6, giro 7). Ogni finestra nata da una pagina si registra
  (`registraFinestraDelSito`, con la finestra di Filo da cui nasce); finché una domanda si vede, sono nascoste
  quelle nate dalla stessa finestra di Filo tranne quella sotto la domanda, e se il sito ne rimostra una torna
  giù. Alla risposta riappaiono senza rubare il fuoco. Una domanda lasciata in un'altra finestra non le tocca:
  nascondeva «Accedi con Google» dove l'utente lavorava, senza dire perché (giro 8).
- **Segue la sua scheda.** Una domanda si vede solo sopra la scheda che l'ha fatta, quando è davanti;
  le altre aspettano. Tornando davanti si ridisegna da capo, e il mezzo secondo riparte. Scheda chiusa,
  pagina nuova, frame che naviga, renderer morto: la domanda vale un Annulla. Da un popup di accesso
  (una finestra vera con dentro un sito, #589.3) copre quella finestra.
- **La tastiera.** La vista se la prende solo se ce l'aveva la pagina che chiede (chi scrive nella
  barra la tiene), e finché la domanda è a schermo la pagina sotto non se la riprende. Chi stava
  scrivendo nella pagina continua a scrivere nel suo campo: la vista gli rimanda i tasti
  (`conferma:tasto` → il frame che ha chiesto), e alla risposta il fuoco torna a lui.
- **Quello che resta nella pagina va avanti solo col gesto.** I passi dell'Aiuto («✓ Accetta», il clic
  sull'elemento evidenziato), le sue scelte e la sua casella stanno nel documento del sito, che li premeva
  e li inviava da codice: ogni passo era una chiamata al modello pagata dall'utente, in un giro senza fine
  (#592.6, giro 3). Chi fa avanzare qualcosa di Filo da un pezzo che sta nella pagina chiede
  `SN_FILO_UI.gestoVero(e)`. L'evento `submit` non basta: quello partito da `requestSubmit()` o da un clic
  di codice sul bottone arriva come vero, quindi conta il tasto o il clic che lo fa partire.
- **Test:** la domanda si fa partire dal mondo isolato del preload (`nelMondoDiFilo` in
  `tests/helpers/confirm.mjs`: `page.evaluate` gira nel mondo della pagina e non ci arriva), e il popup
  si guarda nella sua vista (`confermaSopraPagina`), dove valgono gli hook `_test` di sempre.
  `tests/conferme-sopra-pagina.spec.mjs` prova la pagina ostile del rilievo e i gesti finti sull'Aiuto.
