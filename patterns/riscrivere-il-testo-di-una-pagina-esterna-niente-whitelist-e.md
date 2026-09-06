# Riscrivere il testo di una pagina esterna: niente whitelist di tag, e si spostano i NODI

Quando Filo sostituisce del testo su una pagina che non è sua (oggi: "Traduci la
pagina") valgono due regole imparate a caro prezzo con #407.

- **Cosa toccare non lo decide il tag.** Una lista di tag "di prosa"
  (`p/li/h1…/figcaption`) più lo scarto dei sottoalberi `nav/header/aside/form`
  sembra ragionevole e invece **lascia fuori metà pagina**: sui siti moderni il
  testo sta in `div`/`span` generici, il titolo è dentro `<header>`, i riquadri
  "Leggi anche" dentro `<aside>` e le voci di menu sono link. La regola giusta è
  l'opposta: **prendi ogni elemento che ha un text node come figlio DIRETTO** e
  scarta solo ciò che non è prosa (script/media/`pre`/`code`, campi di testo,
  `[translate="no"]`, `.notranslate`, `contenteditable`, elementi nascosti e la
  UI di Filo stessa, riconoscibile dal **marchio** che si mette da sé). Così ogni
  pezzo di testo appartiene a **una sola** unità (niente doppie sostituzioni) e
  anche il testo dentro i link diventa una unità sua invece di restare un
  segnaposto intoccato.
- **Rimonta spostando i nodi originali, non re-inserendo HTML.** I figli
  dell'unità diventano segnaposto `[[Lk]]` nel testo mandato al modello e
  tornano al loro posto come **nodi vivi**: re-parsare l'`outerHTML` creerebbe
  nodi nuovi e butterebbe via listener, stato dei componenti e i figli già
  tradotti. Il testo del modello entra come **text node** (mai `innerHTML`):
  niente escaping da ricordare, niente HTML del modello nella pagina. Corollari:
  i figli che il modello "dimentica" di richiamare vanno **riappesi in fondo**
  (mai perdere contenuto), e l'annullamento (`Mostra originale`) ripristina la
  **lista di nodi originali** tenuta in memoria, non una stringa HTML salvata in
  un attributo (che, con unità annidate, conterrebbe già la traduzione dei figli).
- **Metà del testo che si legge non sta nel testo: sta negli ATTRIBUTI.** Il
  grigio dentro un campo di ricerca (`placeholder`), il suggerimento che compare
  fermando il mouse (`title`), la descrizione di un'immagine (`alt`),
  l'etichetta di una voce di menu a tendina, `aria-label`. Lasciarli in lingua
  originale sotto un avviso "Pagina tradotta" è la stessa bugia dei blocchi
  saltati: si vede a occhio che il lavoro non è finito. La riga di confine è
  **si legge / si rimanda indietro**: si traduce ciò che l'utente LEGGE, mai ciò
  che il sito INVIA (`value` di un campo, voci di un `datalist`, `href`,
  `name`). La riga passa **in mezzo agli `<input>`**: la scritta su un bottone è
  il suo `value`, e quel valore entra nei dati del modulo solo se il bottone ha
  un `name` — quindi un bottone che azzera il modulo, o che apre qualcosa nella
  pagina, o un invio senza `name` si traduce, un invio con `name` no. Corollario
  pratico: la voce di un menu a tendina si traduce
  **scrivendo l'attributo `label`**, mai sostituendone il testo — il testo di una
  `<option>` senza `value` è proprio ciò che il modulo invia, e il browser mostra
  `label` quando c'è. Conseguenza sul filtro dei sottoalberi: "qui non c'è prosa"
  (`script`, `video`, un campo di testo) e "qui non si tocca niente"
  (`translate="no"`, nascosto, `contenteditable`, la UI di Filo) diventano **due
  motivi diversi** di saltare: nel primo il contenuto resta intoccato ma le
  etichette si traducono lo stesso.
- **Il testo della pagina non finisce col `<body>`.** Il nome della scheda in
  alto (`document.title`) resta sotto gli occhi per tutto il tempo, e su una
  pagina per il resto tutta tradotta era l'ultima riga in lingua originale.
  Entra nella stessa coda di lavoro come un'unità sola, si applica scrivendo
  `document.title` (Electron rilancia `page-title-updated` e la scheda si
  aggiorna da sé) e va **marcato** come tutto il resto: senza
  `data-sn-translated` sul `<title>`, la sentinella del testo nuovo scambia la
  nostra stessa scrittura per testo appena arrivato dal sito e l'avviso finale
  annuncia roba nuova che non c'è.
- **Il messaggio finale deve dire la verità**: "fatto" solo se tutte le unità sono
  state sostituite, "solo in parte" se qualcuna è rimasta indietro, e un avviso
  esplicito quando non c'è **niente** da tradurre — il silenzio fa ritentare
  l'utente all'infinito. L'avviso "sto lavorando" di un'operazione lunga si apre
  con `showToast(testo, { duration: 0 })` e si **chiude** con l'handle restituito
  quando arriva l'esito: i toast delle pagine non si impilano, si sovrapporrebbero
  nello stesso angolo diventando illeggibili.
- **Anche l'avviso onesto deve essere vero: "solo in parte" vuole una PROVA, non
  prudenza.** Un "è rimasto fuori qualcosa" che scatta a vuoto manda l'utente a
  cercare del testo in lingua originale che non esiste, e brucia la credibilità
  dell'avviso per le volte in cui è vero: sbagliare "dalla parte della prudenza"
  non è gratis. Concretamente, per dire che il contenuto di un componente del
  sito è illeggibile non basta che l'elemento sia vuoto e abbia il trattino nel
  nome (un separatore o uno spaziatore disegnato in CSS è fatto così): servono
  segnali positivi — che il sito l'abbia davvero **registrato** (`:defined`,
  interrogabile sul DOM anche da un altro mondo JS, al contrario del registro dei
  componenti) e che lì dentro qualcosa sia **disegnato e irraggiungibile** (sopra
  un elemento vuoto il punto d'inserimento del cursore cade sull'elemento stesso,
  sopra un componente chiuso viene rimbalzato fuori).
