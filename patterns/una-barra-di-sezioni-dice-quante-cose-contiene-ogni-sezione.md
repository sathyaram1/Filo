# Una barra di sezioni dice quante cose contiene ogni sezione

[← Tutti i pattern](../PATTERNS.md)

Una fila di schede che dividono una stessa lista (Ricevuti / In coda / Risolti /
Archiviati) senza numeri costringe ad aprirle una per una solo per sapere dove
c'è del lavoro. Il numero accanto al nome toglie quel giro (#495).

- **Solo dove significa qualcosa.** Le schede che non elencano niente
  (statistiche, impostazioni, log) non prendono un numero: sarebbe un dato
  inventato accanto a un nome.
- **Il numero è la LUNGHEZZA della lista che quella scheda mostrerebbe**, e si
  calcola con la stessa funzione che la costruisce. Se la scheda ha dei filtri
  (⭐, "solo confermati"), il conteggio li segue: un contatore che non concorda
  con quello che si vede aprendo sembra mentire, e l'errore si scopre tardi.
- **Segue i dati, non i ricaricamenti.** Ogni cosa che sposta un elemento da
  una sezione all'altra aggiorna entrambi i numeri sul posto — anche quando la
  lista visibile è un'altra (es. il filtro ⭐ acceso mentre guardi un'altra
  scheda).
- **Nessun numero finché il dato non c'è.** In caricamento, o dopo un
  caricamento fallito, la scheda resta col solo nome: uno "(0)" là dove non si
  sa è peggio del silenzio. `(0)` si scrive solo quando la sezione è davvero
  vuota — ed è lì che serve, perché dice "vuota" invece di lasciarlo intuire.
- **Il guasto va RICORDATO in una variabile, non scritto una volta sola.** Il
  disegno dello stato d'errore muore al primo re-render, e il primo re-render è
  a un click di distanza: l'utente che non vede numeri clicca una sezione, e
  quel giro ricalcolava tutto da una lista vuota — nove "(0)" e, al posto
  dell'errore, "Nessun feedback in arrivo." con l'unico tasto "Riprova"
  portato via. Un flag "dati arrivati" + un flag "caricamento fallito" tengono
  la pagina onesta a ogni ridisegno.
- **Vale anche per le PAROLE, non solo per le cifre.** "Nessun feedback in
  coda." dopo un caricamento fallito è la stessa bugia di uno "(0)": afferma
  che lì non c'è niente mentre la verità è che non lo sappiamo. Il riquadro
  vuoto, in quello stato, dice il guasto e lascia la via d'uscita.
