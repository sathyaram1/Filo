# Quello che SPINGI a una scheda segue il confine di quello che le lasci chiedere

[← Tutti i pattern](../PATTERNS.md)

Il gate d'origine sugli handler difende **le richieste**: un sito chiede, Filo
guarda l'origine e dice no. Ma Filo parla anche per primo — `broadcastToTabs`
manda un messaggio a **ogni scheda e ogni riquadro**, il content script del sito
visitato compreso. Su quella strada non c'è nessun gate: il confine devi
metterlo tu, nel momento in cui scrivi il broadcast.

Se un sito non lo può **chiedere**, non glielo si può nemmeno **mandare**.

- **Due strade sullo stesso dato = una funzione sola.** La lettura a richiesta e
  la spinta devono passare per la stessa funzione. Finché sono due pezzi di
  codice che fanno «più o meno» la stessa cosa, divergono: nel #589 la lettura
  toglieva `settings.apiKeys` e la spinta mandava l'oggetto intero — chiavi dei
  servizi a pagamento e credenziali del proxy comprese — a ogni pagina aperta.
- **Verso le pagine web si dichiara cosa PASSA, non cosa si toglie.** Una lista
  di esclusioni protegge solo i segreti che qualcuno si è ricordato di
  elencare; il prossimo campo aggiunto alle impostazioni esce da solo. Con una
  lista di campi ammessi (`src/shared/settingsScope.js`) resta fuori da solo, e
  una sentinella negli unit test legge tutto il codice che gira dentro una
  pagina web — `src/content/*.js` **più** i moduli di `src/shared` che
  `page-preload.js` carica lì accanto — per accorgersi del caso opposto: un
  campo che a quel codice serve e la lista non ammette. L'elenco dei condivisi
  si ricava da `page-preload.js`, non si scrive a mano, o la sentinella resta
  indietro al primo modulo nuovo.
- **La stessa regola vale su ogni messaggio, non solo sulle impostazioni.** Il
  primo giro di verifica del #589 ha trovato la porta gemella ancora aperta: il
  cambio di stato dell'account (profilo Google e contrassegno di
  amministratore) e i movimenti del saldo crediti partivano con
  `broadcastToTabs` verso ogni sito aperto, e nessun content script li ascolta.
  Quando chiudi una porta di questa famiglia, passa in rassegna **tutti** i
  `broadcastToTabs` e chiediti per ciascuno chi lo legge davvero dentro una
  pagina: quello che non legge nessuno va su `broadcastToFiloPages`. E guarda
  anche il verso della richiesta — `AUTH_STATUS` rispondeva a un sito con
  email, identità Firebase e poteri, quando lì serve solo «c'è un accesso?».
- **Il destinatario è il FRAME, non la scheda.** Una scheda web può ospitare un
  riquadro, e la pagina e il riquadro possono avere origini diverse: il payload
  si sceglie per frame (`sendToEachFrame` in `src/main/services/handlers.js`),
  guardando `frame.url`.
- **Se il messaggio non serve a nessun content script, non passa di lì.**
  `broadcastToFiloPages` parla alle sole superfici interne: è la scelta giusta
  per tutto ciò che porta dati dell'utente (lo stato dell'intervista di
  benvenuto, il messaggio della home generato dalla memoria, l'elenco delle
  fusioni in attesa).
- **Provalo dove il messaggio viene consegnato.** `tests/settings-web-scope.spec.mjs`
  registra il broadcast all'ultimo passaggio prima del renderer e confronta
  quello che riceve la pagina del mini server con quello che riceve la pagina
  `filo://` — e, nello stesso test, che la spinta continui a funzionare
  (altrimenti la difesa ha spento una funzione).
- **Una finestra non è per forza una superficie di Filo.** Il secondo giro di
  verifica del #589 ha trovato il riparo scavalcato da lì: i broadcast
  sceglievano il payload per frame nelle schede, ma alla finestra mandavano
  l'oggetto intero con un `win.webContents.send(...)` che dava per scontato di
  parlare alla shell. I popup di accesso («Continua con Google») sono finestre
  vere, ci gira dentro la pagina di un sito e Filo ci monta sopra il suo
  preload apposta (`_allowAuthPopup` in `src/main/tabs.js`): con un accesso
  aperto, il primo salvataggio di una preferenza ci portava chiavi e password
  del proxy. Ogni giro su `BrowserWindow.getAllWindows()` guarda
  `win.webContents.getURL()` come guarderebbe l'indirizzo di un frame.
- **Dal verso della richiesta la lista è una sola, e sta in un posto solo.**
  Finché il confine d'origine stava sui singoli handler, quelli aggiunti dopo
  nascevano aperti: un sito che chiedeva otteneva la memoria che Filo si è
  costruito sull'utente, le pagine messe da parte, lo stato della home e
  l'uscita dall'account. Oggi la lista dei messaggi che una pagina web può
  mandare è dichiarata in `src/shared/webMessageScope.js` e applicata una volta
  sola in `handleMessage`; la sentinella in `tests/unit/webMessageScope.test.mjs`
  la confronta con quello che i file dentro le pagine mandano davvero. Il
  confine è l'origine **http/https**, non «tutto ciò che non è `filo://`»: i
  menu nativi del tasto destro vivono su un indirizzo `data:` e le chiamate
  interne del main non hanno origine, e non sono la pagina di un sito.
