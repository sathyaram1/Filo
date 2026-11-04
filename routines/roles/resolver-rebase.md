# Ruolo: resolver — stai facendo un rebase

Il lavoro su questo ramo era **già verificato**, e la fusione si è fermata:
`main` è andata avanti e il ramo va riallineato. Non è una correzione del
comportamento. Il perché lo dice il server in `payload.critique`: un
conflitto, oppure gli **unit rossi sul risultato della fusione**, con
l'elenco dei test rotti.

Sei già sul ramo: non cambiarlo, e non fondere su `main`.

**Unit rossi sulla fusione.** Il rebase può andare liscio: i due lavori non si
toccano nelle righe, si rompono insieme. Tu fai solo il rebase: quei test non
li correggi, anche se la critica sembra chiederlo. Correggerli vuol dire
cambiare la logica, e una logica cambiata la giudica la verifica: chi verifica
dopo di te rilancia gli unit, e ogni rosso diventa un suo rilievo. Nel report
scrivi l'elenco dei test rossi dopo il rebase.

<!-- includi: _decisioni-owner.md -->

<!-- includi: _immagini.md -->

<!-- includi: _cornice-feedback.md -->

1. Due comandi, ognuno da solo nella sua chiamata:

   ```bash
   git fetch origin main
   git rebase origin/main
   ```

   In ogni conflitto tieni **tutte e due le intenzioni**: quella del lavoro e
   quella arrivata su `main`. Per capire la seconda leggi il commit di `main`
   che ha toccato quel punto, non indovinarla. Risolto un file, `git add
   <file>`; risolti tutti, `git rebase --continue`. Il push forzato non tocca a
   te: lo fa la consegna, che registra il riallineamento solo se su origin il
   ramo è alla tua punta e contiene `main`. Se rifiuta, ti dice perché e cosa
   fare.

   Davanti va solo il `cd` nel tuo clone, se la sezione «La tua cartella» lo
   chiede. Nessun'altra forma: i due comandi non si legano fra loro e non
   diventano `git -C`, perché un comando scritto diverso il controllo dei
   permessi lo giudica da capo. Se ti ferma, è un guasto (gruppo `guasto:
   permessi git`): niente `git merge` né altre strade al posto del rebase.

   Finito il rebase, le righe di novità che il lavoro aveva scritto sotto una
   versione uscita intanto si riportano nel blocco della prossima versione.
   È un gesto meccanico, e lo fa lo strumento, che committa da sé:

   ```bash
   node scripts/novita-in-cima.mjs --commit
   ```

   La consegna lo rifà prima di spedire il ramo: se lo salti non succede
   niente di male, ma gli unit del passo 3 ti darebbero un rosso che non c'è.
   Se lo strumento dice che non riesce, il motivo va nel report.
2. Non migliorare, non ritoccare, non aggiungere: ogni riga cambiata oltre il
   conflitto è codice che nessuno ha verificato. Le novità spostate dallo
   strumento non contano: non cambiano niente oltre al blocco in cui stanno.
3. Lancia `npm run test:unit` e gli spec delle aree in conflitto. Un rosso nato
   da come hai risolto un conflitto lo sistemi lì, nelle righe del conflitto;
   ogni altro rosso, compresi quelli elencati dal server, resta com'è e va nel
   report. La cartella delle prove dei giri non la
   rilanciare per intero — la corre chi verifica, subito dopo di te, ed è
   l'unica corsa del giro; lancia la singola prova che copre il punto in
   conflitto, col percorso relativo alla radice del repo e le barre normali (in
   ogni altra forma risponde «No tests found» anche a file esistente).
4. Nel report scrivi **dove c'erano i conflitti**, se per risolverli hai
   dovuto toccare la logica del lavoro o se è stato solo meccanico, e
   **l'elenco degli unit rossi dopo il rebase** (o che sono tutti verdi): chi
   verifica lo riceve insieme al resto del report.

<!-- includi: _segnala.md -->

<!-- includi: _solo-in-locale.md -->

## Consegna

<!-- includi: _motivo-correttore.md -->

```bash
node scripts/dispatch.mjs --record-fixed <id> "[report]" --motivo "[il motivo]" [--frase "[la frase]"] [--domanda <file.json>]
```

Frase e riga di changelog del primo passaggio restano valide: cambiale solo se
è cambiato qualcosa di visibile. Infine rilascia il biglietto:

```bash
node scripts/routine-channel.mjs release <biglietto> --role resolver
```
