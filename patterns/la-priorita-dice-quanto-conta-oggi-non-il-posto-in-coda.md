# La priorità dice quanto una cosa conta oggi, non il posto in coda

[← Tutti i pattern](../PATTERNS.md)

Decisione dell'owner del 31/10/2026 (SPEC-MANUTENTORE.md § 2), che sostituisce la
scala del 03/09. Quella aveva quattro livelli assegnati da un giudice feedback per
feedback (3 sicurezza, 2 cammino principale, 1 cosmetica, 0 raro) e i tetti del
pacemaker per livello (6 lavori a 3 insieme, 4 a 2): con centinaia di 2 in coda
la 2 non distingueva più niente, e un giudice che guarda un feedback alla volta
non può sapere quali siano i più importanti fra tutti.

| | cosa | chi la mette | come si lavora |
|---|---|---|---|
| **3** | urgentissimo: sicurezza, dati dell'utente, Filo inutilizzabile, una funzione che l'owner vuole subito | owner, giudici, manutentore (crearne sì, toglierne mai) | parte subito, sempre in parallelo, fuori da ogni ordine |
| **2** | importante: la classe che passa per prima | manutentore, owner | parte quando è nell'ordine |
| **1** | da fare | giudici (il valore che lasciano), rilievi delle verifiche, manutentore, owner | parte quando è nell'ordine |
| **0** | rimandato a lungo: difetti minori che oggi non valgono lo sforzo | manutentore, owner | parte quando è nell'ordine, di rado |

- **Il posto lo dà l'ordine (#2269, 07/11).** Dal 31/10 al 07/11 la 2 era «la
  rosa del giorno», scelta a parte dall'ordine: la stessa scelta scritta tre volte
  (classe nel taccuino, priorità 2, ordine), e un primo lavoro a 1 nell'ordine
  restava chiuso fino all'ultimo giorno prima del rinnovo. La rosa finiva a metà
  giornata e i posti restavano vuoti. Ora l'ordine è l'unica condizione per
  cominciare: dentro parte qualunque 0-2, fuori solo una 3; la priorità resta come
  classe, primo criterio per scegliere l'ordine, e conta da sola solo nel ripiego
  per urgenza (ordine vuoto o senza lavori pronti). Il manutentore tiene
  nell'ordine almeno 2×N lavori pronti a ogni accensione.
- **I rilievi delle verifiche nascono a 1**, salvo un esterno di livello 3 che
  nasce a 3 (`src/shared/verifierRound.js`): li mette in lavoro l'ordine.

- **I giudici assegnano 3 o lasciano 1.** Il giudice di priorità gira sul server
  (`functions/src/priority/judge.js` di filo-security; l'app ne sceglie solo il
  modello, slot `judge-priority`): critico → 3, tutto il resto → 1, qualunque
  numero dica il modello. Una priorità scritta dal manutentore non la riscrive
  a un rientro in coda.
- **Niente tetti per priorità.** Le 3 partono sempre; il resto fino al
  parallelismo N del manutentore, sotto il freno d'emergenza dell'owner (il
  massimo di sessioni insieme, Gestione → Automazioni, predefinito 20).
- **La soglia si muove.** Con più account o un modello piccolo all'altezza molti
  0 diventano 1 e molti 1 diventano 2: lo decide il manutentore e lo scrive nel
  taccuino.
- **La transizione.** Le 2 di prima scendono a 1 in un colpo (operazione
  `transizione` di `ownerManutentore`, a secco se non si dice `applica`).

Dove si applica: `FEEDBACK-STATES.md` § 3b, `routines/roles/manutentore.md`.
