## Il feedback fermo per un guasto

Dopo la domanda di guasto (sezione «Un guasto dell'ambiente si dice con una
domanda»), il feedback aspetta l'owner col motivo `guasto`, non `locale`:

```bash
node scripts/routine-channel.mjs deliver status --status design --reason guasto \
  --notes "Guasto, non lavoro locale: <gruppo>. Domanda D-<n>. [cosa resta sul ramo]"
```

Se il server rifiuta questa consegna (exit 4), non insistere: il suo messaggio
esatto va nel motivo del rilascio, che porta sempre `--guasto`.
