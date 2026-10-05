# Chi guarda in continuo chiede cosa è cambiato, non tutto

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Una superficie che si tiene aggiornata da sola legge tutto UNA
volta, all'apertura, e poi chiede le sole righe scritte dopo l'ultimo giro, su
un campo che OGNI scrittura firma. Una domanda per data non vede le
cancellazioni né chi ha scritto senza firmare, quindi accanto ci sta una
riconciliazione completa RARA. Il giro è uno solo, nel processo che le pagine
hanno in comune, e gira solo quando una pagina in vista lo chiede.

## Il caso (#676)

La Gestione, tenuta aperta, chiedeva a Firestore i nomi dei 500 feedback più
recenti ogni sessanta secondi: cinquecento letture al minuto a database fermo
(Firestore conta per documento, non per campo). E la finestra dei 500 per data
lasciava fuori per sempre un feedback vecchio tornato nei Ricevuti.

## Cosa non ha funzionato

- **Abbassare il ritmo.** Toglie alla Gestione quello per cui esiste: guardare
  le routine mentre lavorano. Il problema era quanto si chiede, non ogni quanto.
- **Ordinare per `updateTime`.** Ce l'ha ogni documento, ma è metadato: una
  query non lo sa filtrare. L'ora la deve scrivere chi scrive, su TUTTI i
  cammini (app, script, server).
- **Indovinare dalla coda chi verrà preso.** Un campione dalla testa della coda
  costava una dozzina di letture a giro e sbagliava ogni volta che il server
  sceglieva con un ordine suo (#676.1).

## Come si fa

1. **Un campo firmato da ogni scrittura**, timestamp e mai testo (`updatedAt`;
   `touchUpdatedAt` in `src/shared/feedback.js`). I cammini che non passano da
   lì si contano a mano, una volta, per iscritto (anche negli script).
2. **All'apertura si legge tutto**, a pagine e coi soli campi della lista; se
   il freno sulle pagine scatta, la pagina lo dice («N+» e l'hover).
3. **La domanda incrementale.** Filtro `> ultimo visto` meno un margine per gli
   orologi scentrati, ordine (campo, nome), cursore oltre il tetto di pagina.
   «Ultimo visto» è l'ora del SERVER, e il margine si toglie anche a quella.
   Di una lettura a pagine vale l'ora della PRIMA pagina: le pagine dopo
   portano scritture più nuove di quelle che una pagina già passata non ha
   visto; l'ora dei documenti serve solo dove la lettura non ne ha una, e
   sempre col margine. Un giro a vuoto costa una lettura. Una riga riletta coi soli
   campi della lista li sostituisce tutti: un campo della lista che manca è
   stato tolto sul server, non si tiene quello vecchio.
4. **La riconciliazione rara** (mezz'ora): le versioni di tutto, confrontate in
   pagina. Una lettura interrotta non fa uscire nessuno.
5. **Un giro solo, e solo con qualcuno che guarda.** Vive nel main senza un
   orologio suo: lo chiede la pagina in vista, e la porta ricontrolla la vista.
   L'esito va anche alle altre pagine iscritte. Dal lato della pagina il giro è
   uno solo anche nel codice (`makeGiroPagina`): Gestione e pagina Feedback lo
   usano entrambe e leggono tutto all'apertura allo stesso modo (#738).
6. **I segni senza orologio coprono chi non firma**: l'ora di Firestore dei
   feedback in mano alle routine (una lettura ciascuno), il contatore degli
   invii CONTATO contro le righe arrivate, e il registro dei worker, che dice
   QUALE feedback è stato preso: quello si rilegge e si segue, il resto no.
7. **Un tetto non taglia in silenzio.** I seguiti si leggono a pezzi con un
   tetto largo; sopra, il giro lo dice e si riallinea. «Non letto» non vale
   «niente di nuovo»: un registro illeggibile tiene il valore di prima.

## Riferimenti

- `src/shared/feedbackLive.js` — `makeWatcher`, la decisione del giro, pura.
- `src/shared/feedback.js` — `listChangedSince`, `versionsOf`, `idDelNumero`,
  `submissionCount`, `touchUpdatedAt`.
- `src/main/services/handlers/auth.js` — il giro unico e le iscrizioni.
- `tests/unit/feedbackGiroCambiati.test.mjs`,
  `tests/unit/feedbackGiroSenzaOrologio.test.mjs`,
  `tests/manage-giro-cambiati.spec.mjs` — contano le letture e asseriscono che
  il cambiamento si VEDE entro il giro.
