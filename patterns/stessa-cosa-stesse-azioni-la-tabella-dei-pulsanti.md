# Stessa cosa, stesse AZIONI: la tabella dei pulsanti sta nel modulo

[← Tutti i pattern](../PATTERNS.md)

Mettere lo stesso elemento nella stessa sezione non basta. Sulla STESSA
segnalazione le due pagine offrivano pulsanti diversi, perché ognuna se li
costruiva a mano dai propri `if`: negli Archiviati la pagina dei feedback
diceva «↩ Ripristina», la dashboard di gestione «Archivia». Non era un doppione
innocuo — su un attacco confermato quel clic scriveva `archived` SOPRA la
conferma: una decisione di sicurezza cancellata senza avviso, e da lì la
segnalazione era indistinguibile da una archiviata qualsiasi (#509, terzo giro).

- **Un'azione a due versi si mostra tutta, o non si mostra.** Se puoi
  archiviare devi poter togliere dall'archivio; se puoi aggiungere devi poter
  togliere. Il verso disponibile lo decide lo stato dell'elemento, non il posto
  dove il pulsante è stato scritto a mano.
- **La tabella delle azioni sta nel modulo condiviso, come quella delle
  sezioni.** `ownerActions(fb, opts)` ritorna l'elenco ordinato — chiave,
  etichetta, stato scritto, `kind` — derivandolo da sezione + status canonico.
  Le pagine ne disegnano il *modo* (pulsanti dentro la scheda di là, riga in un
  pannello fermo di qua), mai il *quale*. Un'azione nuova si aggiunge lì, e la
  gemella ce l'ha nello stesso commit.
- **Chiudere la porta nella tabella non basta: serve il guardiano sotto.**
  `ownerActionAllowsStatus(fb, to)` sta sul cammino di scrittura di tutt'e due
  le pagine: si scrive solo uno stato che la segnalazione offre *in questo
  momento*. Un pannello rimasto aperto mentre lo stato cambiava, o una lista non
  aggiornata, sono le porte che restano quando si sistemano solo i pulsanti.
- **Le decisioni terminali non si riscrivono di fianco.** Uno stato terminale
  (attacco/spam confermato) si lascia solo per le destinazioni che la macchina a
  stati dichiara — nella pratica il ritorno in coda, cioè "era legittimo". Non
  esiste un cammino che ci scriva sopra un altro stato "vicino".
- **La granularità torna anche nel DETTAGLIO, non solo nella lista.** La
  dashboard di gestione non scriveva da nessuna parte che una segnalazione era
  un attacco confermato, e nella conversazione leggevi ancora "Filo non ha
  ancora un parere". L'etichetta di stato (`MR.stateBadge`) e la bolla della
  decisione dell'owner sono le stesse parole della gemella.
- **Dove:** `ownerActions`, `ownerActionFor`, `ownerActionAllowsStatus`,
  `stateBadge`, `valueUnreadable` in `src/shared/manageReview.js`; consumate da
  `actionsFor()`/`patch()` in `src/pages/feedback/feedback.js` e da
  `renderActions()`/`applyAction()`/`renderDetailState()` in
  `src/pages/manage/manage.js`. Test:
  `tests/feedback-sezioni-gemelle.spec.mjs` (confronta gli elenchi di pulsanti
  delle due pagine, segnalazione per segnalazione) e
  `tests/unit/manageReview.test.mjs`.
