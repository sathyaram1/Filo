## Il feedback fermo per un guasto

La domanda di guasto (sezione «Un guasto dell'ambiente si dice con una
domanda») di chi risolve o corregge porta anche le strade sul feedback, e il
consiglio. Si scrive come dice la sezione «Una domanda per l'owner si scrive
per lui»:

```json
{
  "titolo": "Guasto: <cosa non funziona, in una riga>",
  "priorita": "bloccante",
  "gruppo": "guasto: <la cosa rotta>",
  "contesto": "<cosa stavi facendo, cosa hai provato e cosa vuol dire l'errore, in parole tue>",
  "problema": "<quali feedback ferma e cosa vuol dire in pratica>. <cosa deve fare l'owner>",
  "opzioni": [
    { "testo": "Riprendere quando il guasto è riparato", "pro": "<…>", "contro": "<…>",
      "azione": { "tipo": "riprendi", "feedbackId": "<payload.id>" } },
    { "testo": "Archiviare il feedback", "pro": "<…>", "contro": "<…>",
      "azione": { "tipo": "archivia", "feedbackId": "<payload.id>" } }
  ],
  "consiglio": { "opzione": 0, "perche": "<perché questa>" },
  "collegamenti": [{ "tipo": "feedback", "id": "<payload.id>" }],
  "notePerAgenti": "<il messaggio esatto, i comandi provati con l'uscita intera, le ipotesi sulla causa, cosa resta sul ramo>"
}
```

Le strade sono un modello: tieni quelle che per questo guasto hanno un pro
vero, e ognuna sblocca questo lavoro (`riprendi` o `archivia` su
`payload.id`). Una riparazione che un agente col repo può fare la proponi in
una domanda a parte (`domanda.mjs chiedi`, azione `compito`, senza `blocca`).
`consiglio.opzione` è l'indice di quella che sceglieresti.

Sul PC dell'owner non lavora nessuno: farlo «in locale» non è una strada da
offrire. La domanda va con la consegna, non con `domanda.mjs chiedi`: il server
la apre nella stessa scrittura della fermata, col motivo `guasto` e non
`locale`, e il feedback aspetta In coda col segno «aspetta D-<n>»; senza
`--domanda` la consegna è rifiutata. Il numero lo stampa la risposta:

```bash
node scripts/routine-channel.mjs deliver status --status design --reason guasto \
  --notes "Guasto, non per regola: <gruppo>. [cosa resta sul ramo]" --domanda <file.json>
```

Se il server rifiuta questa consegna (exit 4), non insistere: il suo messaggio
esatto va nel motivo del rilascio, che porta sempre `--guasto`.
