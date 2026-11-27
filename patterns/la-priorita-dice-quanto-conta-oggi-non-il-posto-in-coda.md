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
| **3** | urgentissimo: sicurezza attaccabile oggi (non un irrobustimento), dati dell'utente, Filo inutilizzabile, una funzione che l'owner vuole subito | owner, giudici, manutentore (crearne sì, toglierne mai) | parte subito, sempre in parallelo, fuori da ogni ordine |
| **2** | importante | manutentore, owner | come la 1; senza un ordine pronto la coda per urgenza la dà anche a basse chiuse |
| **1** | da fare | giudici (il valore che lasciano), manutentore, owner | parte quando il manutentore la mette nell'ordine |
| **0** | rimandato a lungo: difetti minori che oggi non valgono lo sforzo | manutentore, owner | non entra nell'ordine |

- **A cominciare lo decide l'ordine, non la priorità** (#2269, al posto della rosa
  delle 2 del 31/10, che faceva scrivere la stessa scelta tre volte). Dentro
  l'ordine un primo lavoro parte a qualunque priorità da 0 a 2, fuori solo una 3;
  un ordine vuoto o senza lavori pronti vale come nessun ordine, e solo in quella
  coda per urgenza le 0 e le 1 restano chiuse fino all'ultimo giorno prima del
  rinnovo. Un rilievo interno messo da parte nasce a 1, a ogni livello.
- **I giudici assegnano 3 o lasciano 1, con una 2 sola.** Il giudice di priorità gira sul server
  (`functions/src/priority/judge.js` di filo-security; l'app ne sceglie solo il
  modello, slot `judge-priority`): critico, o sicurezza con un rischio reale
  oggi → 3, tutto il resto → 1, qualunque numero dica il modello. La soglia di
  realismo per la sicurezza vive solo nel prompt di quel giudice (#2332). La
  lacuna di copertura di un filtro già presente (una lingua, una grafia, una
  forma della frase in più) non è mai 3: 2 se il dato privato arriva ai
  modelli, se no 1; il buco (il filtro non parte su un cammino, o la forma
  che sfugge la sceglie un attaccante e l'attacco riesce oggi) resta 3
  (#2700: quaranta 3 di una famiglia avevano riempito le urgenze). Decide chi
  sceglie la forma, non «provato oggi»: il dato dell'utente scritto in un modo
  che il filtro non conosce resta lacuna anche quando succede (#2700.1). Un
  feedback nato da una routine (residuo, rilievo esterno, segnalazione di un
  worker, pacchetto) esce dal giudice al più a 2, scritto nel codice: la 3 la
  dà l'owner a mano, o il giudice a una segnalazione di un utente (#2710). Una
  priorità scritta dal manutentore non la riscrive a un rientro in coda.
- **Niente tetti per priorità.** Le 3 partono sempre; il resto fino al
  parallelismo N del manutentore, sotto il freno d'emergenza dell'owner (il
  massimo di sessioni insieme, Gestione → Automazioni, predefinito 20).
- **La soglia si muove.** Con più account o un modello piccolo all'altezza molti
  0 diventano 1 e molti 1 diventano 2: lo decide il manutentore e lo scrive nel
  taccuino.
- **La transizione.** Le 2 di prima scendono a 1 in un colpo (operazione
  `transizione` di `ownerManutentore`, a secco se non si dice `applica`).

Dove si applica: `FEEDBACK-STATES.md` § 3b, `routines/roles/manutentore.md`.
