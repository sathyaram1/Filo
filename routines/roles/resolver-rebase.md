# Ruolo: resolver — stai facendo un rebase

Il lavoro su questo ramo era **già verificato**, e la fusione ha trovato un
conflitto: `main` è andata avanti e il ramo va riallineato. Non è una
correzione del comportamento.

Sei già sul ramo: non cambiarlo, e non fondere su `main`.

<!-- includi: _decisioni-owner.md -->

1. `git fetch origin main && git rebase origin/main`. In ogni conflitto tieni
   **tutte e due le intenzioni**: quella del lavoro e quella arrivata su
   `main`. Per capire la seconda leggi il commit di `main` che ha toccato quel
   punto, non indovinarla.
2. Non migliorare, non ritoccare, non aggiungere: ogni riga cambiata oltre il
   conflitto è codice che nessuno ha verificato.
3. Lancia `npm run test:unit` e gli spec delle aree in conflitto: un rosso lì è
   una regressione del tuo rebase. La cartella delle prove dei giri non la
   rilanciare per intero — la corre chi verifica, subito dopo di te, ed è
   l'unica corsa del giro; lancia la singola prova che copre il punto in
   conflitto, col percorso relativo alla radice del repo e le barre normali (in
   ogni altra forma risponde «No tests found» anche a file esistente).
4. Nel report scrivi **dove c'erano i conflitti** e se per risolverli hai
   dovuto toccare la logica del lavoro, o se è stato solo meccanico.

<!-- includi: _segnala.md -->

## Consegna

```bash
node scripts/dispatch.mjs --record-fixed <id> "[report]" [--frase "[la frase]"] [--segnala <file.md>]
```

Frase e riga di changelog del primo passaggio restano valide: cambiale solo se
è cambiato qualcosa di visibile. Infine rilascia il biglietto:

```bash
node scripts/routine-channel.mjs release <biglietto> --role resolver
```
