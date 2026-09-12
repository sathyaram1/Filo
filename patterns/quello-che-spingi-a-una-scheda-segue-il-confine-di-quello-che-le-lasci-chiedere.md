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
  una sentinella negli unit test legge `src/content/*.js` per accorgersi del
  caso opposto — un campo che ai content script serve e la lista non ammette.
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
