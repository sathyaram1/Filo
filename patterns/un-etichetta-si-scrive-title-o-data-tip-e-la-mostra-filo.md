# Un'etichetta si scrive title o data-tip e la mostra Filo

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Un hover con una o due parole (o un testo più lungo, anche su più righe col `\n`) si scrive come
attributo: `title` o `data-tip`. A disegnarlo ci pensa il modulo condiviso `src/shared/suggerimento.js`
(`SN_SUGGERIMENTO`), mai un tooltip fatto a mano nella pagina. Un tasto di sola icona con `aria-label` ha già il suo
fumetto anche senza `title`; `data-tip=""` su un pezzo dice «qui niente fumetto».

**Perché.** Il `title` da solo apre il rettangolo bianco di Chromium, che non è di Filo. Prima di #2095 lo stile Filo
esisteva in quattro posti separati (il fumetto a finestra della barra, le etichette `::after` della chat, il glossario
della Trasparenza, nient'altro) e quasi cinquecento `title` uscivano nativi. Un modulo solo che guarda gli attributi
copre anche il `title` scritto domani da chi non conosce questa regola.

**Come funziona.**
- Il modulo toglie il `title` quando arriva il puntatore (prima che Chromium lo legga: il nativo legge il titolo dopo
  che la pagina ha visto il movimento), lo rimette all'uscita e alla pressione di un tasto del mouse: chi legge il
  `title` al clic, al tasto destro o in una prova lo trova. Un `title` riscritto dal codice durante il passaggio
  diventa il valore da rimettere.
- Ritardo (token `fumetto.ritardo`), colori (`fumetto.sfondo`, `fumetto.testo`, `fumetto.bordo`), forma e
  larghezza (320 px) sono gli stessi del fumetto della barra: il main li passa alla sua finestra
  (`src/main/movimento.js`). Si cambiano in Preferenze → Avanzate o a parole, come gli altri token.
- Sparisce col clic, lo scorrimento, l'Esc e la perdita del fuoco; compare anche col fuoco da tastiera (non con
  quello che un campo prende da solo all'apertura).
- Sta nello strato più alto (popover), dentro uno shadow aperto: sopra le finestre modali e lontano dal CSS della pagina.
- Sui siti tocca solo i pezzi marcati da `SN_FILO_UI`: i `title` del sito restano del sito.
- Un pezzo in uno shadow chiuso (la conferma, il menu, i riquadri) il documento lo vede come il solo host: il modulo ci
  scende col punto del puntatore se la radice è nata da `SN_FILO_UI.ombra`; una radice chiusa fatta a mano si
  dichiara con `SN_SUGGERIMENTO.ombra(host, radice)`, altrimenti i suoi `title` escono nativi.
- Chi aveva un'etichetta sua (le icone del menu) la scrive in `data-tip`, scorciatoia compresa, e non la disegna:
  `SN_SUGGERIMENTO.nascondi()` per chi sposta i pezzi sotto il puntatore, l'evento `sn-fumetto-mostrato` sul pezzo
  per chi conta le etichette lette.
- Il `title` di un `iframe` resta nativo: serve allo screen reader, e il riquadro è un altro documento.

**Dove si carica.** Dai preload delle pagine di Filo (`internal-preload.js`), dei siti (`page-preload.js`) e dello
strato dei riquadri, e da `menu.html` e `conferma.html` (la conferma sopra un sito, con `filoUi.js` prima). La barra in alto ha il suo fumetto a finestra (`data-tip`, delega in
`shell.js`), perché la shell sta sotto le pagine. Sentinella: `tests/unit/suggerimentoOvunque.test.mjs`; prove
nell'app: `tests/suggerimento-filo.spec.mjs`.

**Cosa resta fuori.** Le etichette `::after` dei tasti sotto una risposta (Copia, Rispondi) non sono un fumetto:
stanno nella riga e danno l'esito del clic («Copiato»); un pezzo con `data-etichetta` il fumetto lo salta, per non
dire due volte la stessa parola. Gli `option` di un `select` a tendina li disegna il sistema.
