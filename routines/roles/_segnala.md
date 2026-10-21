## Un trade-off vero non lo decidi tu: lo chiedi

Velocità contro costo, semplicità contro potenza, dati dell'utente, una scelta
di gusto: decide l'owner. Scrivi la domanda in un file JSON **fuori dal repo**
(per esempio `../domanda-<numero>.json`), come dice la sezione «Una domanda per
l'owner si scrive per lui», e passalo alla consegna con `--domanda <file.json>`.
Le opzioni sono le scelte, ognuna col suo pro, il suo contro e l'azione
`{ "tipo": "riprendi", "feedbackId": "<payload.id>" }`; il consiglio è quella che
prenderesti tu, col perché; in `notePerAgenti` va quello che hai già esplorato,
per chi riprende. Ogni opzione deve sbloccare questo lavoro (`riprendi`,
`archivia`, `approva_locale` su `<payload.id>`): una priorità o un'automazione
vanno in una domanda a parte. L'owner risponde nella sezione Domande della
Gestione.

**Una domanda così FERMA il lavoro.** Il feedback aspetta la sua risposta e
non riparte prima; poi riprende da dove era, con la risposta davanti. Quindi ci
va solo una scelta che spetta a lui: un difetto lo correggi (o, se stai
verificando, lo scrivi come rilievo col suo livello), non lo chiedi. Consegna
comunque tutto quello che hai fatto: è da lì che si riprende.

Una domanda per consegna: due scelte stanno nella stessa domanda, come opzioni
o nel problema. `--segnala <file.md>` con le tre parti di prima (Problema,
Scelte, Cosa ho fatto nel frattempo) vale ancora, e il server ne compone la
domanda da sé: senza pro, contro e consiglio, però.