- **"Non lo so" non è "sì": dove la prova non si può fare, si tace.** Una prova
  che si appoggia al cursore vale solo dentro lo schermo e solo su ciò che i clic
  non attraversano — cioè quasi mai: qualsiasi pagina più lunga di una schermata
  ha roba sotto il bordo, e le decorazioni sono quasi tutte `pointer-events:none`.
  Contare quel "non lo so" come prova rovescia la bugia invece di toglierla: la
  pagina è tutta tradotta e l'avviso manda comunque a cercare dell'inglese che non
  c'è. Il prezzo giusto è l'altro: un avviso in meno quando il pezzo illeggibile
  sta fuori portata. **Un avviso mancato costa uno; un avviso falso li svaluta
  tutti.** Vale per qualunque diagnosi appoggiata alla geometria della finestra
  (`elementFromPoint`, `caretPositionFromPoint`, il rettangolo visibile): il
  risultato "indeterminato" va tenuto separato dal risultato negativo, e trattato
  come tale fino in fondo. Corollario: se tacere costa, **conviene insistere solo
  dove la risposta manca**. La sonda riprova su altre righe dell'elemento quando
  la prima non ha risposto (una barra fissa che lo taglia a metà), e si ferma
  appena una risposta arriva: righe in più non devono poter ribaltare un esito
  già certo, o la sonda diventa una votazione.
- **"È roba mia" si MARCA alla nascita, non si indovina dal nome.** Chi cammina
  su una pagina che non è sua deve saltare la UI che Filo ci ha disegnato dentro
  (menu, avvisi, popup, riquadri di conferma): è già nella lingua dell'utente, e
  tradurla vuol dire pagare il modello per riscrivere il proprio menu.
  Riconoscerla dal nome — una classe che comincia per `sn-`, un id che comincia
  per `filo-` — **sbaglia su siti veri**: i portali costruiti con ServiceNow
  chiamano `sn-qualcosa` ogni loro pezzo, e "filo" è una parola italiana normale
  in un nome. Il prezzo dell'errore non è simmetrico: un riquadro del sito
  scambiato per nostro resta intero in lingua originale **sotto un avviso che
  dichiara la pagina tradotta**, e nessun conteggio se ne accorge (il pezzo
  saltato non è "rimasto fuori": è come se non esistesse). La regola è
  `SN_FILO_UI.mark(el)` sulla **radice** di ogni pezzo di UI che attacchiamo al
  documento, nella stessa funzione che la crea, e `SN_FILO_UI.is/inside` come
  unica risposta alla domanda "chi l'ha disegnato". Un attributo (`data-sn-ui`),
  non una classe: le classi le riscrive anche il sito. Vale per chiunque
  cammini sulla pagina, non solo per la traduzione — la sentinella del testo
  nuovo usa lo stesso marchio, o scambia i nostri avvisi per roba appena
  arrivata dal sito.
- **L'etichetta gemella si copia, non si ricompra.** Un link col suggerimento
  del mouse uguale al proprio testo, un bottone a sola icona con l'etichetta di
  accessibilità ripetuta: sono dappertutto (sulla home di un giornale sono
  decine di frasi). Mandare al modello due volte la stessa frase costa il doppio
  e sullo schermo non cambia niente. Quando il valore dell'attributo è identico
  al testo che l'elemento MOSTRA, l'unità non si spedisce: si applica dopo,
  copiando il `textContent` appena tradotto (che può venire da un figlio —
  `<a title="…"><span>…`). Due dettagli che tengono onesto il conto: se il
  testo non è cambiato (richiesta fallita) l'etichetta **non** si marca come
  fatta, così la ripresa ci riprova; e la copia non entra fra le unità del giro,
  perché non è lavoro rimasto fuori.
- **Dove:** `extractTranslatableBlocks` in `src/content/extractContext.js`
  (`extractMainTextNodes`, accanto, resta la versione "solo l'articolo" per
  l'excerpt del categorizer: sono due domande diverse); applicazione e ripristino
  in `src/content/translatePage.js`; il marchio della UI di Filo in
  `src/shared/filoUi.js`. Test `tests/translate-page.spec.mjs`.
