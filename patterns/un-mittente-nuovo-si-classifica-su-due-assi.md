# Un mittente nuovo si classifica su DUE assi: da dove viene, e quanto ci si fida

[← Tutti i pattern](../PATTERNS.md)

Quando nasce una provenienza nuova di feedback (un prefisso di `clientId`: l'agente
esploratore, i ruoli delle routine, i rilievi residui, la sessione locale di Claude),
ci sono **due domande diverse**, e dal §10 di SPEC-DOMANDE.md (#1162) le risponde chi
le deve rispondere, senza che una tocchi l'altra:

- **Chi l'ha scritto**: serve a LEGGERE la coda e a CONTARE. Due tabelle:
  - la **classe** del mittente (`mittenteClasse`, più `mittenteRuolo` per le routine), per le
    statistiche: la mappatura delle etichette sta in un posto solo, `src/shared/mittenti.js`,
    che il server incorpora (bake-shared) e stampa sul documento alla nascita;
  - la **categoria d'autore** per l'icona della coda (`authorKind` in
    `src/shared/feedbackThread.js` + `AUTHOR_META`/`AUTHOR_RANK` in `manage.js`), più fine:
    un ritrovamento nato esplorando, scrivendo codice o verificando si legge in contesti diversi.
- **Quanto ci si fida**: serve a DECIDERE (giudici alla nascita, automatica, verdetto,
  raffiche e segno, L5). La decide solo `fiducia`, che scrive il server. Il mittente non dà
  nessun permesso: l'unico punto in cui diventa fiducia è l'owner dall'app, alla nascita
  (`fiduciaDiNascita`). Gli interruttori dell'automatica sono due, `fidato` e `non_fidato`.

**Regola operativa:** una provenienza nuova si aggiunge a `mittenti.js` (con un caso nel
campione di `tests/unit/mittenti.test.mjs`) e, se serve un'icona sua, ad `authorKind`. Non
si aggiunge un interruttore né una regola di permesso: se un mittente nuovo deve entrare in
coda da solo, la strada è la fiducia (nasce da un biglietto pulito, o l'owner lo segna fidato).
Un ruolo nuovo delle routine va nell'elenco `RUOLI` di `mittenti.js`, o la statistica lo conta
come `ignoto` (la sentinella del server confronta i ruoli dei biglietti con l'elenco).

**L'eccezione già decisa:** chi nasce senza origine con la prova del server (l'allarme
della pubblicazione `agent:costruzione`, i ritrovamenti dell'esplorazione) va in coda
comunque (#1035): categoria d'autore sì, e nessun interruttore lo ferma.

**Perché:** finché il prefisso dava permessi, ogni provenienza nuova era anche una porta
nuova da ricordarsi di chiudere su due repo, e una routine dal biglietto sporco (che ha letto
testo di utenti) entrava in coda col lasciapassare del suo nome.

**Dove:** `src/shared/mittenti.js` (classi), `src/shared/feedbackThread.js` (categorie
d'autore e automatica per fiducia), `src/shared/feedbackStats.js` (statistiche per classe).
Sentinelle: `tests/unit/mittenti.test.mjs`, `tests/unit/autoApprove.test.mjs` e, in
filo-security, `functions/test/mittenti-solo-statistica.test.js` (il prefisso lo legge solo
`src/mittente.js`, e chi usa la classe sta in un elenco col suo perché).
