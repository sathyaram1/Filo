# Menu contestuale: se Filo sostituisce il menu nativo, deve coprire OGNI tipo di elemento

[← Tutti i pattern](../PATTERNS.md)

Sulle pagine esterne il menu di Filo **rimpiazza** quello di Chromium. Ogni tipo
di contenuto per cui il menu nativo avrebbe delle voci (testo, immagine, link,
campo di testo, **video, audio**) deve avere il suo ramo nella matrice
contestuale: un tipo scoperto non significa "menu più povero", significa che
l'utente **perde del tutto** quelle azioni, senza alternative (#400).

- **Regola operativa:** quando aggiungi il supporto per un nuovo tipo di
  elemento, parti dall'elenco di ciò che il menu nativo offriva e completalo con
  ciò che ha senso in Filo; ogni stato attivabile deve essere disattivabile
  dalla stessa voce (l'etichetta racconta lo stato: "Ripeti in continuo" ⇄ "Non
  ripetere"), e le azioni senza riscontro visivo immediato confermano con un toast.
- **Elemento coperto da overlay:** i player veri stendono i loro comandi sopra al
  `<video>`, quindi il tasto destro arriva all'overlay e il media **non è tra gli
  antenati** del target. Il ramo va cercato anche con
  `document.elementsFromPoint(x, y)`, ma **solo come ripiego** quando non c'è
  altro contesto (selezione, immagine, link, campo di testo): altrimenti un video
  di sfondo a tutta pagina ruberebbe il menu al contenuto che gli sta sopra.
- **Un elemento può appartenere a PIÙ famiglie insieme — i rami non sono
  mutuamente esclusivi (#401).** Una miniatura racchiusa in un `<a>` (anteprime
  di articoli, schede prodotto, risultati di ricerca per immagini) è **sia**
  immagine **sia** link: un browser normale mostra le due famiglie di voci
  insieme. Con rami a `return` anticipato, quello dell'immagine chiudeva prima di
  valutare il link e le azioni sul collegamento sparivano del tutto. Regola:
  quando due contesti coesistono sullo stesso target, **componi** entrambe le
  famiglie (separatore fra loro), a partire da quella dell'elemento cliccato più
  in profondità. Costruisci le voci-azione in helper senza la sezione "Spiega",
  così il chiamante decide: **una sola** sezione "Spiega" inline (quella
  dell'elemento primario), perché ogni box `inline` fa una chiamata al modello a
  ogni apertura del menu — due box = doppio costo per un menu che si apre spesso.
- **Le famiglie non sono annidate: sono IMPILATE (#444).** "Appartiene a più
  famiglie" non vuol dire "una sta dentro l'altra". Le schede delle home video e
  social sono strati sovrapposti: l'anteprima che parte al passaggio del mouse si
  stende SOPRA la copertina, e il link della scheda le passa sotto, o sopra
  quando è un velo trasparente che copre tutto. Cercare il collegamento solo fra
  gli **antenati** (`closest('a[href]')`) lo perde in tutti questi casi, e la
  scheda diventa irraggiungibile col tasto destro proprio mentre l'anteprima
  suona. Regola: **ogni** famiglia ha il suo ripiego "sotto il punto cliccato"
  (`findUnder` sulla pila di `deepElementsFromPoint`) — media, immagine **e
  collegamento**, anche da solo.
- **Guardare sotto il cursore vuole un freno, uno solo, per tutte le famiglie
  (#444).** Adottare quello che sta sotto senza controllare che sia la stessa
  cosa che l'utente sta GUARDANDO regala il menu a roba invisibile: la barra
  fissa di un sito di notizie sotto cui sono scivolati i titoli, il riquadro dei
  cookie, un manto che la pagina stende su tutta se stessa sotto al testo.
  Nell'ultimo caso il collegamento lo sceglie la pagina. «Copia URL» le mette in
  mano gli appunti, «Apri in nuova tab» e «Condividi link» decidono dove mandare
  l'utente, e a ogni clic destro parte l'analisi del link, che va a scaricare
  quell'indirizzo. Il freno è `sameSurface` e misura l'elemento **davvero
  cliccato** contro il candidato, con due condizioni: si sovrappongono per almeno
  metà del più piccolo, e nessuno dei due **inghiotte** l'altro. Il freno sta in
  un posto solo, `detectContext`: i tre `*Under` escono da lì già vagliati, così
  nessun ramo a valle può dimenticarsene. Era già successo: il controllo c'era
  per due casi su tre.
- **Inghiottire non è contenere: circondare da tutte le parti non basta a dire
  di no (#444).** La prima versione del freno scartava il candidato appena
  sforava l'elemento cliccato su tutti e quattro i lati. Ma è esattamente la
  forma della scheda con un bordo, o con l'imbottitura fra il bordo e la
  copertina — mezzo web — e su quelle schede le quattro voci del collegamento
  sparivano di nuovo, col filmatino in funzione e da fermo. La differenza fra un
  contenitore e una copertura è la **scala**, non il numero di lati: un
  contenitore abbraccia quello che tiene (la copertina rientrata di dodici pixel
  riempie l'85% della scheda; anche la scheda che si tiene dentro il titolo resta
  sopra alla metà), mentre una barra fissa, un riquadro dei cookie o un manto
  sono grandi come la finestra e nascondono una riga di poche parole — sotto al
  5% di sé. `swallows` = circonda **e** l'altro sta sotto a `CONTAINER_MIN_RATIO`
  (0.35, con margine largo da tutt'e due le parti). Quando allarghi un freno,
  cerca la grandezza che distingue davvero i due casi: alzare i pixel di
  tolleranza avrebbe solo spostato il confine di qualche scheda.
- **Ci sono due cose opposte con la stessa forma: lì la geometria non può
  decidere, e la domanda vera è se si VEDE (#444).** La riga di un elenco di
  risultati — miniatura piccola a sinistra, titolo e tre righe di descrizione a
  destra, il collegamento della riga steso sopra a tutto — ha lo stesso ingombro
  di una barra fissa sopra un titolo scivolato sotto: un rettangolo largo quanto
  la pagina che ne circonda uno piccolo. Nessuna soglia di area li separa, e
  infatti `CONTAINER_MIN_RATIO` cadeva esattamente in mezzo: su una riga larga
  760 i comandi del filmato sparivano con miniature alte 101 e 160, tornavano da
  220 in su — cioè quasi mai, perché le miniature vere dei risultati e dei feed
  stanno tutte sotto. Quello che distingue i due casi non è una misura: sopra la
  miniatura c'è un collegamento invisibile, sopra il titolo sepolto c'è una barra
  opaca. Quindi il freno ha una **seconda prova, che vale da sola**: se fra il
  punto cliccato e il candidato non c'è niente di **dipinto**, il candidato è
  esattamente quello che l'utente sta guardando (`coveredAt` scorre la pila di
  `deepElementsFromPoint` fino al candidato — chi sta prima sta sopra — e chiede
  a `paintsSomething` se qualcuno disegna: sfondo, immagine di sfondo, bordo,
  ombra, tag che si disegna da sé, o testo che si vede davvero). Le due prove
  stanno in OR dentro `sameSurface`: la geometria dice "stessa scala, stessa
  scheda", la visibilità dice "è lì sotto gli occhi". Nessuna delle due copre
  l'altra — un velo con la sfumatura del titolo dipinge eccome, e passa per
  geometria.
  - `paintsSomething` guarda l'elemento intero, non il pixel: il paragrafo
    cliccato di fianco all'ultima parola dipinge lo stesso, altrimenti il manto
    invisibile steso sulla pagina tornava nel menu.
  - Il testo dei lettori di schermo è ritagliato a un pixel: `hasVisibleText`
    misura l'ingombro del testo con un `Range` e sotto i 2 px lo considera
    assente, se no una riga di risultati con il titolo ripetuto dentro il
    collegamento-velo si comporterebbe da elemento opaco.
  - **Un rettangolo vale come misura solo se copre il punto cliccato**
    (`coversPoint`). Il collegamento steso sulla scheda lo fa mezzo web con uno
    pseudo-elemento (`.stretched-link::after { inset: 0 }`): l'hit-test
    restituisce l'`<a>` del titolo, il cui rettangolo sta nella colonna del
    testo, lontano dalla miniatura. Ogni conto sui rettangoli lì dice "non
    c'entrano niente" e la miniatura spariva dal menu; e nel senso opposto, quel
    titolo contava come cosa dipinta davanti alla miniatura, che invece copre
    solo dov'è. Quindi `sameSurface` salta la geometria quando uno dei due
    rettangoli non copre il punto, e `coveredAt` ignora chi non è lì. Il punto
    viaggia insieme alla pila (`view = { stack, x, y }`): sono un dato solo.
- **Se lo dice il DOM, la geometria non ha voce in capitolo (#444).** Il freno
  serve a indovinare quando la pagina non dice niente: strati sovrapposti che
  nessuna parentela lega. Quando invece la copertina adottata sta **dentro** un
  `<a>`, la pagina ha già dichiarato che copertina e collegamento sono la stessa
  scheda, e rifare il conto sui rettangoli può solo buttare via un'informazione
  certa — è quello che succedeva con la striscia del titolo stesa sopra una
  copertina racchiusa nel collegamento: la struttura diceva di sì, la geometria
  (bordo, imbottitura, titolo in mezzo) diceva di no, e vinceva il no. Quindi:
  `findLinkUnder` cerca prima l'`<a>` che **contiene** il media o l'immagine
  adottati, e solo se non ne trova guarda la pila sotto il cursore; `belongsTo`
  mette la parentela prima di `sameSurface`, e la cerca con
  `containsAcrossShadow` (`contains()` di un elemento in chiaro non vede dentro
  uno shadow root, e le schede a componenti sono proprio quelle che rompeva).
- **Il ripiego vale per la famiglia da SOLA, non solo in coppia (#444).** Finché
  il ripiego esisteva solo dentro i rami "media + link" e "immagine + link", lo
  stesso identico pixel dava due esiti opposti a seconda dello strato che vinceva
  in quell'istante: menu completo mentre l'anteprima suonava, menu **vuoto** un
  istante dopo che si era fermata. E non serve un video: un velo trasparente
  sopra una scheda-link — come è costruito quasi ogni elenco di schede — bastava
  a far sparire tutte e quattro le voci del collegamento. Quando aggiungi un
  ripiego a una famiglia, chiediti sempre come si comporta quando è l'unica cosa
  lì sotto.
- **`closest()` si ferma al confine di un componente web — e `elementsFromPoint`
  pure, dall'altra parte.** `realTarget` con `composedPath()[0]` ti dà l'elemento
  vero dentro lo shadow root, ma da lì la risalita non vede più gli antenati in
  chiaro: un `<video>` in un componente dentro l'`<a>` della scheda sembrava
  senza collegamento. Chi cerca un antenato a partire dal target usa
  `closestAcrossShadow` (risale, e quando la radice è uno shadow root riparte dal
  suo host), mai `closest` nudo. Specularmente, `document.elementsFromPoint()`
  di un componente restituisce **l'host**, mai quello che c'è dentro: con
  collegamento e anteprima impilati dentro lo stesso componente la ricerca si
  fermava al bordo e il link spariva. Chi guarda cosa
  c'è sotto il cursore usa `deepElementsFromPoint`, che per ogni elemento con uno
  shadow root ripete il colpo là dentro e mette le parti del componente PRIMA del
  loro host (è l'ordine in cui si vedono). Limite noto: uno shadow root `closed`
  resta opaco a entrambi.
- **Il riconoscimento del contesto sta in UN posto** (`detectContext`): il menu
  si apre da due strade (menu normale e menu di correzione) e con la ricerca
  copiata in tutt'e due lo stesso clic finiva col dare due menu diversi a seconda
  che sotto ci fosse o no una parola da correggere.
- **Una scheda, un argomento: il riquadro «Spiega» non cambia discorso a seconda
  del punto cliccato (#444).** Sulla stessa scheda — copertina dentro il
  collegamento, fascia del titolo stesa sopra il fondo — il riquadro descriveva
  l'immagine se il clic cadeva sulla copertina scoperta e analizzava il
  collegamento centoventi pixel più in basso, con le stesse identiche
  voci-azione: tre modi di cliccare la stessa cosa, due risposte diverse, e
  nessun modo per chi guarda di sapere quale gli toccherà. L'argomento è
  **l'elemento primario**, cioè quello le cui voci aprono il menu: se abbiamo
  adottato la copertina, il riquadro parla di lei, anche quando il clic è
  arrivato al collegamento. Sul filmato resta il collegamento — una spiegazione
  del filmato non esiste — ed è già così in tutti e tre i modi. L'argomento è
  scritto nell'item (`subject`) e finisce su `data-subject` del riquadro: è
  leggibile prima che la risposta sostituisca il testo d'attesa, e i test lo
  controllano di lì invece di fare la corsa con la rete.
- **Dove:** `buildContextualItems` (+ `buildImageActionItems`/`buildLinkActionItems`),
  `detectContext`, `findMedia`, `findUnder`, `findLinkUnder`, `sameSurface`
  (+ `swallows`, `coveredAt`, `paintsSomething`, `hasVisibleText`), `belongsTo`
  (+ `containsAcrossShadow`),
  `closestAcrossShadow` e `deepElementsFromPoint` in `src/content/content.js`, voci in
  `src/content/actions.js` (`subject` sugli item `inline`), reso da
  `src/content/menu.js`. Test: `tests/context-menu-media.spec.mjs`,
  `tests/context-menu-image-link.spec.mjs`,
  `tests/context-menu-media-link.spec.mjs`,
  `tests/context-menu-video-preview-link.spec.mjs`.
