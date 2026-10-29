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

## Le tre regole

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
     cartellino dello zoom (`gestoVero` in `src/preload/wheel-zoom.js`);
   - un pezzo che sta nel documento senza cancello sulla radice (la pila degli
     avvisi con la conferma di «Salva per dopo», il riquadro da scegliere per
     catturare o trascrivere, il QR, i bottoni sotto le risposte dell'Aiuto)
     chiede `SN_FILO_UI.gestoVero(e)` in **ogni** ascoltatore che fa avanzare
     (#592.16): `tests/pezzi-nella-pagina-solo-utente.spec.mjs`.

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

3. **Un clic conta solo dove l'utente vedeva la voce.** Il caso (#589.11): dopo
   un tasto destro vero sul suo campo, il sito stende sopra tutto un velo bianco
   che il mouse attraversa (`pointer-events: none`), con due quadrati da cliccare:
   uno sulla freccia di Incolla, uno sulla prima voce della cronologia. I gesti
   sono veri, la regola 1 li lascia passare, e la password finisce nel campo.
   La guardia (`src/content/vistoDavvero.js`) chiede al browser se la voce è
   scoperta (IntersectionObserver v2, `isVisible`) e conta il clic solo allora:
   - **non lo chiede alla voce** ma a una **sonda** trasparente posata sopra di
     lei: la compensazione dello zoom, la sfocatura dietro al menu e la sua
     dissolvenza fanno rispondere «non visibile» a ogni voce. Le sonde stanno in
     un host chiuso, **allo stesso piano del menu e subito dopo i suoi pezzi**:
     le copre tutto ciò che copre il menu, mai il menu, i sotto-menu o le
     etichette. Per questo ogni pezzo entra da `monta` (prima delle sonde), e
     etichetta e anteprima del trascinamento stanno sul piano del menu
     (2147483646), non sopra;
   - le sonde sono **in catena**, ognuna dentro la precedente: due sonde
     sovrapposte (dove due pannelli si toccano) si coprirebbero, un discendente
     no. Una voce nascosta porta la sonda fuori dallo schermo, mai a
     `display: none`, che nasconderebbe la catena sotto di lei;
   - il browser ricalcola le coperture solo se qualcosa cambia forma: uno
     z-index alzato da solo non lo vede. Un pixel che va e viene a ogni
     fotogramma, nell'host, lo costringe a guardare;
   - posizione, piano e `display` del pannello sono **inchiodati in linea con
     `!important`** e rimessi a posto a ogni cambio: un foglio del sito che
     abbassa il menu sotto il suo velo lascerebbe il velo fra il menu e le
     sonde. Lo stesso per l'host delle sonde, anche contro `popover`;
   - una voce **scoperta da poco aspetta mezzo secondo**: un velo tolto mentre
     la mano arriva non lascia il tempo di vedere. Non aspetta chi compare
     (menu appena aperto, voce rivelata da un filtro) e chi era coperto da un
     pezzo di Filo sopra al menu (la conferma di «Svuota»), se il browser lo
     dice appena quel pezzo se ne va. La pila degli avvisi invece, finché il
     menu è aperto, scende sotto il suo piano: un avviso sopra copriva le voci
     del menu aperto su di lui e «Chiudi» veniva fermato (#1453);
   - si giudica alla **pressione**; un clic da tastiera, che non ha pressione, si
     giudica lì. Un clic fermato chiude il menu e lo dice con un avviso;
   - lo **zoom del foglio di stile** sul contenitore (`html { zoom: 2 }`)
     moltiplica le misure di ciò che ci sta dentro: menu e sonde, posati con le
     misure dello schermo, finivano altrove (il menu fuori dallo schermo, le
     sonde lontano da un velo steso solo sul menu, #589.11 giro 4). Ogni pezzo
     che entra da `monta` e l'host delle sonde lo annullano (`zoom: 1/z`); l'host
     lo rilegge a ogni fotogramma, perché il sito può cambiarlo a menu aperto;
   - una **finestra modale** del sito (`<dialog>` con `showModal`) sta nello
     strato più alto e rende inerte il resto del documento: il menu montato su
     `<html>` restava sotto, grigio, e non rispondeva. Lì i pezzi entrano in un
     nostro `popover` dentro la finestra: non inerte, perché discendente, e sopra
     di lei, perché aperto dopo. Un velo che il sito porta nello strato più alto
     dopo il menu copre anche le sonde, e il clic si ferma;
   - un pannello che **non è un pezzo del menu** ma ha bottoni che danno qualcosa
     al sito (la barra dell'Aiuto: il microfono, e il documento trovato che,
     trascinato, arriva alla pagina, #589.17) passa dalla stessa guardia:
     `sorveglia(pannello, { ancorato: true, voci, bloccato })`. Le sue sonde stanno
     in un **piano suo**, un host chiuso subito dopo il pannello e alla sua altezza.
     Al piano del menu lascerebbero passare un velo steso fra l'Aiuto e il menu.
     L'altezza la cambia la pila dei riquadri a ogni clic: Filo la inchioda in
     linea con `!important`, insieme alla posizione, e le sonde la seguono prima
     del disegno. Il trascinamento si giudica come il clic (`dragstart`); un
     pannello che resta aperto avvisa a ogni pressione fermata, un avviso alla
     volta. Gli effetti del contenitore restano sospesi finché il pannello è
     aperto, col fondo sotto il piano più basso: una pagina in grigio resta
     grigia, e l'Aiuto risponde.
   - un **pezzo di Filo sopra un pannello guardato** è un velo come quello del
     sito: la guardia non li distingue. Quello che accompagna un campo del
     pannello (lo specchio del correttore) sta **dentro** il pannello, sotto le
     sue sonde, e lo segue quando si sposta; gli avvisi stanno **a fianco**
     dell'Aiuto anche spostato (#1340, giro 4: trascinato l'Aiuto, lo specchio
     rimasto indietro copriva il microfono e ogni clic si fermava).

   Sulle pagine `filo://` la guardia è spenta: nessuno script può coprire il menu.

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
  che l'utente scrive, anche ascoltando in cattura (#1071, giro 3: fermarli alla
  radice del riquadro copriva solo chi ascolta dopo). Un tasto vero scritto in un
  riquadro lo prende Filo per primo, col ponte di `page-preload.js` registrato a
  document_start, e `SN_FILO_UI.tastoNelRiquadro` consegna al campo una copia
  segnata come nostra che non esce dallo shadow (chi la ascolta dentro guarda
  `veroONostro`, non `isTrusted`); se la copia viene annullata si annulla anche
  l'originale. L'Esc passa come prima (chiude in cattura, e serve allo schermo
  intero, #514). Un ascoltatore
  di quelli che dal nodo vero **fa** qualcosa (aprire un collegamento) accetta
  solo il gesto vero: un clic finto sull'host, con le coordinate giuste, ci
  arriva.
- **Un evento che fabbrica Filo stesso** verso un campo di un riquadro (l'Incolla
  del menu, la correzione, Sostituisci della Modifica) si segna con `SN_FILO_UI.nostro(ev)`: il cancello lo
  lascia passare, la copia che vede il sito non è nell'elenco.
- **Una casella cambia solo per un inserimento dell'utente o per mano di Filo**
  (#1071.1). Un `execCommand` del sito scrive nella casella che ha il fuoco anche
  dentro lo shadow chiuso; la casella dell'Aiuto sta nel documento, dove il sito
  ne scrive anche il `value` o fa `reset` al modulo. `SN_FILO_UI.soloScritturaVera`
  (la chiama `riquadro` per ogni sua casella, l'Aiuto per la sua) annulla ogni
  cambio che il browser non ha annunciato con un `beforeinput` fidato: tasti,
  incolla, composizione, correzione del sistema e annulla lo annunciano,
  l'`execCommand` di uno script no. Un inserimento che arriva **mentre se ne
  consegna un altro** (lo script che scrive dal suo ascolto di `beforeinput` o di
  `input`) non vale, a meno che a scrivere sia Filo. Filo scrive dal mondo
  isolato, dove il setter di `value`, `setRangeText`, i comandi della selezione ed
  `execCommand` sono avvolti e dicono alla guardia che il cambio è suo (Incolla
  del menu, correttore, Sostituisci, dettatura); il sito usa i suoi, nel suo
  mondo. Un `value` cambiato in silenzio torna a ogni fotogramma, e quello che
  l'Aiuto manda lo legge `SN_FILO_UI.valoreVero`. Insieme al testo torna la
  selezione che aveva lasciato l'utente: dopo un `selectAll` e un `delete` del
  sito, il tasto seguente non cancella tutto.

  L'annuncio non basta da solo (#1340): il sito agisce **dentro** il tasto, nei
  suoi ascolti di `beforeinput` che girano dopo il nostro (riscrive il `value`,
  seleziona tutto), oppure subito **dopo un annuncio che non ha scritto niente**
  (Backspace in testa alla casella). Quindi un cambio vale come dell'utente solo
  se ha lo stesso tipo dell'annuncio **e combacia** con l'annuncio applicato al
  testo e alla selezione di quel momento: un inserimento mette il suo `data` al
  posto della selezione (composizione compresa, che seleziona il pezzo che
  compone), Backspace e Canc tolgono un solo carattere come lo vede l'utente
  (`Intl.Segmenter`), le altre cancellazioni tolgono e basta, attaccate al
  cursore. Se non combacia, Filo rimette il tasto dell'utente sul suo testo.
  Annulla e rifai valgono solo se riportano un testo che la casella ha già avuto;
  il rilascio di un trascinamento e la sostituzione del correttore solo se il loro
  testo è entrato in un punto e il resto è rimasto.

  **Anche Filo annuncia.** Un suo `execCommand` (la correzione del correttore, il
  suggerimento del correttore di sistema) dice cosa scrive e dove, e il cambio
  vale solo se combacia, come quello dell'utente (#1340, giro 3: nell'Aiuto il
  sito aggiungeva il suo testo dentro la correzione, e partiva come di Filo).
  Prima del comando un cambio silenzioso del sito torna indietro.

  **Filo guarda la selezione prima del sito.** Il ponte di `page-preload.js`,
  registrato a document_start, chiama `SN_FILO_UI.primaDelSito` su tasti,
  puntatore, `beforeinput` e `input` prima di ogni ascolto del sito, anche in
  cattura sulla finestra (#1340, giro 2: l'Aiuto sta nel documento, e il sito
  selezionava tutto nel suo ascolto del tasto). La selezione spostata mentre il
  sito riceve un tasto, un annuncio o un inserimento dell'utente torna: subito
  prima dell'annuncio, o alla fine del giro (al più tardi al gesto seguente,
  che il browser può far passare avanti ai tempi). Il clic è un gesto come il
  tasto: dal rilascio al clic (e al doppio clic) il browser può solo chiudere in
  un punto la selezione su cui si è cliccato, anche dopo aver mandato il clic; il
  resto torna. La composizione conta solo se è vera: un inizio finto del sito
  spegneva il ritorno della selezione (#1340, giro 3). Fuori da quei giri la
  selezione la sposta anche «Seleziona tutto» della barra dei menu (Cmd+A su
  Mac), che la pagina non vede: lì vale, e resta il limite qui sotto.
- **Una bozza resta al sito dove è nata, e lo decide il main**: la chiave porta
  l'origine (`sn_feedback_draft_text@<origine>`, `BOZZE_PER_SITO` in
  `impostazioniPerOrigine.js`), concessa solo al riquadro che ha davvero
  quell'origine (`frame.origin`), mai a un documento senza origine. Le pagine di
  Filo tengono la loro, che a un sito non arriva.

## Provarlo

Il velo, il velo tolto all'ultimo istante, il foglio che abbassa il menu e i
pezzi di Filo che non contano come velo: `tests/menu-coperto-dal-sito.spec.mjs`;
la logica dell'attesa in `tests/unit/vistoDavvero.test.mjs`. Il microfono e il
documento dell'Aiuto sotto il velo, il velo appena sopra l'Aiuto e la pagina in
grigio: `tests/aiuto-coperto-dal-sito.spec.mjs`. Le caselle scritte dal sito:
`tests/caselle-solo-utente.spec.mjs`. Prima di cliccare
una voce della cronologia gli spec aspettano che il browser l'abbia vista
scoperta (`cronologiaPronta` in `tests/helpers/cronologiaAppunti.mjs`).

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

Un sito controlla lo stile e i nodi del menu (e della barra dell'Aiuto) che stanno
nel suo documento. La regola 3 ferma ciò che il sito disegna **sopra** il menu; non
ferma ciò che fa **al** menu: il suo CSS sulle nostre classi (colori trasparenti, opacità, un
`::after` dentro un nostro nodo) o il suo script sui nostri nodi. La cura vera
è disegnare il menu fuori dal documento del sito: l'owner l'ha deciso come
lavoro a parte (D14); fino ad allora questa porta resta aperta e dichiarata, e la
sua prova in `tests/verifica/589.11/` è un rosso atteso.

Un filtro, un'opacità o una trasformazione sul contenitore del menu (`html {
filter: grayscale(1) }`, una pagina in lutto) per il browser nasconde anche le
sonde, e ogni clic si fermava. Valgono per menu e velo insieme, quindi non
nascondono il menu più del sito: la guardia li sospende finché il menu è aperto
e li rimette alla chiusura. Se il sito li rimette lui, i clic si fermano: è il
lato sicuro. Il filtro sospeso torna sulla pagina da un nostro fondo sotto il
menu (`backdrop-filter` con lo stesso valore): senza, una pagina scura per
inversione diventava bianca a ogni tasto destro (#589.11, giro 2). Ciò che il
sito tiene al piano del menu o più su (la bolla di una chat) sta sopra anche al
fondo: riceve il filtro sul suo, finché il menu è aperto (giro 3). Opacità e
trasformazione restano solo sospese: non hanno un equivalente sul fondo.

Un menu aperto in un **riquadro incorporato** ha sopra anche gli effetti della
pagina che lo contiene (una scheda semitrasparente, un'ombra fatta con
`filter`, la pagina in grigio), e da dentro il riquadro non si toccano: ogni
clic si fermava (#589.11, giro 3). Il riquadro chiede alla pagina sopra, con un
messaggio, di sospenderli sugli antenati del suo `iframe` finché il menu resta
aperto (la richiesta si rinnova ogni secondo, e senza la pagina li rimette da
sé); le sonde si guardano quando la pagina risponde che li ha tolti, o dopo un
quarto di secondo, così la prima voce non aspetta il mezzo secondo di una
scoperta. La richiesta porta una chiave a caso che il riquadro manda anche al
main, e il main la gira alla sola pagina madre: la pagina toglie gli effetti
solo per una chiave che le arriva da tutte e due le parti. Senza, qualunque
riquadro (una pubblicità nascosta dalla pagina con `opacity: 0`) si rendeva
visibile da solo (giro 4). Una risposta finta fa solo guardare prima: un velo
resta un velo. Lì il filtro della pagina non
torna su un fondo, che coprirebbe il riquadro: finché il menu è aperto la pagina
sopra lo perde, e con lui opacità e trasformazione. L'owner l'ha accettato fino al
menu disegnato fuori dalla pagina (D14, #1052–#1056), che lo chiude; la sua prova in
`tests/verifica/589.11/` è un rosso atteso.

Lo shadow chiuso non nasconde il **testo**: `window.find` trova anche quello
scritto in una casella dentro un riquadro chiuso, e `getSelection().modify()`
allarga la selezione trovata fino alla riga intera, che `toString()` restituisce
(#1071). Basta indovinare una lettera. Ancora più semplice: gli inserimenti
(`beforeinput`, `input`) e l'Esc escono dallo shadow verso la finestra del sito.
Scrivere nella casella il sito non può più (#1071.1), ma può spostarne la
selezione (un `selectAll` fra due tasti), e il tasto dopo dell'utente scrive
sopra quello che il sito ha selezionato. Dalla pagina non lo si distingue dal
Cmd+A che su Mac prende la barra dei menu (la pagina non vede il tasto) o da un
lettore di schermo. Dentro un tasto, un annuncio o un inserimento la selezione invece torna
(#1340); resta aperto il tasto che sposta il cursore senza scrivere (frecce,
Inizio, Fine): il sito che sposta la selezione nel suo ascolto del tasto la fa
partire da lì. Il testo di una voce si può rendere come
contenuto generato (regola 2), quello che l'utente scrive in una casella no: per
toglierlo davvero al sito il riquadro deve stare fuori dal suo documento, in una
vista sopra la scheda come gli avvisi
([Un avviso su una pagina non sta dentro la pagina](un-avviso-su-una-pagina-non-sta-dentro-la-pagina.md)).

## Il permesso del sito non è di Filo (#586)

Lo stesso vale per i permessi di Chromium: sono della pagina, non del mondo che chiede. Un «lasciapassare» di cinque
secondi sulla scheda per Detta e Incolla valeva anche per gli script del sito, e passava sopra il no che l'utente gli
aveva dato. Quindi Filo non prende in prestito il permesso del sito: il microfono di Detta lo apre la cornice e alla
pagina arrivano solo i campioni, nel mondo del preload (`services/microfonoDiFilo.js`); gli appunti di Incolla li
legge il main. Così funzionano proprio dove il sito ha avuto un no.

Lo schermo segue la stessa idea dall'altro lato: si sceglie nella cornice prima del sì, perché Chromium chiama il
gestore dello schermo dentro il sì a `getDisplayMedia` e lì si consegna la fonte scelta. La strada vecchia
(`chromeMediaSource: 'desktop'`) arriva con gli stessi dati ma senza gestore e prenderebbe schermo e audio senza
scelta: nella pagina la gira su `getDisplayMedia` e avvisa il main, che dopo la scelta dice no
(`preload/schermo-vecchio.js`); chi la aggira si ferma prima di riceverli. Il clic dentro il riquadro di un altro
sito non passa da `input-event`: lo riferisce il preload del frame, e vale per quel riquadro e i suoi antenati. A richiesta in corso, su Linux, `desktopCapturer` con schermi e finestre
insieme torna vuoto: si chiedono a parte. Sentinelle in `tests/unit/permessiPagine.test.mjs`.
