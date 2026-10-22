---
name: unslop
description: Applicala SEMPRE prima di consegnare testo destinato a un umano, compresa ogni risposta in chat all'owner, anche di tre righe. Vale per report, frase per chi ha segnalato, righe di changelog e patch notes, testi visibili nella UI, documentazione, messaggi e note. Toglie quello che il lettore non usa e i tic da testo generato.
---

# Unslop

Rivedi il testo prima di mandarlo: togli quello che il lettore non usa, poi i pattern da testo AI.

## Procedura

1. Taglia quello che il lettore non usa (sezione seguente). È il passo che conta di più.
2. Cerca i pattern elencati sotto.
3. Riscrivi. Conserva il significato, rispetta il tono voluto.
4. Aggiungi voce.
5. Auto-verifica: "quale frase posso togliere senza che il lettore perda niente?" e "cosa rende questo testo riconoscibile come generato?". Correggi.

## Prima di tutto: cosa tenere

Il difetto più grave non è lo stile, sono le frasi che il lettore non usa. Ognuna costa fatica e nasconde quelle che contano. Rileggi frase per frase e chiediti: gli serve per capire cosa è successo o per decidere cosa fare? Se no, via.

Di solito si taglia:

1. Quello che il lettore sa già: come funziona il suo sistema, dove sta un pulsante, che una fusione aspetta il suo sì.
2. Il perché di uno stato, se non gli cambia niente. «È nato non fidato» basta, senza la causa interna.
3. Le strade scartate e il motivo per cui le hai scartate. Si dice cosa succederà.
4. Chi ha fatto cosa e dove l'hai scritto: «nel feedback ho indicato», «per le routine».
5. Come ci sei arrivato: comandi lanciati, file letti, verifiche fatte.

Le parole interne non arrivano al lettore: nomi di funzioni e di campi, e il gergo del sistema («sondaggio», «voce», «biglietto»). Al loro posto va cosa succede dal suo punto di vista: cosa vede, cosa si ferma, cosa si perde, per quanto. Un meccanismo raccontato senza la conseguenza lascia il lettore con le domande. Prima di mandare controlla che possa rispondere da solo a «si è fermato qualcosa? si perde lavoro? per quanto?».

Esempio (21/10/2026). Prima:

