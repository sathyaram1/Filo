# Un testo scritto da qualcuno si legge dalla struttura

[← Tutti i pattern](../PATTERNS.md)

Quando un numero si ricava da testo che una persona o un agente ha scritto, non
cercare le parole: cerca il POSTO. Le parole le scrive anche chi racconta.

Sulla scheda «Statistiche feedback» (#496) la torta dei giri di verifica conta i
verbali scritti nella conversazione del feedback. Il verbale comincia con
`Verifica superata.` o `Verifica: 3 rilievi.`, quindi il primo lettore cercava
quelle righe nel testo. Lo stesso difetto è tornato per **quattro giri di
verifica di fila**, ogni volta da una porta nuova, perché quelle frasi le scrive
anche chi non sta verbalizzando:

1. dentro il testo di un rilievo («…il lavoro si ferma quando il registro non
   risponde»);
2. in un commento scritto da una persona («Verifica superata? secondo me no»);
3. nel riassunto del verbale, dove il verificatore racconta il giro prima
   («Controllo funzionalità NON superato nel giro scorso, adesso sì»);
4. nel report di chi corregge («Ho rilanciato le prove. Verifica superata.»).

Ogni giro chiudeva la porta trovata e ne lasciava aperta un'altra. Un lavoro
costato cinque critiche finiva nella fetta verde «passata subito», che è il
contrario di quello che era successo.

**La cura non è un'eccezione per volta.** Ogni eccezione allarga la lista delle
frasi da NON credere, e quella lista non finisce mai: sono frasi di italiano
normale. La cura è ancorarsi a com'è fatto il testo, quando chi lo scrive è un
programma:

- **Chi ha scritto questo pezzo?** Se il formato porta già l'autore di ogni
  turno, filtrare su quello toglie di mezzo tutto ciò che scrivono le persone.
- **Dove lo scrive il programma, esattamente?** Se una nota è un turno e il
  verbale è la nota intera, il verbale comincia alla prima riga scritta del
  turno, e un turno ne porta al più uno. Una riga d'apertura più giù è
  qualcuno che cita.
- **Le parti fisse stanno in posti fissi.** La riga d'esito è l'ultima prima
  dell'elenco dei rilievi: cercarla in tutto il blocco vuol dire cercarla anche
  nel riassunto.

Sbagliare per eccesso qui costa più che sbagliare per difetto: un giro inventato
sposta il lavoro nella fetta sbagliata, e chi guarda non ha modo di accorgersene.

**Dove:** `parseRounds()` in `src/shared/feedbackStats.js`, che legge i verbali
scritti da `SN_VERIFIER_ROUND.roundNote` e appesi da
`SN_FEEDBACK_THREAD.appendModelTurn`. Le prove per porta:
`tests/unit/feedbackStats.test.mjs`, sezione «Il conto dei giri non si fida
della prosa».
