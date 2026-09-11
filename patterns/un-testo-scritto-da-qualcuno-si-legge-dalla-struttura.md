# Un testo scritto da qualcuno si legge dalla struttura

[← Tutti i pattern](../PATTERNS.md)

Quando un numero si ricava da testo che una persona o un agente ha scritto, non
cercare le parole. Le parole le scrive anche chi racconta.

Sulla scheda «Statistiche feedback» (#496) la torta dei giri di verifica conta i
verbali scritti nella conversazione del feedback. Il verbale comincia con
`Verifica superata.` o `Verifica: 3 rilievi.`, quindi il primo lettore cercava
quelle righe nel testo. Lo stesso difetto è tornato per **sei giri di verifica
di fila**, ogni volta da una porta nuova, perché quelle frasi le scrive anche
chi non sta verbalizzando:

1. dentro il testo di un rilievo («…il lavoro si ferma quando il registro non
   risponde»);
2. in un commento scritto da una persona («Verifica superata? secondo me no»);
3. nel riassunto del verbale, dove il verificatore racconta il giro prima
   («Controllo funzionalità NON superato nel giro scorso, adesso sì»);
4. nel report di chi corregge, più giù («Ho rilanciato le prove. Verifica
   superata.»);
5. nel report di chi corregge, sulla PRIMA riga, che è la forma che il repo
   chiede a un report di consegna («Verifica superata. Nessuna regressione.»);
   e in cima al campo note, che l'owner modifica per intero in una casella di
   testo, e in un pezzo di conversazione incollato dentro una risposta,
   marcatore di turno compreso;
6. nel report di chi corregge di nuovo, questa volta con la STRUTTURA e non con
   una frase: riportando il verbale a cui sta rispondendo, oppure elencando i
   rilievi chiusi col livello davanti, che è la forma in cui li ha ricevuti;
7. con la riga che separa un turno dall'altro. Il verbale era ormai ancorato al
   TURNO, ma un turno comincia da una riga di testo dentro le note, e quella
   riga la scrive anche chi incolla un pezzo di conversazione o chi la cita
   raccontando cosa ha letto. Due strade aggiungevano un giro mai successo, due
   ne facevano sparire uno vero;
8. con la stessa riga, staccata da una riga vuota. Il giro 12 aveva chiesto al
   marcatore di avere sopra una riga vuota, e questo chiude la citazione
   infilata dentro un capoverso. Ma un blocco incollato lo si stacca proprio
   con una riga vuota: sei strade, dal verbale di un'altra segnalazione
   riportato in una risposta alla riga del taglio del tetto scritta a mano.

Ogni giro chiudeva la porta trovata e ne lasciava aperta un'altra. Un lavoro
costato cinque critiche finiva nella fetta verde «passata subito», che è il
contrario di quello che era successo.

**Restringere il posto non basta.** Il giro 9 ha stretto la ricerca alla prima
riga scritta di ogni turno del programma, e il giro dopo ha trovato tre modi di
scrivere quella prima riga senza verbalizzare niente. Ogni giro di questa
rincorsa aggiunge una condizione e ne lascia scoperta un'altra: sono frasi di
italiano normale, e i posti dove qualcuno può scriverle non finiscono.

**La cura è chiedere al testo di ESIBIRE LA SUA STRUTTURA, e non contare quello
che non ne ha.**

- **Il numero viene dal pezzo che si può verificare.** Un verbale con rilievi
  dichiara quanti sono, li elenca, e prima dell'elenco scrive con quale
  decisione si chiude: tre cose che devono combaciare fra loro. Chi racconta non
  le fa combaciare per caso, e chi volesse falsificarle dovrebbe riscrivere un
  verbale intero. Da lì, e solo da lì, vengono i numeri.
- **Quello che non ha struttura non è un conteggio, è un sì/no.** Il verbale di
  un giro superato è una riga di parole, indistinguibile da chi quelle parole le
  cita. Non lo si conta come un giro: dice soltanto «questo lavoro è passato»,
  che è una domanda a due risposte. Ripetuto non cambia niente, e falsificato su
  un lavoro che ha davvero girato nemmeno.
- **Chi ha scritto questo pezzo?** Se il formato porta già l'autore di ogni
  turno, filtrare su quello toglie di mezzo tutto ciò che scrivono le persone.
  Resta una difesa utile, ma non è sufficiente da sola: il turno del programma
  lo scrivono anche gli agenti che non stanno verbalizzando.
- **La struttura da sola non basta: serve anche il POSTO.** Una struttura se la
  porta dietro anche chi la cita, e citarla è quello che chi corregge fa tutti i
  giorni. Il verbale allora non è solo una forma, è un TURNO INTERO: comincia
  alla prima riga scritta del turno e finisce con l'ultimo rilievo. Prosa prima
  o dopo l'elenco vuol dire che quell'elenco sta dentro il testo di qualcun
  altro. Con questa regola la porta 6 si chiude in tutte e due le versioni.
- **Non indovinare il pezzo che manca.** Il verbale senza la riga di decisione
  ripiegava sul livello più alto dei rilievi. Bastava che chi corregge elencasse
  i rilievi chiusi perché una lavorazione passata uscisse dalla torta e si
  leggesse come fermata. Se un pezzo della struttura non c'è, non è quel testo:
  non è un verbale a cui manca qualcosa.
- **Anche il CONTENITORE è testo: chiedigli la sua struttura.** Il turno non è
  un dato, è una riga nel blob delle note, e chi cita la copia. Ma chi APPENDE
  un turno lo fa sempre allo stesso modo, e quel modo si può pretendere: il
  marcatore sta all'inizio del blob, oppure ha sopra una riga vuota (o un altro
  marcatore). Una riga di marcatore in mezzo a un capoverso è una citazione, e
  non spezza più il turno di chi l'ha scritta.
