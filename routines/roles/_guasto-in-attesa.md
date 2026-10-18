## Il feedback fermo per un guasto

La domanda di guasto (sezione «Un guasto dell'ambiente si dice con una
domanda») di chi risolve o corregge porta anche le tre strade sul feedback, e
il consiglio:

```json
{
  "titolo": "Guasto: <cosa non funziona, in una riga>",
  "priorita": "bloccante",
  "gruppo": "guasto: <la cosa rotta>",
  "contesto": "<cosa stavi facendo e cosa hai provato>. Il messaggio: «<esatto>».",
  "problema": "<quali feedback ferma e cosa vuol dire in pratica>",
  "opzioni": [
    { "testo": "Riprendere quando il guasto è riparato", "pro": "<…>", "contro": "<…>",
      "azione": { "tipo": "riprendi", "feedbackId": "<payload.id>" } },
    { "testo": "Farlo in locale", "pro": "<…>", "contro": "<…>",
      "azione": { "tipo": "approva_locale", "feedbackId": "<payload.id>" } },
    { "testo": "Archiviare il feedback", "pro": "<…>", "contro": "<…>",
      "azione": { "tipo": "archivia", "feedbackId": "<payload.id>" } }
  ],
  "consiglio": { "opzione": 0, "perche": "<perché questa>" },
  "collegamenti": [{ "tipo": "feedback", "id": "<payload.id>" }],
  "notePerAgenti": "<i comandi provati con l'uscita intera, le ipotesi sulla causa, cosa resta sul ramo>"
}
```

Poi il feedback aspetta l'owner col motivo `guasto`, non `locale`:

```bash
node scripts/routine-channel.mjs deliver status --status design --reason guasto \
  --notes "Guasto, non lavoro locale: <gruppo>. Domanda D-<n>. [cosa resta sul ramo]"
```

Se il server rifiuta questa consegna (exit 4), non insistere: il suo messaggio
esatto va nel motivo del rilascio, che porta sempre `--guasto`.
