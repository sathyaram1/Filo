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
    { "testo": "Affidare la riparazione a un agente", "pro": "<cosa può riparare un agente col repo>", "contro": "<…>",
      "azione": { "tipo": "compito" } },
    { "testo": "Archiviare il feedback", "pro": "<…>", "contro": "<…>",
      "azione": { "tipo": "archivia", "feedbackId": "<payload.id>" } }
  ],
  "consiglio": { "opzione": 0, "perche": "<perché questa>" },
  "collegamenti": [{ "tipo": "feedback", "id": "<payload.id>" }],
  "notePerAgenti": "<il messaggio esatto, i comandi provati con l'uscita intera, le ipotesi sulla causa, cosa resta sul ramo>"
}
```

Le tre strade sono un modello: tieni quelle che per questo guasto hanno un
pro vero. La riparazione (azione `compito`, SPEC-DOMANDE § 3.3: la domanda passa
a un agente col repo) si toglie quando la causa sta fuori dal repo, come una
credenziale o un'impostazione dell'owner. `consiglio.opzione` è l'indice di
quella che sceglieresti.

Sul PC dell'owner non lavora nessuno: farlo «in locale» non è una strada da offrire. Poi il feedback aspetta
l'owner col motivo `guasto`, non `locale`:

```bash
node scripts/routine-channel.mjs deliver status --status design --reason guasto \
  --notes "Guasto, non per regola: <gruppo>. Domanda D-<n>. [cosa resta sul ramo]"
```

Se il server rifiuta questa consegna (exit 4), non insistere: il suo messaggio
esatto va nel motivo del rilascio, che porta sempre `--guasto`.
