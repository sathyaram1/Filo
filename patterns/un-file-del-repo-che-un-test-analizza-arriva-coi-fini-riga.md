# Un file del repo che un test analizza arriva coi fini riga della macchina

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Un file del repo che una sentinella legge e analizza si legge con
`leggiTestoRepo()` (`tests/helpers/testo.mjs`), e non lo si cerca con una stringa
che contiene un «a capo». I fini riga non li decide il repo: li decide il
checkout della macchina che esegue i test.

## Il caso

`firestore.rules` contiene, indentato, il ramo di scrittura del triage:

```
allow update: if
        isAdmin() && ...
```

La sentinella lo ritagliava così:

```js
const i = RULES.indexOf(`allow update: if\n        ${guardia}()`);
assert.notEqual(i, -1, `manca il ramo di update con ${guardia}()`);
```

Verde su Linux e su macOS. Sul runner della pubblicazione — Windows — quel file
arriva con CRLF: fra `if` e gli spazi c'è `\r\n`, la stringa cercata non esiste,
`indexOf` torna -1 e la sentinella accusa le regole di non avere un ramo che
invece c'è.

Il costo non è un test rosso: è che quel test gira nel cancello prima della
pubblicazione. Dall'11 al 15 settembre 2026 nessuna versione è arrivata agli
utenti (feedback #569). Chi aveva scritto la sentinella non poteva vederlo: sulla
sua macchina era verde, e l'unico posto dove girava con CRLF era il cancello.

Non era la prima volta. Il #565 era lo stesso difetto da un'altra porta —
l'indice dei pattern letto come «senza nessuna voce», perché una regex con `$`
non arrivava mai in fondo a una riga che finiva per `\r`. Allora si era chiusa
quella porta sola, dentro quel file: un `split(/\r?\n/)` e un commento. Tre
giorni dopo il difetto è rientrato dalla porta accanto.

## Cosa si fa

Due metà, e servono tutte e due.

1. **`.gitattributes` con `* text=auto eol=lf`.** Il checkout scrive LF su
   qualunque macchina, e la differenza sparisce alla radice. Vale per le copie
   scaricate da lì in avanti: il repo non contiene file che abbiano bisogno di
   CRLF (nessun `.bat`, `.cmd`, `.ps1`).
2. **`leggiTestoRepo()` nelle sentinelle.** Una copia già sul disco tiene i suoi
   CRLF finché il file non viene riscritto da un checkout — è il caso della
   macchina di chi sviluppa Filo. Il lettore normalizza, quindi il test misura
   il contenuto del file e non il sistema operativo di chi lo esegue.

E la ricerca si scrive senza «a capo» dentro: `\s+` in una regex copre CRLF, LF e
anche un rientro cambiato.

```js
const inizio = new RegExp(`allow update: if\\s+${guardia}\\(\\)`).exec(testo);
```

## Dove vive

- `.gitattributes` — la regola per tutti i checkout.
- `tests/helpers/testo.mjs` — `leggiTestoRepo()` e `normalizzaFiniRiga()`.
- `tests/unit/finiDiRiga.test.mjs` — la sentinella: pretende la riga in
  `.gitattributes`, prova che il lettore normalizzi davvero, e diventa rossa se
  un test torna a leggere per conto suo un file che analizza, o se ci cerca
  dentro una stringa con un «a capo» in mezzo.
- `tests/unit/firestoreRulesLivelli.test.mjs` — il caso da cui è nato, con la
  prova che rifà il ritaglio su una copia del file con i fini riga di Windows.
- `.github/workflows/verifica-windows.yml` — gli unit test su Windows a ogni
  spinta di un ramo: un rosso che si vede solo là non deve aspettare la
  pubblicazione per farsi vedere.
