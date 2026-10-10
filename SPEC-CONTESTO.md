# Il contesto dell'agente di Filo

Spec decisa a parole con l'owner il 10/10/2026. Ridisegna da zero cosa riceve
il modello della chat e come lavora, non solo il testo del prompt. Sostituisce
la sezione «Il contesto del modello» di `SPEC-HOME-FILO.md` (ramo
`claude/home-filo`); il resto di quella spec resta valido.

## Perché

Anthropic dà all'owner 400 € di crediti API al mese, e Haiku 5.5 costa quanto
GLM. Per l'alpha la chat userà quasi solo Haiku, e si può allargare a più
tester. Haiku 5.5 però ha due listini: fino a 100 000 token di prompt
0,10 $ / 0,50 $ per milione (entrata / uscita, lettura dalla cache 0,01 $),
sopra **cinque volte tanto**, su tutta la richiesta e anche sull'uscita. Nel
conto entrano anche i token letti dalla cache.

Il prompt di oggi, misurato il 10/10 col contatore di Anthropic su
`claude-haiku-5-5`:

| Pezzo | Token |
|---|---|
| Strumenti (44) | 21 700, di cui `IMPOSTA_PREFERENZA` 4 800 |
| Statico | 15 400, di cui «CLASSIFICAZIONE INTENTO» 8 700 |
| Contesto (memoria, STATO, cambi, file) | 3 000–6 000 |
| Storia (ultimi 20 messaggi) | fino a ~19 000 |
| Esiti dentro un turno (fino a 12 giri) | senza tetto: un solo `LEGGI_TRASPARENZA` vale ~37 000 |

Una prima chiamata vale già 40 000 token; una conversazione con un paio di
documenti letti passa i 100 000. In più:

- **Niente cache esplicita.** Il contesto variabile (STATO con l'ora al
  minuto) sta nel system, prima della storia: fra un turno e l'altro la storia
  non è mai in cache.
- **La conversazione non si compatta**: restano gli ultimi 20 messaggi, i più
  vecchi spariscono.
- **La memoria compattata non ha tetto** (busta da 200 KB, ~90 000 token
  Claude), e un agente delle lezioni fa una chiamata al modello dopo ogni turno.
- **Il prompt è cresciuto per regole.** «CLASSIFICAZIONE INTENTO» è nata per
  alzare il punteggio sul banco di prova; ha funzionato anche sulla metà del
  banco che il suo autore non aveva visto, ma il banco è meno vario dell'uso
  vero.

## Il principio

