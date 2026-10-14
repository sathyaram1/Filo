# Un dato dell'utente proposto a un sito arriva con la scelta

[← Tutti i pattern](../PATTERNS.md)

Quando Filo propone a un sito un dato dell'utente da inserire (l'email dell'account oggi, password e indirizzi
domani), la proposta la disegna il main in una vista sopra la scheda, e il dato arriva al frame del campo solo
nel momento in cui l'utente l'ha scelta. Prima di quel momento nessun pezzo di Filo nel documento lo conosce.

## Il caso (#1124)

Filo non ha l'autocompilazione di Chrome (Electron non la include), e sulla pagina di accesso di Google l'owner
non trovava la sua email. La porta che dice chi è entrato (`MSG.AUTH_STATUS`) è chiusa ai siti di proposito: un
content script gira dentro il documento del sito, e quello che scrive lì il sito lo legge. Quindi la proposta
non poteva stare nel DOM della pagina, nemmeno in uno shadow root chiuso (`window.find` e la selezione la
raggiungono, vedi [Un pezzo di Filo dentro un sito ubbidisce solo all'utente](un-pezzo-di-filo-in-un-sito-ubbidisce-solo-all-utente.md)).

## La regola

- **Il content script porta solo il campo**: dov'è (px CSS della scheda, risalendo i riquadri della stessa
  origine), cosa contiene, e se quel valore l'ha scritto l'utente. La risposta dice solo «seguilo» o no.
- **Il main decide e disegna**: interruttore, account, incognito, pagina di Filo; la vista sta sopra la
  scheda, grande quanto il riquadro, e non tiene la tastiera (un clic gliela dà, torna al campo al giro dopo).
  Frecce, Invio ed Esc li prende dal `before-input-event` della scheda, prima del documento.
- **Il dato parte alla scelta e solo verso quel frame**, ricontrollati frame vivo, origine e account; il content
  script lo scrive con `execCommand('insertText')`, così la pagina riceve un `input` vero, poi `change`.
- **Un valore messo dalla pagina non conta**: si propone a campo vuoto o con l'inizio scritto dall'utente, se no
  la pagina proverebbe un prefisso alla volta e saprebbe, dai tasti che non riceve, quando c'è una proposta.
- **Un clic vale dopo mezzo secondo di proposta ferma**: la pagina può farla comparire sotto il cursore.

## Dove vive

- `src/main/propostaEmail.js` (vista, tasti, scelta), `src/content/propostaEmail.js` (il campo),
  `src/shared/campoAccesso.js` (quali campi, quando proporre), `src/renderer/proposta-email.*`.
- Prove: `tests/proposta-email.spec.mjs` (la pagina non trova l'email prima della scelta, la riceve dopo con un
  `input` vero), `tests/unit/campoAccesso.test.mjs`.
- Limite: un campo dentro un riquadro di un'altra origine non ha proposta, perché il frame non sa dove sta il
  suo riquadro nella pagina.