- **Quello che si ripete è una citazione.** Il server scrive un marcatore per
  turno, con l'istante in cui l'ha appeso: se lo stesso marcatore ricompare, il
  secondo è la copia incollata da qualcuno. E il verbale ripetuto riga per riga
  nel turno SUBITO DOPO è chi corregge che riporta quello a cui risponde. Il
  prezzo è un conteggio in difetto nei casi rari (due turni veri nello stesso
  minuto), che è il verso giusto in cui sbagliare.
- **E quello che torna INDIETRO nel tempo è una citazione.** È l'unica cosa che
  chi incolla non si porta dietro: i turni veri vengono appesi uno dopo l'altro,
  quindi l'istante scritto nel marcatore cresce sempre, mentre un turno citato
  porta l'istante del giorno in cui fu scritto. Un marcatore più vecchio del
  turno prima è una copia. Due accortezze: le catene sono DUE, una per i turni
  del programma e una per quelli dell'utente, perché le scrivono due orologi
  diversi e uno solo avanti farebbe sparire tutti i turni veri che vengono dopo;
  e ci vuole una tolleranza di qualche minuto, che assorbe lo scarto fra due
  scritture della stessa parte.
- **L'elenco sta IN FONDO, e si cerca da lì.** Cercando il primo rilievo si
  trovano quelli di un verbale citato dentro il riassunto, e il verbale vero non
  si riconosce più: il suo giro spariva. Il server l'elenco lo scrive per ultimo
  e sotto non ci mette niente, quindi l'elenco è il blocco finale del turno e il
  conto dei rilievi si fa su quello soltanto.
- **Una riga che dichiara un fatto del sistema vale solo dove il sistema la
  scrive.** La riga che annuncia il taglio della conversazione troppo lunga sta
  in cima al blob, sempre e solo lì. Cercarla ovunque vuol dire trovarla anche
  quando è qualcuno ad averla incollata raccontando una conversazione tagliata,
  e allora una lavorazione buona esce dai conti per una riga di prosa.
- **Una riga di sole parole non può fare il danno grosso.** La forma vecchia
  `Controllo funzionalità NON superato` non ha niente da esibire: il giro 10 ha
  provato a chiederle la punteggiatura, e il giro 11 ha riaperto la porta
  spostando i due punti di due parole. Non si conta più. Le forme piatte rimaste
  dicono soltanto «è passato», che è la stessa cosa che dice una lavorazione
  chiusa: falsificarle non sposta niente. Regola generale: a una riga senza
  struttura si può concedere il sì/no innocuo, mai il verdetto che ribalta il
  conteggio.

Sbagliare per eccesso qui costa più che sbagliare per difetto: un giro inventato
sposta il lavoro nella fetta sbagliata, e chi guarda non ha modo di accorgersene.

**Dove:** `readRounds()`, `verbaleConRilievi()` e `notesTruncated()` in
`src/shared/feedbackStats.js`, che leggono i verbali scritti da
`SN_VERIFIER_ROUND.roundNote` e appesi da `SN_FEEDBACK_THREAD.appendModelTurn`;
`turnOpeners()`, `markerOpensTurn()` e `markerIsQuoted()` in
`src/shared/feedbackThread.js` per il contenitore.
Le prove per porta: `tests/unit/feedbackStats.test.mjs`, sezioni «Il conto dei
giri non si fida della prosa», «La quinta porta della stessa famiglia», «il
report di chi corregge non diventa un giro, per quanto citi il verbale», «La
settima porta: la riga che separa i turni è testo come tutto il resto» e
«Ottava porta: il blocco incollato, staccato da una riga vuota», più
`tests/unit/feedbackThread.test.mjs` per l'invariante del marcatore.

**La cura vera non è qui.** Chi appende un turno sa di averlo appeso, e chi
conta un giro lo ha contato: quel fatto è un DATO, e finché vive solo dentro
una stringa di testo si può falsificare. Il posto giusto per i giri di verifica
è un campo del feedback scritto dal server, come già fa per i bilanci. Finché
non c'è, questo file racconta otto giri di rincorsa.
