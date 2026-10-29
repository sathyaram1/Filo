# Riquadri incorporati (iframe): Filo gira anche lì, ma un riquadro non è la pagina

[← Tutti i pattern](../PATTERNS.md)

Le pagine vere sono piene di riquadri di altri siti: un video dentro un articolo,
una mappa, un blocco commenti, un modulo. Sono `iframe`, e i preload girano nei
sottoframe **solo** con `nodeIntegrationInSubFrames` (attivo per le schede
esterne, MAI per le pagine `filo://`: lì un riquadro esterno erediterebbe il
preload privilegiato). Senza, dentro il riquadro Filo semplicemente non esiste —
il tasto destro non produce nulla, e per l'utente è un buco nero senza spiegazione
(#405).

Cinque regole quando si tocca qualcosa che vive nel content script:

- **Un riquadro della stessa origine non si tocca finché non è arrivato**
  (#1560). Leggere da fuori `contentWindow` o `contentDocument`, o mandare uno
  script nel mondo isolato dei frame figli, mentre il riquadro è ancora sul suo
  documento vuoto iniziale crea lì il mondo di Filo: il riquadro eredita quella
  finestra, il suo preload non parte più, e dentro Filo sparisce per sempre
  (Alt+E e tasto destro muti). Solo la stessa origine eredita la finestra:
  d'altra origine, anche dello stesso sito, il preload parte lo stesso (provato),
  e un tocco dal mondo della pagina non fa danni. Le porte erano tante e tutte
  automatiche: il content script che segue i riquadri al suo avvio, il puntatore
  che passa sulla pagina o sul riquadro (lo zoom), la ricerca dei riquadri in
  una radice ombra, il blocco della pubblicità, la traduzione, chi riconosce un
  riquadro dal messaggio che ha mandato. La regola sta in un posto solo,
  `src/shared/riquadriInArrivo.js` (`SN_RIQUADRI_IN_ARRIVO`): un riquadro è
  arrivato quando il suo preload parte e lo dice a chi lo ospita, o al suo load;
  chi tocca un riquadro chiede a lui `finestra`, `documento`, `riquadroDi` (chi
  ha scritto) o `qualcunoInArrivo` (prima di uno script alla cieca). Saltare un
  riquadro in arrivo non perde niente: non ha ancora un documento che ascolti, e
  chi lo seguiva lo riprende quando arriva. Restano come prima i riquadri in una
  radice ombra e quelli dentro un documento che la pagina si è scritta da sé, di
  cui da qui l'arrivo non si vede. Vale anche per il main (#1429): codice
  eseguito in un riquadro prima del suo primo commit fa lo stesso danno, e chi
  esegue nei riquadri chiede `riquadroArrivato(f)`
  (`src/main/services/riquadroArrivato.js`: prima del commit `url` è vuoto).
  Un riquadro che la pagina toglie o sposta si ricarica da capo e torna in
  arrivo, anche nel corpo che Filo mette nella pagina (`moveBefore` no: tiene il
  documento). Resta aperta la porta della pagina stessa: un sito che tocca il
  suo riquadro prima del load gli toglie Filo uguale. Sentinella
  `tests/unit/riquadriInArrivo.test.mjs`; prove `tests/riquadro-in-arrivo.spec.mjs`
  e `tests/iframe-context-menu.spec.mjs`.

- **Costo pigro.** Una pagina può avere decine di riquadri che l'utente non tocca
  mai. Nel sottoframe `page-preload.js` non carica NIENTE finché non arriva la
  prima interazione vera (tasto destro, clic, tasto premuto, una scorciatoia
  indirizzata a quel frame); il primo tasto destro viene **rigiocato** appena
  l'handler è pronto, così non serve cliccare due volte. Unica eccezione, il
  rifiuto dei banner dei cookie (#754): il banner di Sourcepoint, TrustArc e
  simili È un riquadro, e nessuno lo tocca prima che risponda. Lì il preload
  carica subito il solo modulo cookie (`startCookiesInFrame`), senza il resto di
  Filo; nascondere un banner e sbloccare lo scorrimento restano alla pagina. Un
  riquadro che vede un banner senza «rifiuta» lo dice al main
  (`MSG.COOKIES_FRAME_BANNER`), e il main passa alla pagina l'indirizzo del suo
  riquadro figlio da nascondere (`MSG.COOKIES_HIDE_FRAME`): solo se sta in un
  velo fisso, perché un riquadro nel flusso della pagina è contenuto.
- **Frame vs pagina.** Ciò che riguarda l'ELEMENTO cliccato funziona identico nel
  riquadro. Ciò che riguarda la PAGINA no: colore della scheda, segnali di
  attività, avviso del sito pericoloso, avvisi di sistema, e le azioni globali
  del menu (traduci, condividi, salva, QR, screenshot, feedback, sidebar Aiuto).
  Quelle o restano al frame principale, o gli vengono **rimandate**
  (`MSG.RUN_IN_TOP_FRAME` → `MSG.TOP_FRAME_COMMAND`): eseguirle nel riquadro
  significherebbe condividere l'indirizzo del player invece dell'articolo, o
  disegnare un pannello a tutta superficie dentro un rettangolo di 300 px.
- **I frame non si parlano da soli.** Eventi del mouse e chiamate JS non
  attraversano il confine di un iframe di un'altra origine: ogni coordinamento
  passa dal main (chiusura dei menu degli altri frame, consegna dei suggerimenti
  ortografici nativi a `params.frame`, stream AI verso `event.senderFrame`,
  scorciatoie di selezione verso l'ultimo frame usato). `webContents.send`
  raggiunge **solo** il frame principale: per parlare a tutti serve
  `mainFrame.framesInSubtree`.
- **Un'azione di pagina che tocca il TESTO deve entrare nei riquadri** (#407).
  "Frame vs pagina" dice dove l'azione si esegue, non fin dove arriva: un post
  incorporato o un blocco commenti è testo che l'utente legge, e lasciarlo in
  lingua originale sotto un avviso "Pagina tradotta" è la bugia della
  segnalazione, in un caso più stretto. Il frame principale non può toccarlo (è
  un'altra origine), ma il content script gira già lì dentro: gli si passa
  parola, e ogni riquadro lavora su se stesso. Quattro conseguenze che si pagano
  se si saltano. **Il giro passa dal main**, non da `postMessage`: una postMessage
  la sa scrivere anche il sito, e si ritroverebbe a comandare un riquadro che non
  è suo; il main invece conosce l'albero dei frame e sa chi è il frame
  principale. **Il riquadro va svegliato**: per il costo pigro lì dentro non c'è
  ancora niente di montato, quindi il messaggio che lo comanda deve far partire
  `ensureContentScripts()` e farsi consegnare dopo (stesso cammino delle
  scorciatoie). **Chi non risponde entra nell'avviso**: un riquadro in cui il
  nostro script non risponde resta in lingua originale, e il conto dei
  riquadri che si VEDONO (grandi abbastanza da starci del testo) meno quelli che
  si sono fatti vivi è ciò che fa dire "una parte è rimasta fuori" invece di
  "fatto". E se si può tradurre lì dentro si deve poter tornare indietro lì
  dentro: il ritorno all'originale passa parola con lo stesso giro.
  Il `sandbox` senza allow-scripts invece NON ferma Filo: dal #1122 il suo mondo
  isolato ha una CSP propria, e Chromium esenta un mondo così dal divieto di
  script del `sandbox`, come i content script delle estensioni. Lì dentro Filo
  traduce; negli spec il riquadro muto si fa con `senzaFilo`.
  **In un riquadro SENZA indirizzo il preload non entra affatto**, e questo si
  scopre solo provandolo: un `iframe` vuoto riempito dalla pagina stessa
  (`about:blank`, `srcdoc`) resta senza Filo dentro, e quasi tutti i riquadri
  pubblicitari nascono così. Lì non c'è nessuno a cui passare parola e nessuno
  che risponda, quindi due cose insieme: il documento lo legge chi ospita (è
  della stessa origine e `contentDocument` si apre), e quel riquadro esce dal
  conto di chi deve rispondere, o ogni pagina che ne ha uno si prenderebbe a
  torto l'avviso "una parte è rimasta fuori". Entrare così vale SOLO per i
  riquadri senza indirizzo: in quelli con un indirizzo vero il content script
  c'è e traduce da sé, e leggerli anche da fuori è pagare due volte.

- **Ciò che Filo mette nel mondo della pagina va in ogni sua finestra** (#798,
  la guardia anti-fingerprint; #753, GPC, passa dallo stesso preambolo). Ogni
  riquadro della stessa origine è un'altra finestra con le sue copie native di
  canvas, WebGL e audio: una pagina che crea un `iframe` vuoto e ne usa le
  funzioni legge senza la guardia. Le regole, provate negli spec:
  il preload entra in `srcdoc`, `data:`, `blob:` e negli indirizzi veri, non in
  `about:blank`; il riquadro vuoto lo prepara la finestra che lo contiene,
  dall'elemento (`contentWindow`, `contentDocument`) e, per indice o per nome,
  appena entra nel documento: dalle funzioni che inseriscono (nodi e testo
  HTML, anche nelle ombre) nella stessa riga, dall'osservatore per ciò che
  scrive il parser. **Si segna come preparato il mondo JS del documento** (il
  prototipo di `location`), mai la finestra: l'elemento dà la stessa finestra a
  ogni documento che vi carica (riempito dopo l'inserimento, seconda pagina,
  tornato vuoto), e ogni documento nuovo arriva con copie native nuove. Uno che
  torna vuoto si prepara al suo `load`, che arriva al documento che lo contiene
  e non alla finestra; un `embed` di HTML non dà la finestra dall'elemento:
  nasce al calcolo della disposizione, e la si cerca fra quelle della pagina
  con `frameElement`. **Un riquadro che carica un documento della stessa origine
  non si tocca prima**: la sua finestra vuota, toccata, la riusa il documento
  vero e il preload non gira più (niente Filo lì dentro, provato anche con la
  protezione spenta); la pagina che la tocca da sé l'ha già creata, quindi lì
  prepararla non costa niente. Se la tocca per indice o per nome non lo si vede:
  il documento che eredita la finestra si prepara al suo `load` se il suo preload
  non si è fatto sentire col canale, e restano scoperti solo i suoi script che
  girano prima del load. In un sito con accessi esenti (`esentiNelSito`) un
  documento senza preload può essere uno di quelli: lì al load si preparano solo
  i vuoti. Uno che va su un'altra origine sì: avrà una
  finestra nuova. Restano scoperti, per indice, solo `srcdoc` prima che carichi
  e un indirizzo della stessa origine che non arriva mai (un 204) o è lento:
  coprirli spegne Filo in quei riquadri. In Automatico restano aperti per scelta
  dell'owner (Automatico promette nessun impatto); in Privacy massima un riquadro
  ancora vuoto dopo qualche secondo si copre, e il contenuto che arriva dopo ha il
  rumore ma non Filo. Scoperti per scelta dell'owner anche gli script di un
  documento che un riquadro già nella pagina riceve da un indirizzo `javascript:`
  (`src`, attributo, `location`): Chromium non avvisa quando nasce, la guardia lo
  raggiunge al suo `load` e da fuori dopo si legge col rumore. Chiuderlo vorrebbe
  dire intercettare ogni modo di dare un indirizzo a un riquadro, un elenco che
  per tre giri non ha tenuto. **Un preambolo per albero della stessa
  origine**: il preload di un riquadro della stessa origine chiede la guardia
  alla finestra che lo contiene con un evento sull'elemento, il cui tipo è un
  segreto della sessione; se nessuno risponde la inietta da sé. Senza, un canvas
  annotato da uno e letto con le funzioni dell'altro uscirebbe pulito. **Nessun
  segno sulla finestra**: una proprietà della guardia la vede ogni sito, e dice
  che lì c'è Filo; chi è già preparato lo sa la guardia, i test guardano il
  rumore (`tests/helpers/guardia.mjs`). **Ciò che il preambolo usa dopo l'avvio si prende all'avvio**
  (`Reflect.apply`, `Object.*`, descrittori senza prototipo): un riquadro si
  prepara quando la pagina ha già riscritto quello che voleva. Vale anche per
  ciò che la guardia legge dopo il nativo: dimensioni, canali e `then` coi
  getter presi all'avvio, gli argomenti numerici convertiti una volta sola prima
  del nativo; un valore riscritto per un istante (larghezza 0, un `valueOf` che
  cambia risposta) farebbe saltare il rumore. **Non tutte le finestre sono
  HTML**: un riquadro XML o SVG della stessa origine ha le sue copie native, e
  lì `createElement` non dà un canvas e `tagName` resta minuscolo; la guardia
  usa il namespace esplicito e il nome locale. Quali riquadri
  con un documento loro la ricevono lo decide il main dalla catena dei frame
  (`configForFrames`), mai dall'indirizzo che il riquadro dichiara.

Il menu si adatta anche allo spazio: se il riquadro è più basso del menu, il menu
diventa scorrevole invece di essere tagliato.

**Dove:** `_makeView` in `src/main/tabs.js`, `src/preload/page-preload.js`,
`IS_SUBFRAME` in `src/content/content.js` e `src/content/menuIcons.js`, ponte in
`src/main/services/handlers/nav.js`, preambolo in `src/preload/fingerprint-guard.js`. Test:
`tests/iframe-context-menu.spec.mjs`, `tests/translate-page.spec.mjs`, `tests/fingerprint-riquadri.spec.mjs`.
