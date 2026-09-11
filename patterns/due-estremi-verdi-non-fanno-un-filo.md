# Due estremi verdi non fanno un filo

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Una difesa si prova dove ESCE, non dove parte. Se il test guarda
chi manda e un altro test guarda chi sa ricevere, il pezzo in mezzo non lo
guarda nessuno: e quello è il pezzo che si dimentica.

## Il caso

Nei percorsi condivisi dell'Aiuto (#584) l'ultima difesa è un modello che legge
il percorso prima che finisca in una raccolta pubblica e lo blocca se ci
riconosce una persona. Un nome scritto a lettere — «Profilo di Mario Rossi»
dentro l'etichetta di un pulsante — non lo prende nessuna espressione regolare:
o lo vede il modello, o esce.

Il lavoro dichiarava quella difesa in quattro punti: nel codice che raccoglie il
percorso, nel commento delle regole del database, nella pagina che spiega la
privacy agli utenti e nelle note di versione. E aveva due test verdi:

- chi raccoglie il percorso **manda** indirizzo ed elementi al modello — verde;
- il testo della domanda al modello **sa scriverli**, se glieli passi — verde.

In mezzo c'è il pezzo che compone la domanda, e lì i due campi non venivano
copiati. Al modello arrivava «(nessuna)» al posto dell'indirizzo e «(nessun
elemento)» al posto dei clic, e approvava alla cieca. Tre giri di verifica,
quattro dichiarazioni scritte e due test verdi non lo hanno visto, perché
nessuno aveva guardato il testo che parte davvero.

## Come si fa

- **Il test si attacca all'uscita.** Per un prompt: il testo vero che va al
  modello. Per una richiesta: il corpo vero che va in rete. Per un file: il
  contenuto vero sul disco. Non il pacchetto che qualcuno passa a qualcun altro
  a metà strada.
- **Se l'uscita sta in un altro processo, il test ci va lo stesso.** Qui il
  pezzo che compone la domanda vive nel processo principale di Filo: la guardia
  è una spec che apre Filo, sostituisce il fornitore del modello e legge i
  messaggi che sarebbero partiti (`tests/aiuto-percorso-giudice.spec.mjs`). Un
  unit test sui due estremi costava meno ed è esattamente quello che era già lì.
- **Una difesa dichiarata in un testo per gli utenti è una promessa.** Se la
  promessa la fa la pagina della privacy, il changelog e la riga sotto il
  pulsante, la prova che regge deve esistere: altrimenti si mente a tre
  pubblici diversi, e si scopre settimane dopo.

## Nel codice

- `tests/aiuto-percorso-giudice.spec.mjs` — la guardia sul testo che parte
  davvero verso il modello.
- `src/main/services/handlers.js` — il pezzo che compone la domanda: è lì che i
  campi si perdevano.
