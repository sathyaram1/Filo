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

1. Due comandi, ognuno da solo nella sua chiamata, così come sono scritti:

   ```bash
   git fetch origin main
   git rebase origin/main
   ```

   In ogni conflitto tieni **tutte e due le intenzioni**: quella del lavoro e
   quella arrivata su `main`. Per capire la seconda leggi il commit di `main`
   che ha toccato quel punto, non indovinarla. Risolto un file, `git add
   <file>`; risolti tutti, `git rebase --continue`. Il push forzato non tocca a
   te: lo fa il salvataggio automatico.

   Niente `&&`, niente `cd … &&` davanti, niente `git -C`: un comando
   composto o scritto in un'altra forma il controllo dei permessi lo giudica
   da capo. Se ti ferma, è un guasto (gruppo `guasto: permessi git`): niente
   `git merge` né altre strade al posto del rebase.
2. Non migliorare, non ritoccare, non aggiungere: ogni riga cambiata oltre il
   conflitto è codice che nessuno ha verificato.
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

<!-- includi: _guasto-in-attesa.md -->

## Consegna

```bash
node scripts/dispatch.mjs --record-fixed <id> "[report]" [--frase "[la frase]"] [--domanda <file.json>]
```

Frase e riga di changelog del primo passaggio restano valide: cambiale solo se
è cambiato qualcosa di visibile. Infine rilascia il biglietto:

```bash
node scripts/routine-channel.mjs release <biglietto> --role resolver
```