- **E vale per la BARRA INTERA: se il criterio non si legge, le sezioni non si
  disegnano.** Lo status dei feedback viaggia cifrato: chi non ha la chiave
  dell'owner non può sapere in che sezione va niente, e la pagina disegnava lo
  stesso quattro schede — "In coda (0) · Risolti (0) · Archiviati (0)" — con
  tutto ammucchiato nei Ricevuti, risolti compresi. Tre numeri che dichiarano
  il vuoto dove non si sa, cioè la stessa bugia in formato più grande. Senza il
  criterio: niente barra, un elenco solo, una riga che lo dice, e sulla scheda
  solo ciò che si sa davvero (qui l'enum grossolano in chiaro, aperta/chiusa).
  Il riconoscimento dev'essere STRETTO in due sensi. Solo il ciphertext conta
  (uno stato assente o inventato la macchina lo scioglie davvero); e il silenzio
  scatta solo quando NON si legge nessuno stato, che è il caso vero — o hai la
  chiave e li leggi tutti, o non ce l'hai e non ne leggi uno. Togliere le
  sezioni a tutti per un documento storto sarebbe sproporzionato, e farebbe
  divergere la pagina dalla sua gemella: la divergenza che il pattern qui sopra
  esiste per togliere.
- **La regola sta nel modulo, non nella pagina — o la gemella resta indietro.**
  Scritta dentro `feedback.js`, questa regola è valsa per una pagina sola: la
  dashboard di gestione ha continuato a scrivere "Ricevuti (3) · In coda (0) ·
  Risolti (0) · Archiviati (0)" e "In attesa del giudizio" su segnalazioni già
  chiuse, e la riga di changelog prometteva all'utente una cosa che su
  «Gestione» non era vera (#509, secondo giro). Adesso il predicato
  (`statusUnreadable`), la soglia (`sectionsReliable`) e le parole
  (`publicStateLabel`) sono in `manageReview.js` e le due pagine le chiamano.
- **Non è "nascondi la barra": è tutto ciò che parte dallo stato.** Chiusa la
  barra, restano aperte le altre porte, e ognuna costa un giro di verifica: il
  nome della sezione in cima alla colonna, il bordo colorato della scheda
  ("Non filtrato" è un'affermazione), le barre di massa che contano per stato
  ("Ri-valuta i non filtrati (3)", "Approva tutti gli allineati"), i pulsanti di
  decisione del dettaglio, "Archivia" che senza chiave dice sempre "Archivia"
  anche su una già archiviata, la frase accanto ai giudici. Il criterio è uno:
  *se l'affermazione nasce dallo stato e lo stato non si legge, non si scrive*.
  Restano invece le cose che stanno in chiaro e con lo stato non c'entrano —
  ⭐ preferito, la frase per chi ha segnalato, le fusioni ferme.
- **Sezione non è sinonimo di scheda.** La barra della dashboard di gestione
  porta anche Statistiche Red Team, Modelli di supporto, Automazioni e Log:
  non elencano segnalazioni e non dipendono dal loro stato, quindi restano
  raggiungibili. Spariscono le quattro sezioni, non la barra come oggetto.
- **Ogni lista, nessuna esclusa.** Se una superficie prende i numeri, li prende
  anche la lista dei RISULTATI DI RICERCA: "quanti ne ha trovati" è la domanda
  a cui la ricerca risponde, ed è la prima intestazione che ci si dimentica.
  Il numero è quello delle righe DISEGNATE, non quello che ha risposto il
  modello: un risultato che punta a un elemento non più caricato non si vede e
  non si conta.
- **Un numero non può affermare più di quanto la pagina sa.** Se la pagina
  carica al massimo N elementi (qui 500, i più recenti), oltre quella soglia
  ogni conteggio è un MINIMO: si scrive `(312+)`, non `(312)`, e un hover dice
  quanti se ne sono caricati. Vale anche per lo zero — `(0+)` — e il testo di
  "sezione vuota" lo ripete, perché al tetto una sezione vuota può non esserlo.
  Caricare davvero tutto costa letture: è una scelta dell'owner, non una
  scorciatoia per far tornare i numeri.
- **Superfici gemelle si allineano.** La pagina dei feedback e la dashboard di
  gestione sono la stessa barra vista da due ruoli: la seconda era rimasta
  senza numeri per anni proprio perché nessuno le guardava affiancate. E
  allineare i numeri non basta se le sezioni non sono le stesse: vedi il
  pattern qui sotto.
- **Il numero fa corpo unico col nome, a qualsiasi larghezza.** Una barra di
  schede a `display:flex` senza `flex-wrap` stringe i bottoni finché le parole
  si spezzano: alla larghezza minima della finestra (720) si leggeva "In" /
  "coda" / "(0)" su tre righe, col numero staccato dal nome che qualifica. La
  barra manda a capo le SCHEDE INTERE (`flex-wrap: wrap` sul contenitore) e la
  singola scheda non si spezza mai (`white-space: nowrap`): niente scorrimento
  laterale, e ogni nome resta col suo numero accanto.
- **Dove:** `manageTabCounts` in `src/shared/manageReview.js`; il tetto e la
  sua resa onesta (`LIST_PAGE_SIZE`, `listHitCap`, `countLabel`,
  `COUNT_CAP_HINT`) in `src/shared/feedback.js`; `updateTabCounts()` /
  `setListHead()` in `src/pages/manage/manage.js` (`.mg-tab-count`),
  `updateTabCounts()` in `src/pages/feedback/feedback.js`. I flag di onestà:
  `dataLoaded`/`loadFailed` in `manage.js`, `dataLoaded`/`loadError` +
  `showLoadError()` in `feedback.js`. Stato illeggibile: `statusUnreadable`,
  `sectionsReliable`, `publicStateLabel`, `PUBLIC_STATE_HINT` in
  `src/shared/manageReview.js`, consumati da `sezioniAttendibili()` /
  `mostraSezioni()` in tutt'e due le pagine. Test:
  `tests/manage-tab-counts.spec.mjs`, `tests/feedback-tab-counts-cap.spec.mjs`,
  `tests/feedback-sezioni-gemelle.spec.mjs`, `tests/unit/manageReview.test.mjs`,
  `tests/unit/feedbackCountCap.test.mjs`.