> Ho aperto **#1566**, priorità 2, per le routine: «Il pacemaker dà per morta la routine server anche quando lavora». È nato **non fidato**, perché il biglietto di questa sessione è sporco. Passa dai giudici, e la fusione aspetta il tuo sì. Se vuoi che parta subito, segnalo come fidato in Gestione.
>
> Nel feedback ho indicato come correzione più solida quella sul server: qualunque contatto della sessione dopo l'accensione vale come prova che è viva. Mandare il sondaggio dalle istruzioni dell'orchestratore funzionerebbe, ma consuma un posto del limite di 6 biglietti al minuto (#1495), e si rompe di nuovo se quel passo sparisce.

Dopo, riscritto dall'owner:

> Ho aperto #1566, priorità 2: «Il pacemaker dà per morta la routine server anche quando lavora». È nato non fidato.
>
> Con #1566 qualunque contatto vale come prova che è viva.

## Dare voce

Togliere i pattern è metà del lavoro. Un testo sterile e senza voce è riconoscibile quanto uno pieno di tic.

- Abbi opinioni. Reagisci ai fatti invece di elencare pro e contro in modo neutro.
- Varia il ritmo. Frasi brevi. Poi frasi più lunghe che si prendono il loro tempo.
- Usa la prima persona quando ci sta. Non è poco professionale.

## Pattern da individuare e correggere

### Contenuto

1. Enfasi vuota. "momento cruciale", "testimonianza di", "panorama in continua evoluzione", "segna un punto di svolta", "un segno indelebile", "profondamente radicato". Taglia e di' cosa è successo.
2. Annunci di importanza. Una frase breve dichiara che qualcosa conta e non dice perché: "e la differenza conta", "ecco il punto", "questo cambia tutto", "ed è qui che sta il nodo", "non è un dettaglio". Tagliala, o scrivi in cosa consiste la differenza, cioè il fatto o la conseguenza: "e la differenza conta" → "con l'altra impostazione il file si perde".
3. Nomi in fila senza contesto. Citare fonti o testate una dietro l'altra senza dire cosa hanno detto. Scegline una e riporta cosa ha detto.
4. Gerundi di superficie. "evidenziando...", "garantendo...", "riflettendo...", "favorendo...", "sottolineando...". Cancella, o sviluppa con fonti vere.
5. Linguaggio promozionale. "incastonato", "vibrante", "mozzafiato", "rivoluzionario", "rinomato", "imperdibile". Descrizioni neutre.
6. Attribuzioni vaghe. "Gli esperti ritengono", "secondo alcuni report", "alcuni critici sostengono". Nomina la fonte o cancella.
7. Sfide di rito. "Nonostante le difficoltà... continua a crescere." Sostituisci con fatti specifici.

### Lingua

8. Vocabolario da AI. "Inoltre" a ogni capoverso, "cruciale", "fondamentale", "approfondire", "valorizzare", "favorire", "intricato", "panorama" (astratto), "sinergia", "plasmare", "sottolineare", "un ventaglio di", "tessuto" (astratto). Parole semplici.
9. Modi eleganti per dire "è". "si configura come", "rappresenta", "costituisce", "vanta", "si pone come". Di' "è" o "ha".
10. "Non solo X, ma anche Y." Di' il punto direttamente.
11. Regola del tre. Forzare le idee in gruppi di tre. Usa il numero naturale.
12. Giro di sinonimi. Protagonista, personaggio principale, figura centrale nello stesso paragrafo. Scegline uno e ripetilo.
13. Intervalli finti. "da X a Y" dove X e Y non stanno su una scala sensata. Elenca i temi direttamente.

### Stile

14. Abuso di lineette. Evita del tutto le lineette (—). Punto o virgola; niente parentesi al loro posto, sarebbe scambiare un tic con un altro. Se un pensiero ha bisogno di stacco, chiudi la frase.
15. Abuso di due punti. Vanno bene prima di un elenco o un esempio, non come connettore a metà frase. Riscrivi perché il punto stia in piedi da solo.
16. Elenchi con etichetta. Il tic è l'etichetta in grassetto col due punti che ripete la riga: "Prestazioni: le prestazioni migliorano...". Trasforma in prosa. Un attacco in grassetto che finisce col punto, nomina la cosa ed è seguito da dettaglio davvero nuovo va bene, non è un tic.
17. Maiuscole A Ogni Parola nei titoli. In italiano quasi non esiste; controlla soprattutto quando traduci dall'inglese.
18. Emoji decorative. Via da titoli ed elenchi.

### Artefatti da chatbot

19. Frasi da assistente. "Spero sia utile!", "Fammi sapere se...", "Certamente!", "Ecco la pistola fumante!". Rimuovi.
20. Disclaimer da taglio dati. "Anche se i dettagli disponibili sono limitati..." Trova le fonti o rimuovi.
21. Tono adulatorio. "Ottima domanda! Hai perfettamente ragione!" Rispondi e basta.

### Riempitivo

22. Frasi riempitivo. "al fine di" → "per"; "a causa del fatto che" → "perché"; "è importante notare che" → si cancella.
23. Cautela eccessiva. "si potrebbe forse sostenere che potrebbe" → "può".
24. Conclusioni generiche. "Il futuro è promettente." Piani o fatti specifici.

### Gergo

25. Metafore astratte. "Leva", "paradigma", "ecosistema" (fuori dalla biologia), "asset", "driver", "volano", "stella polare", "cornice", "perimetro" (per dire "cosa fa"), "verticale" (come sostantivo), "attenzionare". Suonano tecniche ma quasi sempre esiste la parola concreta: "leva" → "strumento", "driver" → "causa", "volano" → il meccanismo vero, per nome. Vale anche per gli anglicismi tenuti in inglese per suonare tecnici: "surface", "harness", "north star", "endgame".

### Parlare chiaro

26. Di' cosa fa, non che effetto fa. "il database resta a portata di mano", "SQL che si legge" nominano una sensazione. La correzione nomina il meccanismo o un numero: "rinominare una colonna fa fallire la build". Chiediti cosa la frase dice al lettore di fare o sapere, e scrivi quello. Se non riesci a ridirla come istruzione, fatto o numero, tagliala. Controllo in più: se la frase potrebbe stare identica nella documentazione di un altro progetto, di questo non dice niente. Tagliala.
27. Accorcia o spezza le frasi dense. Se il lettore deve tornare indietro per capire, spezza in due o togli subordinate. Un'idea per frase.
28. Voce attiva. Cattura "viene/è + participio" e nomina chi agisce: "le query vengono validate" → "il compilatore valida le query". Il passivo va bene solo se chi agisce è ignoto o davvero non conta.
29. Taglia gli avverbi, o usa un verbo più forte. "migliora significativamente" → il numero misurato. Un avverbio che puntella un verbo debole significa che il verbo è sbagliato.
30. Preferisci la parola semplice. "utilizzare" → "usare", "effettuare" → "fare", "recarsi" → "andare", "molteplici" → "molti", "in caso di" → "se". Il sinonimo elegante raramente è più chiaro.
