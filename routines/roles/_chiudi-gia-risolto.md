Si chiude così, e poi si rilascia il biglietto:

```bash
node scripts/routine-channel.mjs deliver status --status done --reason gia_risolto --fusione <sha> \
  --notes "[cosa hai controllato, e dove]" --frase "[cosa trova adesso chi ha segnalato]"
```

Un doppione aggiunge `--doppione-di <numero dell'originale>`, con la fusione dell'originale: il server vuole che sia
sua (lo cita, o è quella del suo ramo), che l'originale sia chiuso e che la fusione venga dopo l'ultima riapertura
di tutti e due. Il server ricontrolla la fusione e il ramo, nell'app e sul server: se rifiuta (exit 4), lavora il
feedback come sempre e scrivi il motivo del rifiuto nel report. Se il rifiuto di un doppione nomina come buona la
fusione registrata alla chiusura dell'originale, riconsegna una volta con quella.
