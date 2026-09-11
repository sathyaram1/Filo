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
   ne facevano sparire uno vero.

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

**Dove:** `readRounds()` e `verbaleConRilievi()` in
`src/shared/feedbackStats.js`, che leggono i verbali scritti da
`SN_VERIFIER_ROUND.roundNote` e appesi da `SN_FEEDBACK_THREAD.appendModelTurn`.
Le prove per porta: `tests/unit/feedbackStats.test.mjs`, sezioni «Il conto dei
giri non si fida della prosa» e «La quinta porta della stessa famiglia», più
«il report di chi corregge non diventa un giro, per quanto citi il verbale».
