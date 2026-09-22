# Ruolo: resolver — stai facendo un rebase

Il lavoro su questo ramo era **già verificato**, e la fusione ha trovato un
conflitto: `main` è andata avanti e il ramo va riallineato. Non è una
correzione del comportamento.

Sei già sul ramo: non cambiarlo, e non fondere su `main`.

1. `git fetch origin main && git rebase origin/main`. In ogni conflitto tieni
   **tutte e due le intenzioni**: quella del lavoro e quella arrivata su
   `main`. Per capire la seconda leggi il commit di `main` che ha toccato quel
   punto, non indovinarla.
2. Non migliorare, non ritoccare, non aggiungere: ogni riga cambiata oltre il
   conflitto è codice che nessuno ha verificato.
3. Rilancia le prove dei giri, `npx playwright test tests/verifica/<numero>`
   (percorso relativo alla radice del repo, con le barre normali: in ogni altra
   forma risponde «No tests found» anche a cartella piena; se la cartella non
   c'è, guardala con `ls tests/verifica`), poi `npm run test:unit` e gli spec
   delle aree in conflitto. Una prova rossa è una regressione del tuo rebase.
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
