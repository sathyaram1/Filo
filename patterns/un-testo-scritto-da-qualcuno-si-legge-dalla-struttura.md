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
   marcatore di turno compreso.

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
- **La punteggiatura è parte della forma.** `Controllo funzionalità NON
  superato:` con i due punti è il programma; senza, è qualcuno che cita la
  frase. Quando la forma vecchia non ha altro da esibire, la punteggiatura è
  l'unica cosa che resta da chiedere.

Sbagliare per eccesso qui costa più che sbagliare per difetto: un giro inventato
sposta il lavoro nella fetta sbagliata, e chi guarda non ha modo di accorgersene.

**Dove:** `readRounds()` e `verbaleConRilievi()` in
`src/shared/feedbackStats.js`, che leggono i verbali scritti da
`SN_VERIFIER_ROUND.roundNote` e appesi da `SN_FEEDBACK_THREAD.appendModelTurn`.
Le prove per porta: `tests/unit/feedbackStats.test.mjs`, sezioni «Il conto dei
giri non si fida della prosa» e «La quinta porta della stessa famiglia».
