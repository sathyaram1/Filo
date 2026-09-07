# Una lista remota che SOSTITUISCE quella del codice deve dire cosa sta scoprendo

[← Tutti i pattern](../PATTERNS.md)

Il doc `config/models` riscrive per intero certe liste che nel codice hanno un
valore di partenza: quella dei fornitori esclusi (#421) è la prima. La
sostituzione è voluta, l'owner deve poterla svuotare o riscrivere. Il prezzo è
che una voce aggiunta al codice con un rilascio non arriva dove la lista remota
esiste già, e non lo dice nessuno: la lista sembra a posto e il fornitore che
credevi escluso continua a servire le richieste (#518, un host che rispondeva
con la risposta di un'altra richiesta).

- **La pagina che modifica la lista mostra la deriva.** Carica la lista
  EFFETTIVA (codice ⊕ remoto), la confronta con quella del codice
  (`missingExcludedProviders` in `constants.js`) e nomina le voci scoperte, con
  il bottone che le rimette. Un avviso senza il modo di rimediare è solo una
  brutta notizia.
- **Il salvataggio scrive la lista solo se l'owner l'ha toccata.** Scriverla a
  ogni salvataggio congela nel doc remoto una copia della lista di build, e da
  quel momento ogni esclusione aggiunta col codice resta fuori per sempre.
- **Un array vuoto è un valore, non "non toccare".** Svuotare la lista deve
  poter viaggiare: il confronto è con la lista caricata, non con la lista vuota.
- **Test:** `tests/unit/providerPolicy.test.mjs` (il confronto, puro),
  `tests/admin-defaults-editor.spec.mjs` (l'avviso, il bottone che rimette, il
  salvataggio che non congela).
