## Un trade-off vero non lo decidi tu: lo chiedi

Velocità contro costo, semplicità contro potenza, dati dell'utente, una scelta
di gusto: decide l'owner. Scrivi la domanda in un file JSON **fuori dal repo**
(per esempio `../domanda-<numero>.json`), coi campi e le regole della sezione
«Una domanda per l'owner si scrive per lui» (titolo e priorità compresi), e
passalo alla consegna con `--domanda <file.json>`. Le opzioni sono le scelte,
ognuna col suo pro, il suo contro e l'azione
`{ "tipo": "riprendi", "feedbackId": "<payload.id>" }`; il consiglio è quella che
prenderesti tu, col perché; in `notePerAgenti` va quello che hai già esplorato,
per chi riprende. Ogni opzione deve sbloccare questo lavoro (`riprendi` o
`archivia` su `<payload.id>`): una priorità o un'automazione vanno in una
domanda a parte, e un lavoro che serve sul server lo passi tu ai lavori server
(«Se il lavoro si fa solo in locale»). L'owner risponde nella sezione Domande
della Gestione.

**Una domanda che blocca FERMA il lavoro** (senza `blocca` blocca; la regola
per sceglierlo sta in «Una domanda per l'owner si scrive per lui»). Il feedback
aspetta la sua risposta e non riparte prima; poi riprende da dove era, con la
risposta davanti. Con `"blocca": false` la consegna va avanti col suo esito:
il lavoro fatto è quello della consigliata, e chi viene dopo trova la domanda
in `payload.provvisorie`. In ogni caso ci va solo una scelta che spetta a lui:
un difetto lo correggi (o, se stai verificando, lo scrivi come rilievo col suo
livello), non lo chiedi. Consegna comunque tutto quello che hai fatto: è da lì
che si riprende.

Una domanda per consegna: due scelte stanno nella stessa domanda, come opzioni
o nel problema (chi verifica ne scrive una per ogni rilievo col `?`). Il server
non compone domande: una fermata senza la tua domanda in JSON si rifiuta, e la
segnalazione in markdown (`--segnala`) non c'è più.
