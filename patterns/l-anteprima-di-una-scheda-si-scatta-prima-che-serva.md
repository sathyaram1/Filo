# L'anteprima di una scheda si scatta prima che serva

[← Tutti i pattern](../PATTERNS.md)

La carta che compare passando sopra una scheda (#430) non deve mai aspettare: al
momento dell'hover la foto è già nel main e già decodificata nella carta. Quindi
la foto si scatta quando la pagina è ancora a schermo, non quando qualcuno la
chiede.

- **Perché:** una scheda dietro ha l'area a zero e, dopo il primo cambio di
  scheda, è nascosta. Da nascosta non si disegna: una foto chiesta all'hover
  restituisce vuoto o l'ultimo fotogramma rimasto, e costerebbe comunque il
  tempo di una cattura.
- **La scheda davanti, quando va dietro.** La foto si chiede un attimo PRIMA di
  cambiare scheda (in `activate` e nell'apertura di una scheda davanti), così
  mostra quello che l'utente ci ha visto per ultimo.
- **La scheda nata dietro.** Una scheda aperta in secondo piano (un link, il
  ripristino della sessione) non si è mai disegnata. Resta «visibile» a zero
  finché non ha la sua foto, anche se nel frattempo si cambia scheda: nascosta
  non si disegnerebbe più. Finito di caricare, per un attimo prende l'area della
  pagina ma va in fondo alle viste (`addChildView(vista, 0)`), sotto quella
  davanti che la copre tutta; il layout lo sa e non la rimpicciolisce a metà.
  Una alla volta, e mai mentre la scheda davanti è nascosta (menu della shell
  sopra la pagina) o la finestra non si vede: lì la si vedrebbe, o non verrebbe.
- **La foto segue la pagina quando cambia, non a orari fissi.** Feed, posta e
  video riempiono la pagina dopo il caricamento, quando vogliono: alla prima
  foto sono bianchi, e un secondo scatto a tre secondi (che resta, per ciò che
  cambia senza toccare il DOM) non basta a una posta lenta. Una pagina dietro
  che l'utente non ha ancora visto ha una spia nel suo mondo isolato che conta i
  cambi del DOM e le immagini arrivate; il main la interroga a giri brevi e,
  quando la pagina è cambiata e si è fermata (o cambia da troppo), la
  rifotografa. Fra due foto per cambio l'attesa raddoppia, così una pagina che
  cambia sempre (un ticker, un video) costa poche foto; la spia si spegne quando
  la scheda viene davanti o un minuto e mezzo dopo l'ultimo cambio di pagina.
- **Una scheda dietro che cambia pagina da sola** (un rimando «Apertura in
  corso…», un aggiornamento, un sito a pagina unica che passa al video dopo
  senza ricaricare) torna seguita come una nata dietro, anche se l'utente l'aveva
  già vista: la carta non deve mai avere il titolo di una pagina e la foto di
  un'altra. Una foto chiesta lasciando la scheda e ancora in volo non copre
  quella scattata dopo. La stessa pagina vista e poi cambiata dietro (una chat)
  resta com'era: quello è l'ultimo che l'utente ci ha visto.
- **Una regola sola per lo scatto: la foto segue la pagina finché non si è
  fermata.** Vale anche per la scheda che l'utente lascia: se carica ancora, o
  la sua pagina è arrivata da meno di venti secondi (chi apre una posta e
  nell'attesa torna altrove), la foto del congedo è mezza vuota. La scheda si
  segue come una nata dietro: si rifà a caricamento finito, e la spia, messa
  nel momento del congedo, vede quello che arriva dopo. Una pagina lasciata
  ferma da più di venti secondi resta com'era.
- **Una foto dovuta non si perde.** Con la finestra ridotta a icona (o la
  pagina davanti nascosta) la foto aspetta senza consumare tentativi; se i
  tentativi finiscono perché la cattura torna vuota (su Windows una finestra
  coperta da un'altra smette di disegnare senza dirlo), la foto resta dovuta.
  Quando la finestra torna (riaperta, mostrata, rimessa a fuoco) ogni scheda di
  dietro che la aspetta torna in coda.
- **La carta** è una finestra figlia (`src/main/popup-anteprima.js`, strada 2 di
  [la shell non disegna sopra la pagina](la-shell-non-disegna-sopra-la-pagina.md)):
  non prende il puntatore né la tastiera, nasce quando il puntatore entra nella
  barra e riceve tutte le foto in quel momento, poi ognuna appena scattata; se è
  aperta sulla scheda di quella foto, la mostra subito, senza uscire e rientrare.
  Prima di sparire si svuota, così chi la rivede non trova per un istante la
  scheda di prima. Col menu del tasto destro aperto aspetta che si chiuda: gli
  finirebbe sotto, mezza coperta.
- **La prima compare dopo un attimo**, per non accendersi attraversando la
  barra; da lì, finché si resta sulle schede, passa dall'una all'altra subito.
  La barra si ridisegna a ogni titolo o icona che cambia: l'attesa della stessa
  scheda non riparte al ridisegno, e se la scheda è sotto il puntatore lo dice
  la posizione del puntatore, perché una scheda appena rifatta non ha ancora
  `:hover`.
  Sulla scheda davanti non c'è foto: la pagina si vede già.
- **Le foto stanno in memoria**, mai su disco (anche in incognito), e se ne
  vanno con la scheda.
- **Test:** `tests/tab-preview.spec.mjs` guarda la carta vera e il colore dei
  suoi pixel, per la scheda lasciata dietro, per quella nata dietro, per quella
  nascosta prima di finire di caricare, per quella che si riempie dopo (anche
  cinque secondi dopo), per quella che cambia pagina da sola (anche senza
  ricaricare), per la carta aperta mentre arriva la foto, col menu aperto e con
  la barra che si ridisegna di continuo; `tests/unit/anteprimeSchede.test.mjs`
  tiene la regola della spia con viste finte.
