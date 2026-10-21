# Una richiesta per conto della scheda esce dalla scheda

[← Tutti i pattern](../PATTERNS.md)

Quando il main chiede qualcosa alla rete perché una scheda gli serve (il titolo di un link al tasto destro, i byte di
un'immagine, l'llms.txt dell'Aiuto, l'icona, il link accorciato da seguire), il sito deve vedere la stessa cosa che
vedrebbe se la richiesta partisse dalla pagina: stessa sessione, stesso proxy, stessa identità. E non deve sapere di
più di quanto gli direbbe la pagina.

## Il caso (#1272, che unisce #1080, #946.3 e #753.1)

In una scheda aperta «da un altro paese» il proxy viveva solo nella partizione della scheda. Il main invece scaricava
col fetch di Node o con `http`/`https` di Node: l'anteprima di un link partiva dall'IP vero con l'identità «node»,
l'llms.txt anche, i byte delle immagini (descrizione, etichette d'origine, «Copia immagine», le dodici immagini
dell'Aiuto, «Salva immagine come…») pure, ignorando anche il proxy di sistema, i certificati della macchina e la
cache: dietro un proxy aziendale obbligatorio le foto di altri domini non si leggevano mai. La finestra nascosta che
segue i link accorciati usava una sessione sua, senza proxy. E per le immagini il Referer era l'indirizzo intero
della scheda, con ricerche e codici, anche da https a http.

## La regola

- **Si passa da `perContoDellaScheda(sender, url, opz)`** (`src/main/services/perContoDellaScheda.js`). Usa il `net`
  di Electron sulla sessione della scheda: proxy, cache, cookie se servono, protezioni della sessione (GPC, blocco
  tracker) e lo user agent della scheda. Il fetch della sessione non basta: non sa fermarsi a un rimando (lo
  rifiuta) e non risponde al proxy che chiede la password (407).
- **Ogni rimando si ricontrolla** contro la rete interna. Un indirizzo di casa scritto per intero (IP, `localhost`,
  `.local`) resta fuori sempre; un nome si chiede al DNS di casa solo se la richiesta va diretta. Dietro un proxy il
  nome lo risolve lui: chiederlo al DNS locale direbbe dove va la scheda proprio a chi la scheda evita.
- **Il Referer è al massimo l'origine della pagina** (`origin + '/'`), niente da https a http, niente se la pagina
  o l'elemento chiedono `no-referrer` (o `same-origin` verso un'altra origine). In un riquadro conta il riquadro
  (`sender.frame.url`; `sender.url` è la scheda). La politica del `<meta>` e dell'attributo la manda il content
  script; quella dell'intestazione la ricorda il main quando arriva il documento (`onCompleted` in `cookies.js`).
  La `referrerPolicy` della richiesta deve dare esattamente il Referer che si manda: il servizio di rete di Chromium
  annulla con `ERR_BLOCKED_BY_CLIENT` una richiesta il cui Referer non torna con la sua politica. Era questa, e non
  il blocco della pubblicità, la vecchia ragione per cui «una richiesta partita dal main viene bloccata».
- **Un caricamento in una finestra nascosta** prende le regole del proxy della scheda (`ProxyTab.reteDellaSessione`)
  prima di caricare, con le credenziali e WebRTC solo dal proxy; se il proxy non si applica, non carica.
- **Senza una scheda viva non parte niente.** Chi chiede senza `sender` non ha una rete da usare.

## Dove sta

- `src/main/services/perContoDellaScheda.js`: la richiesta, il Referer, la politica dei documenti.
- `src/main/services/proxyTab.js`: regole e credenziali per sessione (`registraRete`, `reteDellaSessione`).
- Chi la usa: `handlers/misc.js` (anteprima dei link, byte delle immagini e dei filmati), `llmsTxt.js`,
  `safebrowse/sandbox.js` (la finestra nascosta). L'icona della scheda (`iconaScheda.js`) usa già la sessione della
  scheda col suo fetch.
- Prove: `tests/unit/perContoDellaScheda.test.mjs`, `tests/unit/safebrowseFinestraProxy.test.mjs`,
  `tests/proxy-tab.spec.mjs`.
