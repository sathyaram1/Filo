---
name: unslop
description: Applicala SEMPRE prima di consegnare testo destinato a un umano — report per l'owner, frase per chi ha segnalato, righe di changelog e patch notes, testi visibili nella UI, documentazione, messaggi e note. Toglie i tic da testo generato e rende la scrittura chiara e immediata.
---

# Unslop

Rivedi il testo per togliere i pattern da testo AI e renderlo chiaro ed immediato.

## Procedura

1. Cerca i pattern elencati sotto.
2. Riscrivi. Conserva il significato, rispetta il tono voluto.
3. Aggiungi voce (sezione seguente).
4. Auto-verifica: "cosa rende questo testo riconoscibile come generato?" Correggi i tic rimasti.

## Dare voce

Togliere i pattern è metà del lavoro. Un testo sterile e senza voce è riconoscibile quanto uno pieno di tic.

- Abbi opinioni. Reagisci ai fatti invece di elencare pro e contro in modo neutro.
- Varia il ritmo. Frasi brevi. Poi frasi più lunghe che si prendono il loro tempo.
- Usa la prima persona quando ci sta. Non è poco professionale.

## Pattern da individuare e correggere

### Contenuto

1. Enfasi vuota. "momento cruciale", "testimonianza di", "panorama in continua evoluzione", "segna un punto di svolta", "un segno indelebile", "profondamente radicato". Taglia e di' cosa è successo.
2. Nomi in fila senza contesto. Citare fonti o testate una dietro l'altra senza dire cosa hanno detto. Scegline una e riporta cosa ha detto.
3. Gerundi di superficie. "evidenziando...", "garantendo...", "riflettendo...", "favorendo...", "sottolineando...". Cancella, o sviluppa con fonti vere.
4. Linguaggio promozionale. "incastonato", "vibrante", "mozzafiato", "rivoluzionario", "rinomato", "imperdibile". Descrizioni neutre.
5. Attribuzioni vaghe. "Gli esperti ritengono", "secondo alcuni report", "alcuni critici sostengono". Nomina la fonte o cancella.
6. Sfide di rito. "Nonostante le difficoltà... continua a crescere." Sostituisci con fatti specifici.

### Lingua

7. Vocabolario da AI. "Inoltre" a ogni capoverso, "cruciale", "fondamentale", "approfondire", "valorizzare", "favorire", "intricato", "panorama" (astratto), "sinergia", "plasmare", "sottolineare", "un ventaglio di", "tessuto" (astratto). Parole semplici.
8. Modi eleganti per dire "è". "si configura come", "rappresenta", "costituisce", "vanta", "si pone come". Di' "è" o "ha".
9. "Non solo X, ma anche Y." Di' il punto direttamente.
10. Regola del tre. Forzare le idee in gruppi di tre. Usa il numero naturale.
11. Giro di sinonimi. Protagonista, personaggio principale, figura centrale nello stesso paragrafo. Scegline uno e ripetilo.
12. Intervalli finti. "da X a Y" dove X e Y non stanno su una scala sensata. Elenca i temi direttamente.

### Stile

13. Abuso di lineette. Evita del tutto le lineette (—). Punto o virgola; niente parentesi al loro posto, sarebbe scambiare un tic con un altro. Se un pensiero ha bisogno di stacco, chiudi la frase.
14. Abuso di due punti. Vanno bene prima di un elenco o un esempio, non come connettore a metà frase. Riscrivi perché il punto stia in piedi da solo.
15. Elenchi con etichetta. Il tic è l'etichetta in grassetto col due punti che ripete la riga: "Prestazioni: le prestazioni migliorano...". Trasforma in prosa. Un attacco in grassetto che finisce col punto, nomina la cosa ed è seguito da dettaglio davvero nuovo va bene, non è un tic.
16. Maiuscole A Ogni Parola nei titoli. In italiano quasi non esiste; controlla soprattutto quando traduci dall'inglese.
17. Emoji decorative. Via da titoli ed elenchi.

### Artefatti da chatbot

18. Frasi da assistente. "Spero sia utile!", "Fammi sapere se...", "Certamente!", "Ecco la pistola fumante!". Rimuovi.
19. Disclaimer da taglio dati. "Anche se i dettagli disponibili sono limitati..." Trova le fonti o rimuovi.
20. Tono adulatorio. "Ottima domanda! Hai perfettamente ragione!" Rispondi e basta.

### Riempitivo

21. Frasi riempitivo. "al fine di" → "per"; "a causa del fatto che" → "perché"; "è importante notare che" → si cancella.
22. Cautela eccessiva. "si potrebbe forse sostenere che potrebbe" → "può".
23. Conclusioni generiche. "Il futuro è promettente." Piani o fatti specifici.

### Gergo

24. Metafore astratte. "Leva", "paradigma", "ecosistema" (fuori dalla biologia), "asset", "driver", "volano", "stella polare", "cornice", "perimetro" (per dire "cosa fa"), "verticale" (come sostantivo), "attenzionare". Suonano tecniche ma quasi sempre esiste la parola concreta: "leva" → "strumento", "driver" → "causa", "volano" → il meccanismo vero, per nome. Vale anche per gli anglicismi tenuti in inglese per suonare tecnici: "surface", "harness", "north star", "endgame".

### Parlare chiaro

25. Di' cosa fa, non che effetto fa. "il database resta a portata di mano", "SQL che si legge" nominano una sensazione. La correzione nomina il meccanismo o un numero: "rinominare una colonna fa fallire la build". Chiediti cosa la frase dice al lettore di fare o sapere, e scrivi quello. Se non riesci a ridirla come istruzione, fatto o numero, tagliala. Controllo in più: se la frase potrebbe stare identica nella documentazione di un altro progetto, di questo non dice niente. Tagliala.
26. Accorcia o spezza le frasi dense. Se il lettore deve tornare indietro per capire, spezza in due o togli subordinate. Un'idea per frase.
27. Voce attiva. Cattura "viene/è + participio" e nomina chi agisce: "le query vengono validate" → "il compilatore valida le query". Il passivo va bene solo se chi agisce è ignoto o davvero non conta.
28. Taglia gli avverbi, o usa un verbo più forte. "migliora significativamente" → il numero misurato. Un avverbio che puntella un verbo debole significa che il verbo è sbagliato.
29. Preferisci la parola semplice. "utilizzare" → "usare", "effettuare" → "fare", "recarsi" → "andare", "molteplici" → "molti", "in caso di" → "se". Il sinonimo elegante raramente è più chiaro.
