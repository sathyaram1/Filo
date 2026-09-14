# Due liste in un controllo solo: ognuna tiene il suo raggio

[← Tutti i pattern](../PATTERNS.md)

Unificare è quasi sempre giusto. Quando una difesa vale solo su tre strade su
cinque, la cura è un punto di passaggio unico da cui passano tutte. Ma se in
quel punto confluiscono DUE liste nate per fare cose diverse, l'unificazione
regala a ciascuna il raggio d'azione dell'altra, e nessuno se ne accorge finché
non lo si prova sul web vero.

Il caso (#590, sesto giro di verifica). Sotto l'interruttore "blocca siti"
vivono due liste:

- i siti che l'**utente scrive** nelle Preferenze. È un divieto: quel sito non
  deve arrivargli davanti da nessuna strada, e quando viene fermato glielo si
  dice, col nome del sito e con un bottone per insistere;
- le **liste pubbliche** di pubblicità e tracciatori che Filo scarica da solo
  (accese di serie, decine di migliaia di domini). È una potatura, e la fa già
  il filtro delle richieste: annulla la singola richiesta, in silenzio, su ogni
  pagina, da sempre.

Il lavoro ha esteso il controllo unico a due posti nuovi: il **rimbalzo del
server** (dove si passa) e i **riquadri incorporati** (dove ci si infila). Sono
esattamente i due posti dove vive la pubblicità. Le liste pubbliche, passando di
lì, hanno smesso di essere una potatura e sono diventate un divieto:

- aprire una pagina di giornale faceva comparire una notifica per ogni dominio
  pubblicitario incorporato, quattro o più in fila, con un nome di dominio che
  l'utente non ha mai visto e su cui non può fare niente;
- cliccare un link che rimbalza su un contatore di clic (i link sponsorizzati,
  quelli dei giornali, quelli delle newsletter) faceva comparire "Sito bloccato:
  <contatore>" con "Apri comunque", cioè offriva all'utente di dire di sì a un
  sito che non aveva chiesto e che non era la sua destinazione.

La regola:

- **Prima di far confluire due liste in un controllo, chiedi a ciascuna dove
  valeva prima.** Una che valeva sulle richieste non vale automaticamente sulle
  navigazioni, e una che valeva sulla scheda non vale automaticamente sui pezzi
  che la pagina si incorpora.
- **Una difesa muta resta muta.** Se una lista ha sempre lavorato senza dire
  niente, estenderne il raggio non è il momento di darle voce: la voce la si dà
  a quello che l'utente ha scritto lui, perché quello sa riconoscerlo.
- **Il raggio lo decide chi ha scelto l'indirizzo, e si stabilisce in un posto
  solo.** Il settimo giro aveva provato a separare il fermare dal dirlo: il
  blocco su tutte e due le liste, la voce solo sul divieto scritto dall'utente.
  Non regge, e l'ottavo giro l'ha misurato. Fermare in silenzio non è un
  compromesso: è un link che non porta da nessuna parte senza che nessuno dica
  perché, e passare da una notifica sbagliata al silenzio totale peggiora
  l'unico indizio che l'utente aveva. Peggio ancora, restringere solo la voce
  si fa una porta per volta, e le porte erano cinque (il link cliccato, la
  scheda nuova, il Ctrl+clic, la voce del menu del tasto destro, la
  finestrella): il settimo giro ne ha chiusa una.
  La regola buona è una sola riga in `_maybeBlockNavigation`
  (`src/main/tabs.js`): `soloListaUtente` segue `indirizzoDellUtente` quando
  chi chiama non dice altro. L'indirizzo è dell'utente quando l'ha scritto lui
  nella barra o l'ha chiesto a Filo; un link, un popup, un rimbalzo, un
  riquadro, una ricarica e i tasti avanti/indietro non lo sono. Così le liste
  pubbliche escono da tutte le strade insieme, invece di uscirne una per giro,
  e le schede aperte da un link lo dichiarano (`openedByLink`) invece di
  spacciarsi per indirizzi dell'utente.
- **Il filtro delle richieste non annulla il documento che la scheda sta
  aprendo.** È l'altra metà, e da sola bastava a far morire il link: l'unico
  `onBeforeRequest` della sessione (`src/main/services/cookies.js`) annullava
  anche le richieste di tipo `mainFrame`, quindi il contatore di clic veniva
  cancellato a livello di rete e l'articolo non arrivava nemmeno quando la
  decisione sulla navigazione lo lasciava passare. Quelle liste esistono per
  potare quello che una pagina si tira dentro. A fermare una SCHEDA è la lista
  dei siti bloccati, che lo dice e lascia una via d'uscita; sotto, si pota e
  basta. Effetto collaterale voluto: "Apri comunque" su un blocco venuto dalle
  liste pubbliche adesso apre davvero, mentre prima lasciava una scheda bianca.
- **Un divieto vale anche su quello che non è una pagina.** La lista scritta
  dall'utente ferma anche uno scaricamento da quel sito
  (`DOWNLOAD_LINK`/`DOWNLOAD_IMAGE`/`DOWNLOAD_MEDIA` in
  `src/main/services/handlers/misc.js`): i byte di un'immagine o di un filmato
  li prende il main per conto suo, fuori dalla sessione della scheda, quindi
  non incontrano nemmeno il filtro delle richieste.
- **Un avviso "una volta sola" si conta per pagina, non per scheda.** Una scheda
  vive quanto vuole l'utente: un conto che non riparte al cambio di pagina
  spegne l'avviso per sempre dopo la prima volta, e dalla seconda pagina in poi
  il contenuto potato torna a sembrare un guasto.

Come si prova, dato che serve una lista pubblica vera: la si scrive a mano nella
cartella dei dati prima di avviare Filo (`<userData>/adblock/lists.json`), che è
lo stesso posto da cui Filo la rilegge all'avvio. Le prove stanno in
`tests/siteBlock-liste-pubbliche.spec.mjs`, e la logica della decisione in
`tests/unit/siteBlock.test.mjs`.
