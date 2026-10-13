# Le chat delle app entrano nel filo ripiegate

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Una chat con Filo che vive in un'app (Editor, Mazzi, Aiuto sopra un sito) scrive ogni messaggio
nel filo passando da un punto solo: `annota` in `src/main/services/conversazioniApp.js`, o il messaggio
`FILO_CONVERSAZIONE_APP` dalla pagina. Nel filo la conversazione è una chat con `app`, `rif` e `soggetto`; nella
home e al modello è **una riga** («4 messaggi nell'Editor su tesi»), e lo scambio si apre o si rilegge con
CERCA_CHAT e l'id. Una chat nuova lo eredita con una voce in `APP` di `src/shared/filoApp.js` e una chiamata.

## Perché (#974, D57 «dentro ripiegate»)

- Senza, la home non sapeva cosa l'utente aveva chiesto nell'Editor un'ora prima. Metterle dentro per intero
  avrebbe affollato il filo e fatto crescere il costo di ogni messaggio della home: al modello va la riga, all'ora
  in cui la conversazione è cominciata, e i ricordi non la ripescano (`tratti` la salta).
- Essere chat del filo le dà gratis quello che le chat hanno già: ricerca della Cronologia e di CERCA_CHAT,
  rilettura con l'id, cancellazione vera con le copie, export e import, incognito in memoria.

## Le scelte che reggono

- **Chi salva annota.** I Mazzi annotano nel magazzino della chat del mazzo (ogni strada che scrive una domanda o
  completa una risposta ci passa); Editor e Aiuto, che tengono la chat nella pagina, mandano il messaggio appena
  lo mostrano. Errori e risposte a metà non entrano.
- **Una riga per conversazione.** Lo stesso `rif` continua la stessa riga finché non passa un'ora di silenzio;
  l'Aiuto ne apre una a ogni apertura del pannello.
- **Dove sta la riga nella home** (`perLaHome`): dentro la conversazione della home in cui è nata, o in testa a
  quella che segue; a home vuota sotto il messaggio, quelle nate dopo l'ultima conversazione lì. Mai più vecchie
  dei giorni che la chat ha davanti.
- **Il sito lo dice il main.** Da una pagina web parla solo l'Aiuto, e soggetto, indirizzo e recinto del `rif` li
  prende dall'indirizzo di chi manda, non dal messaggio. Quello che Filo ha risposto in un'app porta `esterno`:
  riletto, è una lettura.
- **Cancellare in un'app cancella nel filo.** Chat del mazzo svuotata, mazzo eliminato, modulo della chat tolto,
  documento eliminato per sempre: `dimentica`. La riga si toglie anche da sé (tasto destro, Cronologia).
- **Non le chiude e non le classifica nessuno**: nome e tipo li hanno dalla nascita (`listDangling` e
  `listUntriaged` le saltano). Dalla home non si continuano: si guardano aperte, e si scrive in una chat nuova.

Prove: `tests/unit/filoApp.test.mjs`, `tests/chat-app-nel-filo.spec.mjs`.
