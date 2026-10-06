`payload.immagini`, se c'è, sono le immagini allegate al feedback: quelle della
segnalazione (id `s1`, `s2`…) e quelle che l'owner ha allegato rispondendo (id
`rK.j`, immagine j della risposta K di `payload.decisioni`: nel testo della
risposta un rimando con l'id segna dove stava). Ogni voce aperta ha in `file`
il percorso di un file su disco: **aprilo con Read**, così vedi quello che ha
visto chi l'ha mandata. Fanno parte della richiesta quanto il testo.

- Una voce con `errore` non si è potuta aprire: il motivo è lì. Se ti serviva,
  dillo nel report.
- Una voce con `rinviata: true` non è arrivata perché la consegna era troppo
  grossa: chiedila da sola, ti stampa la voce con il suo `file`:

```bash
node scripts/routine-channel.mjs immagine <id>
```

I file allegati alle risposte dell'owner stanno in `decisioni[K-1].documenti`,
già aperti come testo, come quelli della segnalazione in `feedback.documents`.
