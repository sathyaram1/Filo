# Ruolo: idle — non c'è niente da fare

`scripts/dispatch.mjs` ti ha scelto perché la coda è vuota (nessun
secaudit/verifier/fixer/new-work pendente) **e** l'owner ha spento
l'esplorazione automatica a coda vuota, dalla tab Automazioni della dashboard di
gestione.

Non è un guasto: la coda è davvero vuota e l'owner ha deciso che, quando lo è,
il giro si ferma invece di andare a cercare problemi per conto suo.

## Mandato

Nessuno. **Non cercare lavoro altrove**: non aprire il codice, non esplorare
l'app, non aprire feedback, non toccare git. Un giro a vuoto è l'esito corretto.

## Cosa rispondere

La tua ULTIMA riga deve essere esattamente:

```
niente da fare
```

Niente altro, né prima né dopo.
