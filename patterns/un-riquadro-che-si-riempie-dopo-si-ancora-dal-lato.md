# Un riquadro che si riempie dopo si ancora dal lato che non si muove

Un riquadro ancorato a un punto della pagina — la spiegazione su una selezione,
un menu con una sezione che arriva da un modello, un'anteprima che carica
un'immagine — **nasce vuoto e si riempie dopo**. La posa calcolata subito dopo
l'apertura è calcolata sull'altezza sbagliata: quando il contenuto arriva il
riquadro si allunga e il **fondo esce dallo schermo**. Il fondo è quasi sempre
la parte che serve (la riga per scrivere la domanda dopo, i bottoni di
conferma), quindi il difetto non è estetico: la funzione diventa
irraggiungibile e l'unico rimedio resta chiudere e riprovare più in alto
(#500, #502).

La tentazione è inseguire: rimisurare a ogni pezzo di risposta e rispostare il
riquadro. Non funziona bene. La posa finisce per dipendere da **quando** si
guarda, cioè da quanto ci mette il modello: stessa selezione, riquadro sopra o
sotto a seconda della volta, e un salto a metà risposta quando cresce oltre lo
spazio che aveva. Chi insegue tratta l'altezza come un dato e la posizione come
una conseguenza; va fatto il contrario.

- **Prima di tutto, riporta il punto ancorato DENTRO la finestra.** Le
  scorciatoie ancorano al fondo del rettangolo della selezione, e una selezione
  che prosegue sotto la piega ha il fondo fuori dallo schermo. Con un punto
  fuori, «sopra il punto» è fuori a sua volta e il riquadro nasce già sbordato,
  senza nemmeno aspettare la risposta: misurato a 620px oltre il bordo.
- **E ritaglialo a OGNI misura, non solo all'apertura.** La finestra si accorcia
  anche dopo: zoom della pagina (in Filo si usa di continuo) e ridimensionamento
  la portano sotto un punto che era dentro. Se il ritaglio è una costante
  calcolata alla nascita, il riquadro viene riposato rispetto a un posto che non
  esiste più e torna fuori dal bordo — stesso sintomo, altra porta: misurato a
  59px sotto il fondo al 150% di zoom, con la riga per scrivere di nuovo
  irraggiungibile. Tieni il punto GREZZO e ritaglialo sulla finestra di adesso:
  il punto ancorato è una funzione, non un numero.
- **Il LATO si sceglie una volta e non cambia più**, e si sceglie sull'altezza
  che il riquadro **potrà** raggiungere (il suo tetto, letto dal foglio di
  stile — non ricopiato in JS), non su quella che ha adesso. Se ci sta sotto il
  punto ancorato va sotto; se no e ci sta sopra va sopra; se non basta nessuno
  dei due, il lato più capiente.
- **Il tetto d'altezza si stringe allo spazio di quel lato.** Da lì in poi il
  riquadro non *può* diventare più alto di quanto ci sta: il corpo si accorcia
  e scorre, e il fondo resta raggiungibile.
- **Ma un tetto stringe solo finché sta sopra i minimi interni: sotto quella
  soglia qualcuno deve cedere DAVVERO.** Intestazione, corpo, riga di stato e
  riga per scrivere hanno ciascuno un'altezza minima; quando la loro somma
  supera il tetto, il riquadro smette di accorciarsi e i pezzi ESCONO dal suo
  bordo. Decidi in anticipo chi cede e in che ordine — nel popup: prima il
  minimo del corpo (che scorre), poi la riga del costo (che riappare come
  hover sull'intestazione), mai intestazione e riga per scrivere — e mettilo
  in due classi che la posa accende in funzione del **tetto**, non dell'altezza
  misurata: una decisione presa sul proprio esito oscilla. Le misure che
  servono a decidere (il minimo del corpo, l'altezza della riga che si può
  nascondere) vanno lette **una volta, da non compresso**: da compresso
  varrebbero zero e non tornerebbero più.
- **Il pezzo che "sparisce" continua a occupare la sua imbottitura, e il conto
  se ne dimentica.** `min-height: 0` porta a zero il CONTENUTO, non l'ingombro:
  bordi e imbottitura restano. Nel popup sono venti pixel, e il pavimento del
  tetto li ignorava. Il risultato è un conto che promette un riquadro più basso
  di quello che il browser sa disegnare: il tetto resta largo di quei pixel, i
  pezzi escono dal bordo e la riga per scrivere sporge oltre l'angolo
  arrotondato — visibile anche quando il riquadro nel suo insieme sta dentro lo
  schermo, e tagliata a metà dentro un riquadro incorporato basso (#502). Due
  conseguenze. Ogni gradino di compressione ha il **suo** minimo vero, e la
  soglia per passare al gradino dopo è il minimo del gradino di ADESSO, non una
  somma qualsiasi. E nell'ultimo gradino ceda anche l'imbottitura, così il
  pavimento è davvero il solo incomprimibile. Quei minimi **leggili dal foglio
  di stile accendendo per un attimo le classi**, invece di ricopiare i numeri in
  JS: è il foglio di stile a decidere quanto cede ogni pezzo, e un numero
  ricopiato ricomincia a mentire al primo ritocco — che è la forma esatta di
  questo difetto. Nessun fotogramma viene disegnato in mezzo.
- **Quando nel lato scelto non ci sta nemmeno il MINIMO, il punto ancorato non
  è onorabile: dillo subito.** Il riquadro verrà staccato comunque (meglio
  coprire la parola che restare dove non si clicca), e stringere il tetto allo
  spazio di quel lato butta via posto che c'è. Vale la pena di un terzo lato —
  «dentro»: si appoggia al bordo della finestra e il tetto è la finestra
  intera, come da trascinato. Senza, nei riquadri incorporati più bassi il
  corpo finiva a zero e la spiegazione appena chiesta non si leggeva per
  niente. La coordinata resta costante anche lì, quindi la regola d'oro non si
  rompe.
- **La soglia per staccarsi non è «ci sta il minimo», è «il contenuto si
  legge».** Sono due numeri diversi e la differenza è tutta la fascia in mezzo:
  con la soglia al minimo assoluto ci si stacca solo quando del contenuto non
  si vedrebbe comunque niente, e appena sopra quella soglia il riquadro si
  aggrappa al punto ancorato pagando tutto lo spazio che quel lato non ha —
  metà del riquadro incorporato resta vuota e della risposta appena chiesta
  restano pochi pixel da scorrere con la rotella. Si vede da fuori come «più
  spazio, meno contenuto»: un box alto 240px ne mostrava 8, uno alto 220 — che
  si staccava già — ne mostrava 82, e la fascia storta arrivava fino a 420px,
  cioè la misura tipica di un box commenti (#502). Metti la soglia dove il
  contenuto smette di leggersi: il minimo COMODO, quello in cui nessun pezzo
  interno ha ancora ceduto il minimo che gli dà il foglio di stile. Staccarsi
  però costa (il riquadro copre la parola), quindi fallo solo quando frutta
  davvero: se il posto guadagnato è qualche pixel — una finestra appena troppo
  bassa — resta ancorato.
- **Un riquadro si stacca da una PAROLA, non da un punto, e una parola ha
  un'altezza.** Sopra la parola ci si appoggia sopra la sua CIMA, sotto sotto il
  suo FONDO. L'ancora che arriva dalla scorciatoia è il fondo del rettangolo:
  usarla anche per il lato di sopra vuol dire appoggiarsi otto pixel sopra il
  fondo delle lettere, cioè dentro le lettere. Su una riga alta 19px ne restano
  coperti gli ultimi 11, e la parola sparisce proprio mentre l'utente legge cosa
  vuol dire. Passa il rettangolo, non il punto, e prendilo dalla SELEZIONE su
  tutte le strade: così la scorciatoia e il menu del tasto destro si comportano
  uguale invece di dipendere da dove stava il puntatore.
- **La "finestra" non è sempre quella dell'app: dentro un iframe è l'iframe.**
  Filo gira anche nei riquadri incorporati (#405), e lì `position: fixed` e
  `window.innerHeight` parlano del riquadro. Un box alto 180px è quindi uno
  scenario reale, non un caso di laboratorio — e ciò che esce dal suo bordo il
  browser lo **taglia**: non si raggiunge né scorrendo né trascinando il
  riquadro altrove, che in pagina invece salverebbe la situazione. Le prove di
  una posa vanno fatte anche dentro un iframe basso, non solo su una finestra
  bassa.
- **Lo stesso vale di LARGHEZZA, e lì nessuno deve cedere.** I riquadri
  incorporati sono stretti quasi quanto sono bassi (un box commenti sta spesso
  sotto i 320px), e un riquadro con una larghezza sua ci sborda a destra. Quello
  che il browser taglia via è il tasto di invio: stesso danno, altra direzione.
  Qui basta stringere la larghezza allo spazio che c'è. Due dettagli la fanno
  funzionare. La larghezza naturale si legge da una **variabile** del foglio di
  stile, non da `width`, che nello spazio stretto è già stata clampata: chi
  rilegge `width` si tiene la misura di quando c'era meno posto anche dopo che
  il posto è tornato. E i pezzi che non devono sparire vanno marcati
  `flex: 0 0 auto`: un `<textarea>` con `flex: 1` ha una larghezza naturale
  tutta sua e senza `min-width: 0` spinge fuori il bottone accanto invece di
  accorciarsi.
- **A un pezzo che nasce vuoto e si riempie di una riga sola, dagli il suo
  minimo nel foglio di stile** (`min-height: 1.2em` sulla riga del costo): la
  posa lo misura già dell'altezza che avrà, invece di ritrovarselo cresciuto
  sotto i piedi a metà risposta.
- **Il bordo ancorato lo tiene il foglio di stile, non JavaScript.** Sotto il
  punto si fissa `top` e il riquadro cresce verso il basso; sopra il punto si
  fissa `bottom` — non `top` ricalcolato dall'altezza — e cresce verso l'alto da
  solo. Le coordinate scritte diventano così **costanti per tutta la vita del
  riquadro**: riscriverle mille volte non lo sposta di un pixel, e l'unica
  coordinata che cambia col contenuto la calcola il browser. È qui che muore il
  tremolio, non nel rimisurare meglio.
- **Il bilancio va rifatto anche quando a crescere è chi NON cede.** Tetto e
  gradino di compressione si sceglievano alla posa e a ogni cambio di finestra:
  le due cause di cambiamento che arrivano da FUORI. Ma dentro il riquadro c'è
  un pezzo che cresce da solo e non cede mai — la riga per scrivere, che si
  allunga con la domanda (la casella arriva a 120px). Cresciuta lei il conto è
  vecchio: il corpo resta al minimo comodo che aveva, non cede un pixel, e a
  uscire dal bordo del riquadro è proprio la riga in basso, col tasto di invio
  che sotto il cursore non c'è più — 50px oltre il bordo e 42 fuori dallo
  schermo su una finestra di 480, con la seconda faccia (la riga appoggiata sul
  vuoto sotto l'angolo arrotondato) visibile anche a riquadro comodo dentro lo
  schermo (#502). Rifai il bilancio quando cambia l'altezza INCOMPRIMIBILE, e
  **solo** allora: rifarlo a ogni misura lo metterebbe a rincorrere lo
  stringimento in più che il guardiano applica di suo.
- **E anche il pezzo che non cede ha un tetto, che va stretto allo spazio.**
  Altrimenti nella finestra bassa — o nel riquadro incorporato — è lui a
  spingere fuori il tasto di invio dopo che tutto il resto ha già ceduto. Il suo
  tetto è quanto resta quando ha ceduto ANCHE il corpo, ridotto all'osso: da lì
  in giù la casella smette di allungarsi e scorre al suo interno, e il cursore
  resta in vista perché il browser segue chi scrive. Si rifà in tutte e due le
  direzioni, come ogni altro tetto.
- **Una casella che si auto-allunga: il tetto non si ricopia, e
  `scrollHeight` non è `height`.** Il tetto lo tiene il foglio di stile (la posa
  lo stringe da lì), quindi `Math.min(scrollHeight, 120)` in JS terrebbe il
  tetto pieno anche dove non ci sta. E `scrollHeight` comprende l'imbottitura
  mentre `height` (box content-box) no: scriverlo tal quale lascia la casella
  più alta del suo testo di quei pixel e non li restituisce più — cancellata la
  domanda resta gonfia e la risposta non si riprende lo spazio.
- **Il `ResizeObserver` resta, ma come rete, non come motore.** Serve per i casi
  che la matematica non copre — le altezze minime dei pezzi interni non stanno
  nel tetto, finestra bassissima — e in quei casi **stringe ancora il tetto,
  non sposta il riquadro**: una sola direzione, quindi non può oscillare. Non
  toccare la dimensione fuori da questo schema o l'osservatore si rincorre.
- **Il `ResizeObserver` consegna al passo di rendering**, che in una scheda in
  secondo piano è strozzato: esponi anche una richiamata sincrona e chiamala
  da chi allunga il contenuto.
- **Misura l'ingombro VISIBILE** (`getBoundingClientRect`), non quello di
  layout (`offsetHeight`), e tieni conto della `scale()` della compensazione
  zoom: il tetto è in px di layout, lo spazio sullo schermo in px visibili. Con
  l'ancoraggio dal fondo la `transform-origin` va spostata a `bottom left`, o al
  primo cambio di zoom il riquadro si stacca dal punto.
- **Se l'utente lo ha trascinato, la POSIZIONE è sua — l'INGOMBRO no.** Smetti
  di riportarlo sul punto ancorato: resta dove l'ha messo e ti limiti a non
  farlo uscire dallo schermo, senza nemmeno il margine dai bordi (l'ha
  appoggiato lì apposta). Passando al trascinamento azzera `bottom`: con `top` e
  `bottom` insieme e altezza automatica il riquadro si stira fra i due bordi.
  Ma la dimensione non l'ha scelta lui, e va rifatta **su tutti e due gli assi e
  in tutte e due le direzioni** a ogni cambio di spazio, esattamente come se
  fosse ancorato — solo che lo spazio, da spostato, è la finestra intera invece
  del lato scelto (e cambia già nell'istante in cui lo prende in mano: rifai il
  tetto anche lì, o si tiene l'altezza del lato a cui era appeso). Saltarne una
  sola metà si vede: il riquadro spostato si stringeva di larghezza e non di
  altezza, così bastava abbassare la finestra perché smettesse di accorciarsi,
  si appoggiasse in cima e il fondo — la riga per scrivere — restasse fuori. E
  con un tetto che sa solo stringere c'è la faccia opposta: spostato mentre lo
  spazio era poco, restava schiacciato per sempre, con la risposta in una
  striscia da scorrere e lo spazio tutto lì (#502). **Cerca l'asimmetria dentro
  il rimedio**: un rimedio che vale su un asse e non sull'altro, o in un verso e
  non nell'altro, è quasi sempre incompleto piuttosto che sbagliato.
- **Un riquadro che si apre da tastiera lascia il fuoco dove si continua a
  scrivere.** Chi chiede la spiegazione con Alt+E vuole fare la domanda dopo con
  la tastiera: se il cursore non è già nella riga per scrivere deve tornare al
  mouse (o scoprire Tab). Vale per tutte le strade che aprono lo stesso riquadro
  — scorciatoia e menu del tasto destro fanno la stessa cosa. `focus()` va
  chiamato con `{ preventScroll: true }`: dentro un riquadro incorporato,
  altrimenti, la pagina che lo contiene scorre e il riquadro appena aperto
  scappa di vista. **E il fuoco dentro il riquadro spegne la selezione della
  pagina**, perché un documento ne ha una sola: la parola su cui l'utente ha
  chiesto la spiegazione sparisce, e alla chiusura deve rifarla a mano per
  tradurla o copiarla. Tieni da parte il `Range` all'apertura e rimettilo alla
  chiusura, ma solo se nel frattempo l'utente non ne ha fatta una sua.
- **Anche il limite del TRASCINAMENTO misura l'ingombro visibile.** Il guardiano
  lo faceva già; il pezzo di codice che ferma il mouse al bordo no, leggeva
  `offsetWidth`/`offsetHeight`. Le due misure coincidono solo al 100% di zoom,
  perché la compensazione mette una `scale()` sul riquadro. Con la pagina
  rimpicciolita (Ctrl+meno: due gesti, e in Filo si fa di continuo) la scala è
  maggiore di 1, il riquadro occupa PIÙ di quanto dice `offsetHeight`, e il
  limite lascia passare la differenza: al 50% la riga per scrivere finiva 464px
  sotto il bordo dello schermo, e lì restava. Nessuno la riportava dentro,
  perché finché la dimensione non cambia il guardiano non gira. Con la pagina
  ingrandita la stessa formula si ferma prima del bordo e butta via una fascia
  di schermo che c'è. Un errore solo, due direzioni, e la seconda si vede solo
  se la cerchi. Due contorni dello stesso pezzo di codice. **I due limiti vanno
  applicati nello stesso ordine del guardiano**, cioè con la cima che vince sul
  fondo: quando il riquadro è più alto della finestra i due non possono valere
  insieme, e con l'ordine invertito a uscire è l'intestazione, che è l'unica
  presa per rimetterlo a posto. E **quando l'utente lo lascia, l'ultima parola è
  del guardiano**: il limite del mouse sa solo spostare, lui sa anche stringere
  il tetto.
- **Cambiare il bordo ancorato vuol dire cambiare anche la `transform-origin`.**
  Un riquadro posato sopra la parola è agganciato col fondo, quindi la
  compensazione zoom scala da `bottom left`. Quando l'utente lo prende in mano
  il bordo ancorato diventa la cima (`bottom: auto`, comanda `top`): se il punto
  da cui scala resta quello di prima, il browser lo disegna a un'altezza intera
  di distanza da dove dice `style.top`, e ogni conto fatto sulle sue coordinate
  parla di un posto dove il riquadro non è. Al 50% di zoom saltava di 484px al
  primo pixel di trascinamento. Riscrivi l'origine nello stesso istante in cui
  cambi il bordo ancorato, senza aspettare il prossimo evento di zoom.
- **Il corpo che scorre non insegue il fondo:** vale la regola delle chat in
  streaming (§ "Liste/chat che si ricostruiscono in streaming"). Da quando il
  tetto stringe il corpo allo spazio che c'è, leggere scorrendo mentre la
  risposta arriva è l'uso normale del riquadro, e portare la vista in fondo a
  ogni pezzo che arriva vuol dire che chi torna su a rileggere viene sbalzato
  giù di nuovo, a ogni pezzo, finché il modello non ha finito. Due dettagli
  perché funzioni qui. La posizione va RIMESSA e non solo lasciata stare: la
  riscrittura finale del markdown può essere più corta del parziale, e il
  browser clampa `scrollTop` da solo. E va rimessa DOPO la posa, perché
  `reflow()` accorcia il corpo e con esso lo scorrimento massimo.
- **Il guardiano guarda TUTTI E DUE i bordi, non solo quello previsto.** Finché
  la finestra non cambia sborda solo il lato libero, e lì si stringe il tetto.
  Ma quando lo spazio si accorcia dopo la posa, a uscire è il lato ANCORATO — un
  riquadro agganciato in alto che finisce sotto il fondo — e un controllo puntato
  sul solo lato atteso non lo vede. Sul lato ancorato stringere non serve a
  niente (quel bordo sta fermo): va riportato dentro di peso. E dopo aver stretto
  **rimisura e ricontrolla** invece di uscire: un solo giro deve bastare.
- **Ricalcola su `resize` della finestra e del visual viewport**: lo spazio
  disponibile è cambiato, il tetto va rifatto da capo — **anche verso l'alto**,
  o il riquadro resta stretto per sempre solo perché per un momento c'era meno
  posto. Lo zoom cambia anche la risoluzione: aggiungi la stessa rete
  `matchMedia('(resolution: Xdppx)')` della compensazione zoom, e registrala
  DOPO, così quando rimisuri la `scale()` è già quella nuova.
- **Attento a misurare dopo l'animazione d'ingresso.** `.sn-popup` entra con una
  dissolvenza che porta 2px di scivolata: un test che legge la posizione mentre
  scorre legge un fotogramma, non una posa, e accusa di tremolio del codice che
  sta fermo. Aspetta `element.getAnimations()` prima di prendere le misure.
- **Per provarlo: `page.setViewportSize`, non `win.setBounds`.** Nei test la
  finestra sta fuori schermo (`src/main/test-window-mode.js`) e la nuova altezza
  arriva alla vista ma NON al renderer: `window.innerHeight` resta quello di
  prima, e un test che rimpicciolisce la finestra così non prova niente pur
  passando. `setViewportSize` consegna alla pagina quello che vede davvero
  quando l'utente ridimensiona: viewport più bassa ed evento `resize`. Lo zoom
  invece passa: `webContents.setZoomFactor` dal main.
- **Il `resize` arriva a JS DOPO che `innerHeight` è cambiato**: per un
  fotogramma il riquadro è ancora posato sulla finestra di prima. Nei test
  aspetta la posa che si ferma (`expect.poll`), non la prima misura utile —
  senza il rimedio ci resta e basta, quindi il test è rosso lo stesso.
- **Nei test il mouse va simulato dopo che la posa si è fermata.** Un
  trascinamento che parte mentre il riquadro sta ancora tornando al suo posto
  dopo un cambio di zoom misura la posizione di prima, e il test accusa un salto
  che nel prodotto non c'è. Aspetta due letture uguali di fila
  (`attendiPosaFerma`) prima di premere il pulsante.
- **Dove:** `attachPose()` e `attachDrag()` in `src/content/popup.js` (riquadro
  `.sn-popup`), test `tests/popup-pose-streaming.spec.mjs`,
  `tests/popup-pose-casi-limite.spec.mjs` e `tests/popup-scroll-streaming.spec.mjs`.
