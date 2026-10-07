# Un clic vero dato a una pagina è un gesto regalato

[← Tutti i pattern](../PATTERNS.md)

Quando Filo preme qualcosa al posto dell'utente può farlo in due modi. Il clic
dello script (`el.click()` dal content script) è finto: la pagina lo riconosce
(`isTrusted` è falso) e non le dà niente che non abbia già. Il clic del main
(`webContents.sendInputEvent`) è identico a quello del mouse: la pagina ci vede
un gesto dell'utente, e con un gesto può aprire finestre, andare a schermo
pieno, far suonare, chiedere permessi che Filo concede solo dopo un clic.

Il caso (#737). YouTube ignora il clic dello script sul «Salta» della
pubblicità, quindi serve il clic vero. Ma il content script trova il pulsante
dalla sua classe, e la classe la può scrivere qualunque sito: un sito che si
disegna un `.ytp-skip-ad-button` avrebbe ricevuto un gesto vero ogni volta che
voleva.

## La regola

- **Il clic vero lo decide il main, su un elenco di siti dove serve**, mai il
  content script: la sua richiesta porta solo un punto, il main ricontrolla
  interruttore, scheda, frame principale e sito (`src/main/services/adSkip.js`).
  Altrove resta il clic dello script.
- **Il punto si controlla nella pagina prima di chiederlo**: lì sopra deve
  esserci proprio il pulsante (`elementFromPoint`), perché un clic vero nel
  punto sbagliato apre la pubblicità. Coperto o fuori dalla vista: si aspetta.
- **Non interrompe l'utente**: se sta scrivendo in un campo o tiene premuto il
  mouse, il clic vero sposterebbe il fuoco o romperebbe il trascinamento, e
  aspetta. Dopo il clic il puntatore torna dov'è davvero.
- **Un tetto di frequenza nel main** (uno ogni 800 ms per scheda): un content
  script che sbaglia non diventa una raffica di clic.
- **Lo zoom della scheda** moltiplica il punto: `sendInputEvent` parla in pixel
  della vista, la pagina in pixel CSS. Una scheda in secondo piano ha la vista
  grande zero ma la pagina tiene la sua misura, e il clic le arriva lo stesso.

- **Un riquadro di un altro sito vive in un processo suo**: `sendInputEvent`
  arriva solo al frame principale, e il gesto vero lo riceve la pagina che
  ospita il riquadro, non il riquadro. Per il lettore di YouTube incorporato il
  clic passa dal protocollo di debug (`Input.dispatchMouseEvent`), che lo
  instrada come il mouse fino al riquadro sotto il punto.
- **Il punto del riquadro lo conferma ogni frame sopra di lui**, dal più vicino
  alla pagina della scheda, a qualunque profondità (i servizi di incorporamento
  mettono il lettore in un riquadro dentro un riquadro): il main chiede a
  ciascuno, direttamente al suo content script, dove cade il punto e se sopra al
  riquadro figlio c'è altro. Il figlio lo riconosce dall'origine vera del
  messaggio con cui si è presentato (`e.origin`, `isTrusted`), mai da un nome:
  il nome lo vede la pagina, che lo ripeterebbe da un suo riquadro messo sopra
  (#737 giro 2). Origine opaca: niente clic vero.
- **La pagina non deve sapere quando arriva il clic**: le domande del main non
  passano dai messaggi della pagina. Un sito avvisato infilerebbe un suo
  elemento sopra al lettore fra il controllo e il clic.

- **Anche uno script di Filo regala il gesto, se lo porta**: `executeJavaScript(codice, true)` attiva la pagina
  come un clic, e per cinque secondi la pagina va a schermo pieno senza che l'utente tocchi niente (#737.1: ogni
  pagina lo riceveva al caricamento, dalla guardia anti-fingerprint e dalle letture del testo). Gli script che Filo
  fa girare nelle pagine passano `false`: leggere e scrivere proprietà non ha bisogno del gesto. Senza regali, lo
  schermo pieno lo rifiuta Chromium da solo, e la pagina riceve il rifiuto invece di restare in sospeso.
- **Le finestre le decide il main sul gesto vero**, perché Electron non ha il blocco dei popup di Chrome: col blocco
  acceso una scheda nuova passa solo entro cinque secondi da un input vero sulla scheda, una per gesto
  (`gestoPerUnaFinestra` in `src/main/services/permessiPagine.js`). Il gesto lo apre il suo inizio (pressione,
  tasto, fine del tocco): il rilascio dello stesso clic non è una seconda finestra. Il clic vero che Filo dà da sé
  (`clicDiFilo`, il «Salta») non è un gesto di nessuno, nemmeno quando il riquadro lo riferisce (#737.1 giro 2).
- **Il gesto è di chi l'ha ricevuto**, come in Chromium: del frame toccato e dei suoi antenati, non dei riquadri di
  altri siti che contiene. Il main non sa quale frame chiede la finestra (Electron non lo dice, e la finestra aperta
  da un riquadro senza gesto consuma lo stesso l'attivazione di tutta la scheda): lo riconosce dall'origine del
  referrer. Chi la nasconde resta «la scheda»; chiuderle anche quella porta fermerebbe i link esterni con
  `noreferrer` di ogni pagina con pubblicità (#737.1 giro 3). La forma non conta: una finestra con le misure o un
  Maiuscolo+clic passano col gesto come una scheda. Posta, telefono e SMS chiesti dalla pagina seguono la stessa
  regola; un redirect usa il gesto che ha fatto partire la navigazione.
- **Il gesto della pagina lo dice solo il preload del frame toccato** (#737.1 giri 6 e 7), mai `input-event` del
  main: il main vede l'input prima di sapere se è caduto sull'interfaccia di Filo, e una pagina che chiede di continuo
  passava in quel mezzo. Gli ascolti del preload sulla finestra, in cattura, nascono prima di ogni script del sito e
  parlano al main in modo sincrono (`filo:gesto-pagina`), solo se `isTrusted`; un tasto che Filo si tiene non ci
  arriva, uno riservato che ci arriva il main lo scarta. Un input sull'interfaccia di Filo disegnata nella pagina
  (menu, risposte, assistente: le radici di `SN_FILO_UI`, non l'attributo) è di Filo e spende il gesto, come una
  scorciatoia. Lo schermo pieno invece lo decide Chromium sull'attivazione del frame, che il clic sul menu di Filo dà
  lo stesso: negarlo dal gestore dei permessi lascia la richiesta in sospeso, e la pagina non ci va più nemmeno col
  clic dopo, fino al ricaricamento. L'owner l'ha accettato (#737.1): si esce con Esc, e la porta la chiude il menu
  disegnato fuori dalla pagina (D14), non una pezza qui. La conferma sincrona costa meno di un millisecondo a tasto
  (misurato: +0,6 ms di mediana sul `keydown`), sotto la soglia che si vede scrivendo. Il collegamento o il pulsante d'invio cliccato e la voce del menu di Filo che apre un indirizzo
  dichiarano quell'indirizzo (`aperturaScelta`): si apre una volta anche se la pagina ha già speso il gesto per una
  sua pubblicità, e spende il gesto rimasto. Il main non sa chi ha chiesto la finestra; il preload sa che cosa l'utente ha toccato.
- **Anche i documenti che la pagina si scrive da sé** (#737.1 giro 8): un riquadro vuoto riempito dallo script non ha
  un preload suo, e la riscrittura da capo (`document.open`) cancella gli ascolti della finestra. Il preload del frame
  sopra ascolta anche lì e li rimette dopo una riscrittura; un riquadro che ha un preload suo lo dice con un segno nel
  mondo isolato, e non si ascolta due volte. Un riquadro che sta per caricare un indirizzo non si tocca prima del
  `load`: toccato prima, il suo preload non parte e Filo sparisce da quel riquadro.

Prove: `tests/unit/gestoNonRegalato.test.mjs` (nessuno script di Filo nelle pagine porta il gesto),
`tests/popup-senza-gesto.spec.mjs`, `tests/unit/adSkip.test.mjs`, `tests/ad-skip.spec.mjs` (il «Salta» finto
di YouTube su un sito qualunque non riceve mai un clic vero; il sito che ospita
il lettore incorporato non riceve gesti, nemmeno con un suo elemento o un suo
riquadro sopra; il lettore dentro un riquadro intermedio salta).
