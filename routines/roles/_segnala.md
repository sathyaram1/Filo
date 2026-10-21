## Un trade-off vero non lo decidi tu: lo chiedi

Velocità contro costo, semplicità contro potenza, dati dell'utente, una scelta
di gusto: decide l'owner. Scrivi la domanda in un file JSON **fuori dal repo**
(per esempio `../domanda-<numero>.json`) e passalo alla consegna con
`--domanda <file.json>`: diventa una domanda fra le Domande di Gestione, e il
feedback aspetta In coda col segno che porta lì. Si scrive come dice la sezione
«Una domanda per l'owner si scrive per lui»:

```json
{
  "titolo": "<una riga: cosa si decide>",
  "priorita": "importante",
  "contesto": "<quanto basta per decidere senza aprire altro>",
  "problema": "<cosa succede in pratica, e cosa deve scegliere lui>",
  "opzioni": [
    { "testo": "<la prima strada>", "pro": "<…>", "contro": "<…>",
      "azione": { "tipo": "riprendi", "feedbackId": "<payload.id>" } },
    { "testo": "<la seconda strada>", "pro": "<…>", "contro": "<…>",
      "azione": { "tipo": "riprendi", "feedbackId": "<payload.id>" } }
  ],
  "consiglio": { "opzione": 0, "perche": "<la strada su cui hai già consegnato, e perché>" },
  "notePerAgenti": "<punti del codice, cause, strade scartate, cosa serve per applicare ciascuna opzione>"
}
```

Ogni strada che fa ripartire il lavoro ha l'azione `riprendi` sul feedback di
questo lavoro (`payload.id`): l'owner sceglie, e chi riprende trova la scelta
in `payload.decisioni`, con le tue note per gli agenti.

**Una domanda FERMA il lavoro.** Il feedback non riparte finché l'owner non ha
risposto; poi riprende da dove era, con la sua risposta davanti. Quindi ci va
solo una scelta che spetta a lui: un difetto lo correggi (o, se stai
verificando, lo scrivi come rilievo col suo livello), non lo chiedi. Consegna
comunque tutto quello che hai fatto: è da lì che si riprende.

Una domanda per consegna: se hai due scelte, stanno nella stessa con più
opzioni. `--segnala <file.md>` (Problema, Scelte, Cosa ho fatto nel frattempo)
è accettato ancora, ma la domanda la compone il server dal markdown, senza pro,
contro e note per chi riprende.
