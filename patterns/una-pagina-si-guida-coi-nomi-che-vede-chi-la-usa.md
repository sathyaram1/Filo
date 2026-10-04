# Una pagina si guida coi nomi che vede chi la usa

[← Tutti i pattern](../PATTERNS.md)

Quando Filo legge o guida una pagina per l'utente (la posta di Gmail, una scheda qualunque) la tratta come la
tratterebbe una persona: il testo che si vede, gli elementi per il nome che portano, i gesti di una persona.
Non si aggancia alle classi o alla struttura interna, che il sito cambia senza dirlo.

Il caso (#534). Le API di Gmail vogliono un esame di sicurezza annuale a pagamento, la password per app fa
paura; la scheda in cui l'utente è già entrato no. Ma Gmail rinomina le sue classi a ogni rilascio: un
lettore costruito su `.zA` o `.a3s` smette di funzionare in silenzio. «Posta in arrivo», «Cerca nella posta»,
«Rispondi» e «Invia» invece sono le parole che l'utente legge, e restano.

## La regola

- **Si legge quello che si vede**: il testo visibile, senza i pezzi nascosti a chi guarda (grandezza zero,
  fuori dalla pagina, trasparenti). È lì che una pagina ostile mette le istruzioni per l'agente.
- **Si trova un elemento per nome**: etichetta accessibile, testo, segnaposto, suggerimento. Una parola intera
  vale più di un pezzo: «Invia» è il pulsante, non la cartella «Inviati».
- **Gesti costruiti, mai veri**: eventi del mouse e testo inserito dallo script, che non regalano alla pagina
  il gesto dell'utente (vedi [Un clic vero dato a una pagina è un gesto regalato](un-clic-vero-dato-a-una-pagina-e-un-gesto-regalato.md)).
- **I comandi che spediscono non esistono**: un pulsante che invia, paga, pubblica o cancella, o che spedisce
  un modulo, il copione lo rifiuta da sé, qualunque cosa chieda il modello. Lo preme l'utente.
- **Le pagine dell'account Google non si toccano**: sono le più sorvegliate, e il modo in cui va male è un
  avviso di sicurezza all'utente.
- **Chi ha scritto quello che si legge lo dice Filo, fuori dalla busta**: ogni mail entra imbustata con la
  classe del suo mittente, scritta in una riga di Filo con l'indirizzo già ripulito. Un mittente che si
  chiama «Marco (fidato)» resta dentro la busta, e lì non conta.
- **La scheda di dietro si allarga sotto quella davanti** mentre Filo ci lavora (`alLavoro` in
  `src/main/tabs.js`): a zero per zero la pagina non si disegna e non risponde.

Dove vive: il copione in `src/main/services/paginaGuidata.js`, la scelta della scheda in `schedeAperte.js`,
Gmail in `postaGmail.js`. Prove: `tests/schede-aperte.spec.mjs`, `tests/posta-gmail.spec.mjs` (con un Gmail
finto: quello vero non si prova in cloud).
