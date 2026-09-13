# Nuovo tipo di messaggio: decidi SUBITO se le pagine web possono chiamarlo

[← Tutti i pattern](../PATTERNS.md)

Il canale `filo:message` è **uno solo** e ci arrivano sia le pagine interne
(shell, `filo://`) sia i content script delle pagine web esterne.

**Il default è stato invertito** (#592, giro 9): il gate non sta più dentro i
singoli handler, sta nel dispatch centrale, e legge l'elenco di ciò che è LECITO
(`SN_MSG.WEB_ALLOWED` in `src/shared/messages.js`). Un messaggio nuovo nasce
**vietato** alle pagine visitate. Prima il default era l'opposto — chi registrava
un handler lo apriva a qualunque sito senza accorgersene — e il conto si è visto
tutto insieme: da un indirizzo web si leggeva lo stato che il modello
legge a ogni messaggio (schede aperte con indirizzo e titolo, sveglie,
notifiche, registro delle azioni delle ultime 24 ore, messaggio della home), si
**scriveva** una sveglia il cui nome finisce dentro ogni prompt senza recinto, si
leggeva l'archivio delle schede chiuse e le pagine messe da parte, e si svuotava
l'archivio.

- **Domanda obbligatoria** per ogni `MSG.*` nuovo: *"ha senso che un sito
  qualsiasi lo chiami?"*. Se la risposta è no — e lo è per tutto ciò che legge
  dati dell'utente, tocca il disco, o aziona il sistema operativo — **non fare
  niente**: è già vietato. Se la risposta è sì, aggiungilo a `WEB_ALLOWED` col
  motivo accanto, nel gruppo che gli somiglia.
- Il gate dentro l'handler resta **seconda barriera** dove c'è, e si scrive così:
  ```js
  const isFilo = (origin) => String(origin || '').startsWith('filo://');
  on(MSG.X, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    …
  });
  ```
  (`origin` è il terzo argomento dell'handler; la shell è `filo://shell/shell.html`.)
- Una chiamata che parte **dal main** (una scorciatoia da tastiera, un timer) non
  ha mittente, e un'origine vuota conta come pagina web: quelle si dichiarano,
  `handleMessage(msg, { internal: true })`.
- Il gate centrale è provato in `tests/messaggi-origine-web.spec.mjs`, e la
  sentinella `tests/unit/webMessagesAllow.test.mjs` tiene l'elenco onesto nei due
  versi: niente memoria, stato del prompt, cronologie o dati messi da parte
  dentro; e ogni messaggio che gli script sotto `src/content/` **mandano
  davvero** dentro — un messaggio che manca farebbe smettere di funzionare quella
  cosa su ogni sito, in silenzio.
- **Quello che a un sito visitato serve è poco**, e vale la pena saperlo a
  memoria: le funzioni di Filo sulla pagina (spiega, traduci, leggi, cerca), le
  azioni dell'agente «Aiuto» con la loro conferma, i bottoni del menu del tasto
  destro (navigazione, schede, download, mettere da parte), il correttore, il
  menu «Incolla» con la cronologia degli appunti — compreso svuotarla, perché è
  un gesto dell'utente in quel menu — le impostazioni in lettura, il riquadro del
  feedback col saldo dei crediti, e gli avvisi sul sito che si sta guardando.
  Rileggere o togliere quello che l'utente ha messo da parte, no: quello si fa
  dalle pagine interne.
- **Due bandiere rosse** che tengono un messaggio FUORI dall'elenco qualunque
  comodità sembri portarci dentro: la risposta
  contiene **percorsi assoluti su disco** (rivelano lo username e la struttura
  del computer), oppure il comando fa **aprire/eseguire qualcosa** al sistema
  (`shell.openPath`, `showItemInFolder`, spawn). Un sito che può far aprire un
  file appena scaricato, su Windows, può farlo eseguire.
- **Documentalo dove il messaggio è definito** (`src/shared/messages.js`), non
  solo nell'handler: chi aggiunge il messaggio gemello lo vede.
- **Testalo** con un dispatch di origine web: `SN_HANDLE_MESSAGE(msg, { tab: {
  url: 'http://sito-ostile.example/' }, url: '…' })` deve dare `forbidden`, e la
  stessa chiamata da `filo://` deve passare. Esempi:
  `tests/downloads-nav.spec.mjs`, `tests/clipboard-origin-gate.spec.mjs`,
  `tests/audit-quit-app-origin.spec.mjs`.

## Un canale mezzo aperto si governa con l'elenco di ciò che è LECITO

Qualche canale non è né tutto aperto né tutto chiuso: i content script ci fanno
una cosa sola e legittima, e tutto il resto non li riguarda. `update_settings` è
così: dalle pagine web serve solo per scegliere il modello di dettatura dal menu
del tasto destro.

Lì il gate non è un `forbidden`, è un filtro, e il filtro va scritto al
contrario di come viene da sé. Per un anno è stato un elenco di **divieti** —
prima le chiavi API, poi anche lo stile dell'agente — e tutto quello che nessuno
aveva ancora pensato passava: accendere la modalità terminale, cioè il permesso
che dà a Filo la shell; spegnere il rilevamento dei siti pericolosi, l'ad-block,
il blocco dei popup; mettere i cookie su «manuale»; alzare il limite di spesa;
dirottare il modello che risponde in chat (#592, giro 4). Un elenco di divieti
dice «tutto è permesso tranne quello che mi sono ricordato», e un'impostazione
nuova nasce permessa per dimenticanza.

L'elenco di ciò che è lecito è più corto, si legge tutto in una schermata, e
un'impostazione nuova nasce vietata. Il filtro tiene anche la FORMA, non solo il
nome: `models` passa, ma solo la voce della dettatura, e solo se è una stringa.
Se dopo il filtro non resta niente, non si scrive e non si annuncia niente: un
annuncio a vuoto farebbe rileggere tutte le pagine di impostazioni aperte.

Sta in `src/main/services/handlers/storage.js` (`AMMESSE_DA_WEB`), provato in
`tests/impostazioni-pagina-aperta.spec.mjs`.

## Chiudendo un messaggio, guarda quelli che c'erano già

Il gate si mette quasi sempre mentre si scrive un messaggio nuovo, e lì lo
sguardo è sul nuovo. Ma un messaggio nuovo che legge i dati dell'utente quasi
mai è il primo: di solito ce n'è uno vecchio, scritto quando la domanda non se
la faceva nessuno, che restituisce **le stesse identiche righe** con un altro
nome. Gattare solo il nuovo lascia in piedi una chiusura aggirabile chiedendo la
stessa cosa col nome di prima.

Successo così con la memoria di Filo (#592, giro 7): tre messaggi nuovi per
leggerla e cancellarla dall'utente, tutti e tre chiusi alle pagine web, con la
ragione scritta accanto. Nove righe più su, `filo_get_memory` rispondeva a
chiunque e restituiva profilo e preferenze apprese per intero.

Quindi, quando gatti un messaggio: cerca gli altri che toccano lo stesso dato
(`grep` sul nome del modulo che li serve, non sul nome del messaggio) e gattali
insieme.

E **l'elenco del test non si scrive a mano**: ricavalo dai nomi nel catalogo dei
messaggi, così un messaggio nuovo sulla stessa cosa nasce dentro la prova invece
che fuori.

```js
const nomi = Object.entries(MESSAGES)
  .filter(([k]) => /^FILO_/.test(k) && /MEMORY|LESSON/.test(k))
  .map(([, v]) => v);
```

Esempio in `tests/memoria-di-filo.spec.mjs`.

## Il dato non sta solo dietro i suoi messaggi: sta anche in una chiave

Chiudere tutti i messaggi che servono un dato non lo chiude. Sotto i messaggi
c'è lo storage, e il canale generico dello storage (`_storage:get`,
`_storage:set`, `_storage:remove`) risponde anche alle pagine visitate: è la
porta di servizio della stessa stanza, e ci si entra con il nome della chiave
invece che con il nome del messaggio.

È successo con la memoria di Filo (#592, giro 8). Il giro 6 aveva chiuso i tre
messaggi nuovi, il giro 7 quello vecchio che dava gli stessi moduli. Il canale
dello storage difendeva **una chiave sola**, `settings`, quindi da un indirizzo
web la memoria si leggeva, si riscriveva e si cancellava lo stesso. E scriverla
è peggio che leggerla: una riga entrata da fuori sta in ogni prompt, vale in
ogni conversazione e sopravvive al riavvio, senza dover convincere il modello a
salvare niente. Dalla stessa porta uscivano anche il registro delle azioni
recenti, le notifiche, le sveglie e il messaggio della home, che finiscono nel
contesto che il modello legge a ogni messaggio, e la cronologia delle
conversazioni con Filo.

Quindi, per un dato che le pagine web non devono toccare, le porte sono due e si
chiudono insieme: i suoi messaggi, e la sua chiave. Chiuderne una e non l'altra è
successo in tutti i due versi: al giro 8 era chiusa la fila dei messaggi e aperta
la chiave; al giro 9, chiusa la chiave, erano aperti i messaggi che servono lo
stesso dato — lo stato del prompt, le sveglie, le notifiche, l'archivio delle
schede. È la ragione per cui il gate adesso è centrale: due elenchi di ciò che è
lecito, uno per i messaggi e uno per le chiavi, invece di N gate scritti a mano
che si dimenticano a turno. Sul canale dello storage
vale la stessa regola del canale mezzo aperto, l'elenco di ciò che è lecito
(`SN_CONST.WEB_STORAGE_KEYS`): le pagine visitate ci tengono il dizionario
personale, l'autocorrezione, la disposizione delle icone del menu e la bozza di
un feedback, e leggono le impostazioni. Tutto il resto è vietato, e una chiave
nuova nasce vietata.

In lettura si FILTRA invece di rifiutare: `get(null)`, «dammi tutto», è la forma
normale dello shim, e rifiutarla spegnerebbe il correttore in ogni pagina. In
scrittura si rifiuta l'intera richiesta se anche una sola chiave è fuori
elenco: una scrittura mezza fatta è peggio di una rifiutata, perché chi chiama
non ha modo di sapere quale metà è passata.

La sentinella in `tests/unit/webStorageAllow.test.mjs` legge le chiavi dal
CODICE degli script che girano nelle pagine visitate e verifica che stiano tutte
nell'elenco: una lista scritta a mano nel test invecchia in silenzio, ed è
esattamente il difetto che l'elenco corregge.

## E la terza porta: quello che una pagina visitata può far FARE a Filo

I messaggi e le chiavi dicono cosa una pagina può leggere e scrivere. Restava il
canale con cui può far AGIRE Filo: le azioni (`FILO_RUN_ACTION` e
`FILO_CONFIRM_ACTION`), che stanno nell'elenco dei messaggi leciti perché da lì
lavora l'assistente «Aiuto» della barra laterale. Accanto alle due voci era
scritto che andavano bene perché passano dal registro dei livelli e dalla
conferma. Il registro c'era davvero. La frase era falsa lo stesso (#592, giro
10):

- le azioni di livello 1 partono senza chiedere niente e **restituiscono a chi
  le chiede quello che leggono**. Da un indirizzo web si leggeva un documento
  dal disco dell'utente (provato con un estratto conto: IBAN e saldo sono
  tornati indietro interi) e si otteneva l'uscita di un comando del terminale
  (`cat` su un file, con la modalità terminale accesa). Il livello 1 di quelle
  azioni è motivato per iscritto con «non manda niente fuori dal computer,
  il testo entra solo nel contesto del modello»: vero finché a chiedere è Filo,
  falso appena a chiedere è il sito;
- si fissava una lezione, che poi vale in ogni conversazione e sopravvive al
  riavvio, e si creava una sveglia il cui NOME entra nello stato che il modello
  legge a ogni messaggio: la stessa porta che il giro 9 aveva chiuso sul
  messaggio dedicato, aperta dal canale accanto;
- le azioni di livello 2 e 3 **si confermavano da sé**. La difesa in profondità
  del #250 chiede che un mittente non interno abbia ricevuto PRIMA la richiesta
  di conferma per quella stessa azione. Ma a registrare quel pending è la
  richiesta stessa: prima si chiede l'azione, subito dopo si manda la conferma,
  e il riquadro non compare mai. Da un indirizzo web si impostava lo stile
  dell'agente e si cancellava tutta la memoria dell'utente, che a lui Filo fa
  cancellare digitando «conferma».

Quindi il terzo elenco, dove le azioni sono dichiarate:
`SN_ACTION_LEVELS.WEB_ALLOWED_ACTIONS`. Un'azione nuova nasce vietata alle
pagine visitate, e il controllo sta nel dispatch delle azioni, che è il punto
unico da cui passano sia la richiesta sia la conferma. L'elenco è corto perché
corto è il bisogno vero: la barra laterale emette `INVIA_FEEDBACK` (l'unica
azione tipizzata che il suo prompt le insegna) e `NAVIGA` (il suo «apri il link
in una scheda nuova»).

La regola generale, dopo tre giri sulla stessa stanza: **ogni canale che arriva
dalle pagine visitate vuole il suo elenco di ciò che è lecito, scritto dove la
cosa è dichiarata**, e la sentinella che lo confronta col codice che quel canale
usa davvero (`tests/unit/webActionsAllow.test.mjs` legge le azioni dal codice
della barra laterale e dal prompt dell'agente di pagina). Chiuderne uno e non
gli altri lascia la stessa stanza aperta dalla porta accanto, ed è successo a
ogni giro.

Resta una cosa che l'elenco non risolve e che va tenuta presente: per un
mittente che non è una pagina interna, il riquadro di conferma lo disegna la
pagina stessa (`SN_CONFIRM_UI` gira nel mondo isolato del content script).
Quel riquadro non è una prova che l'utente abbia visto qualcosa: è per questo
che l'elenco delle azioni lecite deve restare corto, e contenere solo cose il
cui danno, se confermate da sole, è quello che quella pagina poteva già fare per
conto suo (mandare un feedback, aprire un link).
