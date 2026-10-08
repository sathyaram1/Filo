# Un pezzo di Filo dentro un sito ubbidisce solo all'utente

[← Tutti i pattern](../PATTERNS.md)

Il menu del tasto destro, i riquadri, la barra d'aiuto vivono nel documento del
sito. Il mondo isolato tiene separati gli oggetti JavaScript, **non il DOM**: lo
script della pagina raggiunge i nostri nodi come raggiunge i suoi, ci fabbrica
sopra clic, passaggi e tasti, e legge il testo che ci scriviamo.

Il caso (#589.8): copiata una password, l'utente apre un sito e clicca un suo
pulsante. Il sito manda alla sua casella un tasto destro creato da script, preme
da script la freccia di Incolla e legge la cronologia degli appunti dal
sottomenu. Può nascondere il menu e toglierlo subito: l'utente non vede niente.
Il controllo del main sul gesto recente non bastava, perché un gesto vero c'era:
il clic sul pulsante del sito.

## Le due regole

1. **Solo gesti veri.** Ogni ingresso accetta solo eventi `isTrusted`:
   - il tasto destro che apre il menu, nel ponte del page-preload (vale anche nei
     riquadri incorporati, dove il ponte rigioca il clic);
   - clic, passaggi, tasti, rotella sulle voci: `SN_FILO_UI.soloGestiVeri(el)`
     (`src/shared/filoUi.js`) mette il cancello su **ogni nodo** del pezzo, non
     solo sulla radice: il sito può spostare un pulsante fuori dal menu, nella
     sua pagina, e premerlo lì (#589.8, giro 3: Incolla gli dava gli appunti,
     Detta accendeva il microfono). Si chiama **prima** di attaccare il pezzo al
     documento (`monta` in `src/content/menu.js`), perché un osservatore del sito
     creato prima del nostro vede il nodo per primo; per ciò che entra dopo c'è un
     osservatore di riserva;
   - un ascoltatore su `window`/`document` che fa qualcosa di più che chiudere
     (il trascinamento delle icone) guarda `e.isTrusted` da sé, come fa già il
     cartellino dello zoom (`gestoVero` in `src/preload/wheel-zoom.js`).

   Un'azione nostra che apre un pannello chiama la funzione, non `el.click()`:
   il clic fabbricato da codice nostro è identico a quello del sito, e il
   cancello lo ferma (`apritori` in `src/content/menu.js`).

   Eccezioni volute: **chiudere** resta aperto ai finti (l'Esc che Filo rimette
   in circolo per lo schermo intero, #514, non è fidato e deve chiudere il menu;
   chiudere non dà niente al sito). Sulle pagine `filo://` il codice è tutto
   nostro: lì il menu si apre anche da un evento fabbricato, e gli spec lo usano.

2. **Quello che non è del sito non entra nel suo documento come testo.** La
   cronologia degli appunti arriva da altri siti e da altre app, password
   comprese: anche aperta dall'utente, il sito non deve poterla leggere. Sta in
   uno shadow root `closed`, e nel documento c'è solo un host vuoto. I fogli di
   stile del documento lì dentro non arrivano: si portano i nostri con
   `adoptedStyleSheets` (che la CSP del sito non blocca, un `<style>` sì). Stesso
   schema del dialogo di conferma (#249, `src/shared/confirmUi.js`).

   Lo shadow chiuso ferma `innerHTML`, la selezione e `getComputedStyle`, **ma
   non `window.find`**: la ricerca testuale del browser attraversa anche lo
   shadow chiuso e, interrogata lettera per lettera da uno script, ricostruisce
   un **nodo di testo** parola per parola (#589.8, il buco che la sola scatola
   chiusa lasciava aperto). La regola unica: il testo di una voce **non diventa
   mai un nodo di testo** nel documento. Lo si rende come **contenuto generato**
   (`::before { content: var(--sn-gentesto) }`) da una proprietà posata
   sull'elemento dentro lo shadow chiuso — glifi, non testo cercabile — e il nome
   accessibile sta in un **attributo** (`aria-label`), che la ricerca non trova e
   che il sito non legge oltre il confine dello shadow chiuso. `window.find` non
   guarda dentro il contenuto generato; così nessuna strada del sito (find,
   `innerHTML`, selezione, `getComputedStyle`) vede i caratteri. Un dato privato
   nuovo nel menu segue la stessa regola: niente nodo di testo.

   Anche i **font** passano il confine: un `@font-face` del documento vale
   dentro lo shadow, e una variabile come `--sn-font` arriva per eredità (`all:
   initial` non tocca le variabili). Un font del sito diviso in un pezzo per
   carattere (`unicode-range`) dice, da quali pezzi il browser carica, quali
   caratteri il pannello ha disegnato (#589.8, giro 2). Sui siti il pannello
   chiuso usa solo **famiglie generiche** (`system-ui, sans-serif`), che nessun
   `@font-face` rimpiazza; un font chiamato per nome, anche quello scelto
   dall'utente, lì non entra. Sulle pagine `filo://` il font dell'utente resta.

Il resto del menu resta nel documento: non porta dati di altri siti, e una
settantina di spec lo guarda coi locator. Se un giorno ci entra un dato privato
(appunti, password, cose di un'altra scheda), entra in un pannello chiuso.

## I riquadri: spiegazione, Modifica, feedback, attacco red-team

Il caso (#1071): la bozza del feedback iniziata su un sito tornava nella casella
aperta su un altro, che la leggeva insieme agli allegati; e lo script del sito
premeva Invia, o l'invio della domanda nella spiegazione e nella Modifica, e
faceva spendere una chiamata.

- **Un riquadro che porta parole dell'utente o di un modello, in un sito, sta in
  uno shadow root chiuso**: `SN_POPUP.riquadro(contenuto)` (`src/content/popup.js`)
  mette un host `display: contents` (posa, z-index e zoom restano quelli del
  riquadro), adotta i nostri fogli con le sole famiglie generiche e chiude ai
  gesti finti il contenuto. Sulle pagine `filo://` il riquadro resta nel
  documento: lì non c'è codice di altri.
- **L'azione che spende o manda guarda da sé `e.isTrusted`**: Invia del
  feedback e dell'attacco red-team, la domanda della spiegazione, la riscrittura
  e Sostituisci della Modifica, Allega. Un incolla fabbricato non allega niente.
- **Chi ascolta su window o sul documento** vede l'host, non il campo toccato:
  il nodo vero lo dà `SN_FILO_UI.bersaglio(e)` (il tasto destro dentro la casella
  del feedback apre il menu di un campo di testo; il correttore si aggancia alla
  casella dal focus). Un aiuto che ripete il testo della casella, come lo strato
  delle sottolineature del correttore, sta dentro lo stesso riquadro chiuso, mai
  nel documento. Col fuoco dentro un riquadro
  chiuso si sta scrivendo (`data-sn-riquadro`, regola in
  `src/shared/campoTesto.js`): Ctrl/Cmd+Z annulla, non porta via la pagina.
  Lo stesso vale per il sito, che da fuori vede l'host e non un campo: le sue
  scorciatoie a un tasto («k» pausa, «/» alla ricerca) si prenderebbero quello
  che l'utente scrive. I tasti si fermano alla radice del riquadro, in bolla;
  l'Esc no (chiude in cattura, e serve allo schermo intero, #514). Un ascoltatore
  di quelli che dal nodo vero **fa** qualcosa (aprire un collegamento) accetta
  solo il gesto vero: un clic finto sull'host, con le coordinate giuste, ci
  arriva.
- **Un evento che fabbrica Filo stesso** verso un campo di un riquadro (l'Incolla
  del menu, la correzione, Sostituisci della Modifica) si segna con `SN_FILO_UI.nostro(ev)`: il cancello lo
  lascia passare, la copia che vede il sito non è nell'elenco.
- **Una bozza resta al sito dove è nata, e lo decide il main**: la chiave porta
  l'origine (`sn_feedback_draft_text@<origine>`, `BOZZE_PER_SITO` in
  `impostazioniPerOrigine.js`), concessa solo al riquadro che ha davvero
  quell'origine (`frame.origin`), mai a un documento senza origine. Le pagine di
  Filo tengono la loro, che a un sito non arriva.

## Provarlo

I locator non attraversano uno shadow root chiuso, e il testo non è un nodo ma
contenuto generato. Lo stato del pannello si chiede a `SN_MENU._test.cronologia()`
nel mondo dei content script (isolato sui siti, la pagina stessa su `filo://`)
con `tests/helpers/cronologiaAppunti.mjs`: il testo di ogni voce lo legge
dall'`aria-label`, non dal nodo. I clic sono quelli veri del mouse sulle
coordinate che l'hook restituisce. Sui siti la pagina non vede l'hook: vive nel
mondo isolato.

La prova dell'attacco sta in `tests/menu-solo-gesti-veri.spec.mjs`: lo script
del sito fa tutto da sé dentro il clic dell'utente, anche da un riquadro di un
altro sito, e la cronologia non gli arriva; a cronologia aperta dall'utente la
ricerca testuale del browser, interrogata lettera per lettera, non ricostruisce
il testo, che l'utente intanto vede e incolla.

I riquadri chiusi si guardano con `tests/helpers/riquadri.mjs` (lo stesso hook,
`SN_FILO_UI._test.trova`, nel mondo dei content script); la prova dell'attacco
sta in `tests/riquadri-solo-utente.spec.mjs`.

## Limite noto

Un sito controlla lo stile dei nodi che stanno nel suo documento: può nascondere
o coprire il menu e far cliccare all'utente un punto che non vede. È un gesto
vero, quindi passa. Il cancello chiude le strade senza l'utente, non il raggiro.

Lo shadow chiuso non nasconde il **testo**: `window.find` trova anche quello
scritto in una casella dentro un riquadro chiuso, e `getSelection().modify()`
allarga la selezione trovata fino alla riga intera, che `toString()` restituisce
(#1071). Basta indovinare una lettera. Ancora più semplice: i tasti e gli
inserimenti escono dallo shadow verso la finestra del sito, che in cattura li
ascolta prima di noi (fermarli alla radice toglie solo la bolla, e con lei le
scorciatoie comuni del sito), e un `execCommand` del sito scrive nella casella che ha il fuoco (#1071.1). Il testo di una voce si può rendere come
contenuto generato (regola 2), quello che l'utente scrive in una casella no: per
toglierlo davvero al sito il riquadro deve stare fuori dal suo documento, in una
vista sopra la scheda come gli avvisi
([Un avviso su una pagina non sta dentro la pagina](un-avviso-su-una-pagina-non-sta-dentro-la-pagina.md)).
