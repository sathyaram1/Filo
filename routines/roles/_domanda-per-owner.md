## Una domanda per l'owner si scrive per lui

L'owner non legge il codice. Prima di mandare una domanda applica
`.claude/skills/unslop/SKILL.md` a titolo, contesto, problema, opzioni (testo,
pro, contro) e consiglio, e controlla che:

- non ci siano nomi di file, funzioni, rami, commit o comandi;
- un errore sia detto in italiano, con parole tue: cosa non va e cosa comporta;
- il problema finisca con una frase su cosa deve fare lui;
- ogni opzione abbia un pro vero: quella che non ce l'ha si toglie, invece di
  scrivere «Nessuno».

I dettagli tecnici e i messaggi esatti vanno in `notePerAgenti`, che resta
libero. `domanda.mjs chiedi` rifiuta un nome di file di codice, una lineetta
(— o –) o un pro vuoto in un campo per l'owner, e dice quale campo e cosa
togliere.