La bitter lesson: al modello si dice **chi è e cosa vuole ottenere**, gli si
danno **dati e strumenti potenti da usare con giudizio**, non regole su come
ragionare né flussi prestabiliti. Le regole che restano sono quelle che il
modello non può dedurre (com'è fatto Filo, il tono).

Il contrappeso: ogni chiamata in più è latenza e soldi. Uno strumento che
serve aprire quasi ogni volta va mostrato aperto; si chiude solo quello che
serve di rado.

## La richiesta, in ordine di stabilità

L'API Anthropic legge la richiesta come prefisso: strumenti, poi system, poi
messaggi. La cache vale fino al primo byte cambiato, quindi le parti stanno in
ordine dalla più stabile alla più variabile.

| # | Blocco | Cambia | Cache |
|---|---|---|---|
| 1 | Strumenti | con una versione di Filo | dentro il punto 2 |
| 2 | **Parte fissa**: chi sei, filosofia, com'è fatto Filo, tono | con una versione di Filo; **uguale per tutti gli utenti** | punto di cache, durata un'ora |
| 3 | **Parte dell'utente**: chi è, preferenze, indice delle memorie, filo compattato, stato del sistema | solo alla compattazione | punto di cache, durata un'ora |
| 4 | **Tratto vivo**: gli eventi dopo l'ultima compattazione, messaggi compresi | cresce in coda | punto automatico sull'ultimo blocco |

Regole che tengono in piedi la tabella:

- **Gli strumenti sono gli stessi per tutti e per ogni ruolo.** Stanno prima
  di tutto: se cambiano, la cache si rompe dall'inizio. Le differenze di
  ruolo vanno nel testo, dopo la parte fissa.
- **Nella parte fissa niente che dipenda dall'utente o dalla macchina.** Oggi
  ci sono tre eccezioni da togliere: lo stile dell'utente (inserito a ~29 000
  caratteri dentro lo statico), la riga sul sistema operativo (a 380
  caratteri dall'inizio), l'indice delle capacità che cambia col cancello Red
  Team. Vanno nella parte dell'utente.
- **La parte dell'utente si fotografa alla compattazione** e non si tocca fino
  alla successiva. Quello che cambia nel frattempo (una memoria nuova, la
  batteria che scende) entra come evento nel tratto vivo.
- **Il tratto vivo cresce solo in coda.** I turni passati non si riscrivono:
  modificarli rompe la cache da quel punto (e su Haiku 5.5 può invalidare il
  ragionamento rimandato).

Con una sola chiave Anthropic per tutti (vedi «Fornitore e chiavi») la cache
è per workspace: il blocco 2 si scrive una volta e lo leggono tutti gli
utenti.

## La parte fissa

Quattro sezioni, scritte corte:

1. **Chi sei.** L'assistente dentro Filo. Vuole il bene dell'utente e lo aiuta
   in ogni modo; a ogni messaggio risponde come pensa sia meglio per lui. È
   proattivo: l'utente esiste anche fra un messaggio e l'altro, e Filo vede
   cosa ha fatto.
2. **La filosofia di Filo in breve**, da `filo_filosofia.txt`.
3. **Com'è fatto Filo oggi**: un browser; la home e le sue zone; le pagine di
   Filo; cosa vede l'utente. Serve a capire «quella cosa a sinistra».
4. **Come scrivere**: la sezione sul tono di oggi resta com'è.

Cosa Filo sa fare **non è una sezione**: è l'elenco degli strumenti. Tutto
quello che l'utente può fare in Filo deve poterlo fare anche Filo, quindi
l'elenco unico è quello. «CLASSIFICAZIONE INTENTO», «COSA SA FARE FILO» e
«CONTI E CAMBI» non passano nella parte nuova; quello che ne serve davvero
deve tornare fuori dalle misure sul banco (vedi «Come si misura»).

Tetto iniziale: **8 000 token** per la parte fissa.

## Gli strumenti

Pochi strumenti generali al posto di 44 specifici. Ognuno ha una descrizione
corta (cosa fa, un esempio dove serve) e parametri senza descrizione quando il
nome basta. Le opzioni comuni stanno nella descrizione; quelle rare si leggono
con lo strumento stesso.

Il raggruppamento di partenza, da provare sul banco:

| Strumento | Assorbe |
|---|---|
| `impostazioni` (leggi / imposta) | IMPOSTA_PREFERENZA, IMPOSTA_ESTETICA, LEGGI_IMPOSTAZIONI, VOLUME, WIFI, BLUETOOTH, regole proxy, permessi dei siti, INSTALLA_AGGIORNAMENTO |
| `scheda` | NAVIGA, COMANDO_FINESTRA, ZOOM_PAGINA, STILE_PAGINA, RIPRISTINA_STILE_PAGINA, PROXY_TAB, PULISCI_TAB |
| `home` | CARTA_HOME, SPOSTA_ICONA |
| `promemoria` (crea / modifica / cancella) | TIMER, SVEGLIA, MODIFICA_SVEGLIA, CANCELLA_SVEGLIA, EVENTO_CALENDARIO |
| `file` | LEGGI_FILE, LEGGI_DOCUMENTO, APRI_FILE, RINOMINA_FILE, CERCA_DOCUMENTI, SALVA_APPUNTO |
| `terminale` | ESEGUI_COMANDO |
| `web` | CERCA_WEB |
| `memoria` (leggi / scrivi / cancella) | SALVA_LEZIONE, DIMENTICA, CANCELLA_MEMORIA |
| `filo` (cerca / espandi / cancella / annulla) | CERCA_CHAT, CANCELLA_PAGINE, CANCELLA_ARCHIVIO, ANNULLA_CAMBIO |
| `filo_su_di_se` | LEGGI_TRASPARENZA, CAPACITA_DETTAGLIO, INVIA_FEEDBACK |

Le chiavi delle impostazioni (oggi 4 800 token dentro `IMPOSTA_PREFERENZA`):
quelle che si chiedono spesso (tema, testo, volume, rete) stanno nella
descrizione, le altre si leggono con `impostazioni` → leggi.

Tetto iniziale: **8 000 token** per tutti gli strumenti. Il formato resta la
chiamata nativa (JSON): l'API ne garantisce la forma, gestisce più chiamate
insieme e non confonde un comando col testo per l'utente. Il risparmio sta
nelle descrizioni, non nel formato.

Sugli strumenti si applicano le regole che già valgono: livelli di autonomia,
conferme, guardiano, politica sui modelli. La spec cambia la loro forma, non
chi può fare cosa.

## Il filo come fonte del contesto

Il registro degli eventi esiste (#866, `src/shared/filoEventi.js`,
`src/main/services/ilFilo.js`): archivio suo in `eventi.jsonl`, cresce solo in
coda, senza tetti. Oggi contiene chat e pagine visitate, e il prompt non lo
usa. Diventa la sola fonte di quello che è successo.

### Cosa deve entrare

L'evento nasce dove si scrive lo stato (regola della spec della home), quindi
chat e interfaccia non divergono. Mancano:

- **le azioni**, con parametri ed esito, chiunque le faccia; oggi della chat
  resta solo il nome dell'azione;
- **i cambi di stato** che oggi stanno nel registro a parte `filo_cambi`
  (impostazioni, timer, sveglie, proxy, zoom);
- **le schede**: aperte, chiuse, cambiate;
- **ricerche e download**;
- **file letti e scritti** dall'editor;
- **timer e notifiche che scattano**;
- **i cambi del sistema che contano**: rete caduta o tornata, batteria sotto
  una soglia, Bluetooth collegato. Non ogni punto di batteria.

Il registro vecchio (`FILO_RAW_LOG`: 5000 voci, testi a 200 caratteri, in
`storage.json`) e «AZIONI RECENTI» nello STATO si tolgono: il pattern del filo
lo chiama già il taglio silenzioso che le regole del repo vietano.

### Tre livelli

| Livello | Chi lo scrive | Quando | Esempio |
|---|---|---|---|
| Grezzo | il codice | in tempo reale | «20:24:11 apre it.wikipedia.org/wiki/Donald_Trump» |
| Ore | il modello | alla compattazione | «20:24 cercato Trump su Wikipedia e aperto il link» |
| Giorni | il modello | una volta al giorno | «9/10: tesi, mail al relatore, ricette» |

- Il grezzo resta sempre su disco. «Espandere» un evento vuol dire scendere di
  un livello: lo strumento `filo` → espandi legge il tratto grezzo di quella
  riga. Ogni riga dei livelli alti tiene gli id degli eventi da cui è nata.
- La parte dell'utente contiene i giorni recenti e le ore dopo l'ultimo
  riassunto giornaliero. Il tratto vivo contiene il grezzo dopo l'ultima
  compattazione.
- **Prima di ogni messaggio dell'utente arrivano gli eventi grezzi successivi
  al turno precedente**, nello stesso messaggio, con l'ora e lo stato del
  sistema cambiato. Filo sa sempre cosa l'utente ha fatto nel frattempo.
- Le pagine visitate entrano ripiegate come già nella spec della home
  («14 pagine, fra cui YouTube: orche»).

### Chat per scheda o linea unica

Il contesto si costruisce dal filo, non dalla chat della scheda: i messaggi
della chat corrente sono eventi del tratto vivo, quelli delle altre chat
compaiono nel filo come gli altri eventi. Funziona con le chat per scheda di
oggi e con la linea unica della spec della home, senza cambiare niente quando
si passa all'una o all'altra.

## La compattazione

Una chiamata al modello (lo stesso della chat, se l'owner non sceglie
diversamente nei modelli predefiniti) che riceve la parte dell'utente e il
tratto vivo, e restituisce:

1. le righe del livello «ore» per il tratto più vecchio del tratto vivo;
2. le memorie da aggiornare (chi è l'utente, preferenze, memorie per
   argomento), se dal tratto è emerso qualcosa che merita di restare;
3. il nuovo stato del sistema per la parte dell'utente.

Dopo, la parte dell'utente si riscrive e il tratto vivo riparte dagli eventi
recenti non compattati. Le due ultime ore di grezzo (o gli ultimi N turni,
quale sia più corto) restano grezze: il modello deve vedere da vicino quello
che è appena successo.

**Quando parte:**

- **prima di una richiesta** che supererebbe la soglia (iniziale: 70 000
  token), anche a metà di un turno di strumenti;
- **quando l'utente è fermo** da più della durata della cache e il tratto vivo
  è grande: la cache è comunque fredda, riscrivere costa uguale;
- **una volta al giorno** per il livello «giorni».

La soglia lascia 30 000 token per un esito grosso prima di arrivare a 100 000.
Se dopo la compattazione una richiesta supera ancora i 100 000 (un documento
enorme), prima si tolgono dal tratto vivo gli esiti vecchi degli strumenti
(restano richiamabili); se non basta, la richiesta parte e il registro della
chiamata lo segna. Mai un taglio silenzioso del testo dell'utente.

## Le memorie

- **Chi è l'utente** e **preferenze**: sempre nella parte dell'utente.
  Tetto iniziale 3 000 token insieme. Quando lo superano, la compattazione le
  riordina spostando i dettagli in memorie per argomento.
- **Memorie per argomento**: nella parte dell'utente c'è solo l'indice, un
  titolo e al massimo una frase («animali domestici: due gatti, Miso e Pepe»).
  Il testo si legge con `memoria` → leggi. Tetto iniziale dell'indice: 2 000
  token.
- **Chi scrive**: il modello, con `memoria` → scrivi quando lo ritiene utile,
  e la compattazione come rete di sicurezza. Niente memorie annidate: per i
  dettagli il modello legge i documenti dell'utente e annota nella memoria
  quali sono quelli importanti.
- **Lezioni**: non sono più un tipo a parte. Una lezione è una memoria su come
  comportarsi. Spariscono l'agente delle lezioni dopo ogni turno, il buffer da
  3 000 caratteri e il compattatore delle lezioni.

## Gli esiti degli strumenti

- Tetto per un singolo esito: iniziale **20 000 token**. Oltre, l'esito dice
  quanto è lungo e come chiedere il pezzo dopo («pagina 1 di 4»). Il modello
  sceglie se leggere il resto.
- Gli esiti restano nel tratto vivo finché la compattazione non lo chiude.
- Dentro un turno non c'è più il tetto dei 12 giri: il limite è il budget in
  token. Il modello lavora finché finisce.

## Le costanti

Tutte modificabili dall'owner nei modelli predefiniti e dall'utente in
Preferenze → Avanzate, come ogni costante. Valori iniziali, da rivedere con le
misure:

| Costante | Valore |
|---|---|
| Tetto della parte fissa | 8 000 token |
| Tetto degli strumenti | 8 000 token |
| Tetto di chi è l'utente + preferenze | 3 000 token |
| Tetto dell'indice delle memorie | 2 000 token |
| Tetto del filo compattato (giorni + ore) | 7 000 token |
| Soglia di compattazione | 70 000 token |
| Grezzo che resta dopo la compattazione | 2 ore |
| Tetto di un esito | 20 000 token |
| Durata della cache dei blocchi 2 e 3 | un'ora |

I tetti della parte fissa e degli strumenti valgono per chi scrive Filo: una
sentinella in `tests/unit/` li controlla con lo stesso calcolo, così il prompt
non ricresce in silenzio di 11 000 token in dodici giorni come fra il 25/09 e
il 07/10.

## Fornitore e chiavi

- **Un fornitore Anthropic diretto** in `src/main/services/providers/`,
  accanto a `openrouter.js`. Via OpenRouter i crediti Anthropic non si usano,
  e OpenRouter può servire Claude da Google Vertex, che la politica sui
  modelli esclude. Chi ha servito si registra come per gli altri fornitori.
- **I punti di cache** (`cache_control`) li mette solo questo fornitore. Per i
  modelli via OpenRouter l'ordine dei blocchi resta lo stesso e la cache è
  quella implicita dell'host.
- **L'interruttore «solo pesi aperti»** riporta la chat su un modello aperto
  via OpenRouter; il contesto è lo stesso.
- **La chiave.** Una sola chiave Anthropic per tutti gli utenti, perché la
  cache del blocco 2 sia condivisa. Due strade, da decidere (vedi sotto).

## Come si misura

- **Banco di prova** (`Desktop/Filo/test/agente/agent-bench`, 80 casi): ha già
  il trasporto Anthropic. Si confrontano su Haiku il contesto di oggi e quello
  nuovo, fase per fase.
- **Casi presi dall'uso vero**, perché il banco è meno vario: si estraggono
  dalle chiamate registrate in `aiHistory` una ventina di richieste reali,
  diverse fra loro, e si aggiungono al banco.
- **Costo e cache dal vivo**: `cache_read_input_tokens` e
  `cache_creation_input_tokens` di ogni chiamata nel registro delle chiamate,
  e quante richieste superano i 100 000.

Stima a regime, da verificare: una chiamata tipica con 30 000 token in cache e
3 000 nuovi costa circa 0,001 $. Cinquanta tester da cento chiamate al giorno
fanno ~5 $ al giorno, compattazioni comprese.

## Fasi, in ordine

1. **Fornitore Anthropic diretto** con cache esplicita, registro di chi ha
   servito e dei token in cache. Prima misura sul banco col contesto di oggi:
   è la base del confronto.
2. **Il filo completo**: gli eventi mancanti (azioni con esito, cambi di stato,
   schede, file, sistema) nascono dove si scrive lo stato; `filo_cambi` entra
   nel filo; via il registro vecchio.
3. **La richiesta nuova**: i quattro blocchi nell'ordine della tabella, il
   tratto vivo costruito dal filo, gli eventi grezzi davanti a ogni messaggio.
4. **La compattazione** a livelli, con la soglia e la parte dell'utente
   fotografata.
5. **Parte fissa e strumenti nuovi**, misurati sul banco allargato contro la
   fase 1.
6. **Memorie**: indice, strumento `memoria`, via lezioni e agente delle
   lezioni.

## Da verificare prima di scrivere codice

- **Se Haiku 5.5 supporta la compattazione lato server** di Anthropic
  (`compact-2026-01-12`). Se sì, va valutata contro la compattazione propria;
  quella propria resta comunque per i livelli del filo.
- **Il prefisso minimo che Haiku 5.5 mette in cache.** Non è nella
  documentazione consultata il 10/10. Sotto il minimo la cache non scatta,
  senza errori.
- **Come si comporta il ragionamento di Haiku 5.5** nei turni con strumenti, e
  se il ragionamento rimandato va tenuto (oggi Filo lo rimanda e conta come
  entrata).

## Da decidere (owner)

1. **Chiave Anthropic**: un proxy sulle functions del server (la chiave non
   lascia mai il server, i limiti per utente li applica il sistema crediti che
   c'è già; costa un passaggio in più nelle risposte), oppure chiavi per
   utente nello stesso workspace (non so ancora se l'API di amministrazione
   permetta di crearle).

## Rimandato

- **Aprire le sezioni in anticipo mentre l'utente scrive**, con un
  classificatore locale: in `Desktop/Filo/idee.md` (10/10/2026).
- **Privacy**: questa spec pensa al sistema per chi vuole meno limiti. Cosa
  entra nel filo, cosa esce dalla macchina e come lo si spegne si decide nella
  discussione sulla privacy.
