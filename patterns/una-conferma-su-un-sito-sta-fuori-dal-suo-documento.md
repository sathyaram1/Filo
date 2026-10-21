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
  (una finestra vera con dentro un sito, #589.3) copre quella finestra; finché la domanda aspetta,
  `resizeTo`/`moveTo` del sito non valgono, e la finestrella si porta grande quanto il riquadro col suo
  testo e tutta dentro il suo schermo: rimpicciolita (giro 10) o aperta oltre il bordo (giro 11) lasciava
  in vista OK senza il testo. Una regola sola su misura e posizione, non un caso per porta.
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

## Quando il sì apre i dati dell'utente: i documenti dall'Aiuto (#947.3)

La regola: quando l'Aiuto, che vive nel documento di un sito, deve toccare i dati dell'utente, il lavoro e il
sì li fa il main, nella vista sopra la scheda. Alla pagina tornano solo cose da mostrare e chiavi a caso valide
per quella scheda, mai un percorso.


Sul sito del fornitore, dove si carica la bolletta, l'utente chiede all'Aiuto
«mi serve la bolletta della luce di marzo». È il momento in cui un documento
serve davvero, ma la ricerca fra i documenti era solo della home. Le porte
chiuse ai siti (`AZIONI_WEB`, «nemmeno confermato») avevano un motivo preciso:
la conferma disegnata nella pagina la preme anche la pagina. Il sito, poi,
guida la casella dell'Aiuto come vuole, e il testo della pagina può convincere
il modello a cercare.

La strada che regge:

- **Il sì sta fuori dal documento.** La ricerca chiesta da un sito passa da
  `chiediDalMain` (`src/main/confermeSopraPagina.js`): la domanda la scrive il
  main, con l'host della scheda e la richiesta in una riga corta, e la risposta
  torna al main. Da una pagina di Filo il sì serve solo se la cartella esce dal
  perimetro di lettura, come in chat.
- **Alla pagina niente percorsi.** Il content script riceve nome, cartella detta
  coi nomi di Filo («Download › Bollette») e una chiave a caso per ogni
  candidato. Le chiavi vivono nel mondo isolato e valgono solo per la scheda che
  ha cercato, dal suo documento principale, fino alla navigazione: i bottoni
  delle ricerche di prima restano in chat e devono aprire ancora il loro file. Aprire, mostrare nella cartella e trascinare passano dalla
  chiave.
- **Il modello non vede percorsi.** I candidati per il modello li mette il main
  nel messaggio (`payload.esterno.documenti` viene sempre riscritto, la pagina
  manda solo il segno), con `PROMPTS.documentiTrovati(…, { per: 'aiuto' })`:
  la risposta dell'Aiuto la legge il sito. Il modello sceglie col numero
  (`"file": 1`), non con un percorso.
- **Il file arriva al sito solo col gesto dell'utente.** Il bottone si
  trascina col trascinamento del sistema (`webContents.startDrag`): la pagina
  riceve il file come da una cartella, nel campo per caricarlo. Il clic apre il
  documento col programma del sistema; il tasto destro apre il menu di Filo
  (`fileSotto`).
- **Quello che il modello ha letto conta.** I pezzi di testo dei candidati
  entrano nella porta delle uscite (#810) e sporcano il compito come un
  documento letto (#530).

### Dove vive

- `src/main/services/aiutoDocumenti.js`: il sì, le chiavi, quello che vede il
  modello. La porta in `src/main/services/handlers/file.js`.
- `src/content/sidebar.js`: l'azione `documenti`, il bottone, la riga
  «leggo i documenti nuovi» con «Ferma».
- Prove: `tests/aiuto-cerca-documenti.spec.mjs`,
  `tests/unit/aiutoDocumenti.test.mjs`.

## Quando Filo propone un dato dell'utente a un sito: l'email nei campi di accesso (#1124)

La regola: un dato dell'utente da inserire in un sito (l'email dell'account oggi, password e indirizzi domani) lo
propone il main in una vista sopra la scheda, e arriva al frame del campo solo quando l'utente l'ha scelto. Prima di
quel momento nessun pezzo di Filo nel documento lo conosce.

Filo non ha l'autocompilazione di Chrome (Electron non la include), e sulla pagina di accesso di Google l'owner non
trovava la sua email. La porta che dice chi è entrato (`MSG.AUTH_STATUS`) è chiusa ai siti di proposito, e quello che
un content script scrive nel documento il sito lo legge, anche da uno shadow root chiuso (`window.find`, la
selezione).

- **Il content script porta solo il campo**: dov'è (px CSS della scheda, risalendo i riquadri della stessa origine),
  cosa contiene e se quel valore l'ha scritto l'utente. La risposta dice solo «seguilo» o no.
- **Il main decide e disegna**: interruttore, account, incognito, pagina di Filo. La vista è grande quanto il
  riquadro e non tiene la tastiera (un clic gliela dà, torna al campo al giro dopo); frecce, Invio ed Esc li prende
  dal `before-input-event` della scheda, prima del documento e della modalità a schermo intero.
- **Il dato parte alla scelta e solo verso quel frame**, ricontrollati frame vivo, origine e account; il content
  script lo scrive con `execCommand('insertText')`, così la pagina riceve un `input` vero, poi `change`.
- **Un valore messo dalla pagina non conta**: si propone a campo vuoto o con l'inizio scritto dall'utente. Se no la
  pagina proverebbe un prefisso alla volta, e dai tasti che non le arrivano saprebbe quando c'è una proposta.
- **Un clic vale dopo mezzo secondo di proposta ferma sotto il campo**: la pagina può farla comparire sotto il
  cursore, come la conferma.
- **Sotto l'avviso del sito sospetto non compare**: la scheda coperta non è quella che l'utente vede.
- **Né sotto un campo che l'utente non vede**: quasi trasparente (anche per un antenato o un riquadro), più piccolo
  di 20×10, fuori schermo, senza niente di suo da disegnare (fondo, bordo, contorno, ombra, testo, segnaposto,
  cursore), o sotto un velo opaco che lascia passare i clic (`pointer-events: none`: la ricerca per punti non lo
  vede, si cerca fra i nodi; conta anche dopo un clic vero, che l'ha attraversato). Coperto da un nodo che prende i
  clic conta quando il fuoco l'ha dato la pagina, non un clic vero sul campo o sulla sua etichetta. Il controllo si
  ripete mentre è a schermo. Se no la pagina mette a fuoco un campo invisibile sopra il suo «Accetta» e il clic
  dell'utente sceglie l'email (#1124 giri 2 e 5). Il campo alla Google (niente fondo né bordo suoi, contorno ed
  etichetta disegnati sopra da nodi trasparenti) si vede dal cursore e la riceve. È già un elenco di modi di
  nascondere: alla prossima porta si cambia meccanismo o decide l'owner, non si aggiunge una voce.
- **Dopo Esc torna come in Chrome**: rientrando nel campo, cliccandoci (ha ancora il fuoco) o scrivendo l'utente.

Dove vive: `src/main/propostaEmail.js` (vista, tasti, scelta), `src/content/propostaEmail.js` (il campo),
`src/shared/campoAccesso.js` (quali campi, quando proporre), `src/renderer/proposta-email.*`. Prove:
`tests/proposta-email.spec.mjs` (prima della scelta la pagina non trova l'email, dopo la riceve con un `input` vero),
`tests/unit/campoAccesso.test.mjs`.

- **Un riquadro di un'altra origine non sa dove sta**: il suo content script manda un segno a caso alla finestra
  sopra (`postMessage`), e il documento sopra riconosce il riquadro dalla finestra che lo spedisce, non dal segno; ne
  dà al main la posizione finché il riquadro ha il fuoco. Il main somma gli anelli e accetta la posizione solo da un
  frame che contiene quello del campo. Un riquadro intermedio ancora senza Filo si monta al segno.
