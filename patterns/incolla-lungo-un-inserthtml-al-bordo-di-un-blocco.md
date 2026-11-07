# Incolla lungo: un insertHTML al bordo di un blocco

[← Tutti i pattern](../PATTERNS.md)

Un testo lungo incollato nell'Editor entra con **un solo** `insertHTML` (si annulla in un passo, #1475.2), e la
selezione che gli si passa va scelta in modo che Chrome lo metta **fuori** dal paragrafo, al suo bordo, accanto a del
testo dell'utente. Codice: `incollaLungo` in `src/pages/editor/editor.js`; prove in `tests/editor.spec.mjs`.

## Perché

`ReplaceSelectionCommand` di Chromium paga al quadrato delle righe quando i `<p>` del frammento finiscono dentro un
altro `<p>`: per ognuno chiama `MoveElementOutOfAncestor`, che rifà il layout. Succede in due casi:

- **blocco vuoto**: se la selezione è insieme inizio e fine di paragrafo, Chrome spegne la protezione dall'annidamento;
- **selezione non vuota a metà testo**: tolta la selezione il punto d'arrivo sta a metà paragrafo, e Chrome non lo
  spezza (lo spezza solo per un cursore).

Misure del 7 novembre 2026, 1.500 righe: blocco vuoto 2,4 s, a metà testo con selezione 1 s su 1.000 e 13 s su 3.000;
al bordo di un blocco con testo 20-70 ms.

## Le strade

- **Testo prima della selezione**: la si allunga fino in fondo al blocco dove finisce. L'HTML entra dopo il blocco, la
  prima riga (un `<p>`, che si unisce a qualunque blocco) si attacca al testo, e quello che seguiva la selezione chiude
  l'ultima riga.
- **Testo solo dopo**: l'HTML entra prima del blocco, e l'ultima riga, un `<p>`, si unisce al testo che resta.
- **Voce di elenco**: la selezione prende la voce da capo fino in fondo al blocco dove finisce, e il frammento sono le
  sole `<li>`, senza `<ul>`/`<ol>` intorno. Un elenco intero passa da `InsertAsListItems`, che con altre voci dopo il
  punto d'arrivo paga al quadrato (4.000 righe: 5 s; le sole voci 0,1 s).
- **Il blocco resterebbe vuoto**: un carattere invisibile (`ANCORA`) gli tiene il posto, piantato FUORI dall'annulla.
  - in un paragrafo sta in coda: l'ultima riga ci si unisce, e Chrome lo travasa nel suo nodo di testo;
  - in un titolo o in una citazione sta in un `<p>` suo, prima: un blocco così non si unisce, e il `<p>` si toglie.

## L'ancora non deve restare

Un carattere invisibile nel foglio conta nei caratteri, ferma le frecce, va a Filo e finisce nel testo copiato
(#1697.2). Si toglie subito, e senza rompere l'annulla:

- solo **in coda al suo nodo di testo**: gli offset che l'annulla ricorda stanno tutti prima, e restano veri;
- il nodo che Chrome ha staccato (e che l'annulla rimetterà) si svuota, così torna vuoto;
- un ripeti la rimette in coda all'ultima riga: la toglie il primo `input`, con la stessa regola.

Un'ancora davanti al cursore, o un foglio svuotato con `textContent = ''`, rompono l'annulla: il primo sposta gli
offset del testo che Chrome ci attacca, il secondo cambia il foglio fuori dalla storia (#1697.2).
