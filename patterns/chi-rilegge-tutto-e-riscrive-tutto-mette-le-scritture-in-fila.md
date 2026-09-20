# Chi rilegge tutto e riscrive tutto mette le scritture in fila

[← Tutti i pattern](../PATTERNS.md)

Un magazzino tenuto in una chiave sola si aggiorna così: rileggi la lista
intera, cambia una cosa, riscrivi la lista intera. Due aggiornamenti che
partono insieme leggono la stessa lista di partenza, e il secondo riscrive
sopra il primo. Quello che il primo aveva scritto non c'è più, e nessuno se ne
accorge: non c'è errore, non c'è rosso, c'è un messaggio in meno.

La cura è una riga: **le scritture si mettono in fila**, una parte quando la
precedente ha finito di salvare. Le letture restano libere.

```js
let coda = Promise.resolve();
function inCoda(fn) {
  const risultato = coda.then(fn, fn);
  coda = risultato.then(() => {}, () => {});   // un errore non ferma la fila
  return risultato;
}
```

Fuori dal modulo escono le letture così come sono e le scritture avvolte in
`inCoda`: chi chiama non deve sapere niente di tutto questo, e non può
dimenticarselo.

## Perché scrivere una regola per una cosa così rara

Perché la finestra è piccola ma il danno è permanente, e questi magazzini
esistono proprio per non perdere niente. In Filo il guasto si è già presentato
due volte:

- `src/main/shim/storage.js`: due scritture su disco insieme condividevano lo
  stesso file temporaneo, e la seconda `rename` non lo trovava più. Curato con
  `flushChain`, la stessa fila;
- `src/main/services/filoChats.js` (#525, primo giro di verifica): due chat che
  andavano avanti nello stesso istante, con due schede di Filo aperte, si
  mangiavano un messaggio a vicenda.

## Come si prova

Con un magazzino finto in memoria in cui la **scrittura** è lenta e la lettura
immediata (`tests/unit/filoChatsStore.test.mjs`): è in quell'attimo che una
seconda scrittura rilegge una lista vecchia. Rallentare la lettura invece non
prova niente, perché fra un timer e l'altro Node fa girare le microtask e la
prima scrittura fa in tempo ad arrivare: la prova passa anche senza la cura.

Il caso più duro da vedere è l'archivio **vuoto**: lì ogni scrittura parte da
una lista nuova di zecca e non condivide nemmeno l'oggetto in memoria con le
altre, quindi l'ultimo che salva cancella tutti gli altri.

## Il parente stretto: la stessa cosa scritta due volte

Sempre in un magazzino del genere, «rileggi e riscrivi» non protegge nemmeno
dai doppioni. Un turno che fallisce lascia la domanda senza risposta; chi preme
«Riprova» rimanda la stessa domanda e se la ritrova scritta due volte. Il
controllo va **stretto**: scatta solo se l'ultima cosa salvata è identica a
quella che arriva e viene dalla stessa parte. Se in mezzo c'è una risposta, la
ripetizione è voluta («continua», «continua») e si conserva.
