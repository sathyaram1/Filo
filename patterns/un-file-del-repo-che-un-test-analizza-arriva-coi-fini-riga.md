# Un file del repo che un test analizza arriva coi fini riga della macchina

[← Tutti i pattern](../PATTERNS.md)

**La regola.** A un unit test un file del repo arriva già coi fini riga del
repo: il lanciatore carica `tests/helpers/finiRigaDelRepo.cjs`, che normalizza
ogni lettura di TESTO di un file del repo, qualunque forma abbia la lettura. Chi
deve vedere un `\r` legge i byte. Fuori dagli unit test la porta si chiama a
mano, `leggiTestoRepo()` (`tests/helpers/testo.mjs`), e lì vale ancora la
seconda metà: non cercarci dentro niente che un `\r` di troppo faccia sparire —
un «a capo» in mezzo a una stringa o a una regex, un `$` di fine riga.

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

## La sentinella guarda tutto, o ripete lo stesso errore

Questo difetto è già tornato una volta perché la cura era stata messa nel solo
file che l'aveva mostrato. La prima sentinella scritta per fermarlo guardava una
cartella sola, `tests/unit`, e nemmeno le sue sottocartelle: la stessa forma
malata messa fra le prove dell'app, in `tests/rules/` o in una cartella di
verifica passava indisturbata. Cioè la difesa contro «chiuso in un file solo»
era chiusa in una cartella sola.

Quindi la sentinella scende in **tutto** `tests/`, e riconosce anche il percorso
tenuto in una variabile (`const RULES = join(ROOT, 'firestore.rules')`, e la
lettura una riga più giù): con il solo confronto sulla riga della lettura
bastava spostare il percorso per sparire.

E vale la FORMA, non il nome. Le prime due reti sorvegliavano `readFileSync` e
le stringhe passate a `indexOf` e compagnia: la stessa lettura scritta con
`readFile` di `node:fs/promises`, e la stessa ricerca scritta come regex con un
«a capo» dentro, come `replace`, o con un `$` di fine riga in modalità
multiriga, passavano indisturbate — ed è esattamente la malattia di questa
pagina, scritta con altre parole. Chiudere una porta per giro è il modo in cui
questo difetto è già rientrato due volte. Quindi le reti guardano cosa il codice
FA: legge un file del repo senza normalizzarlo, cerca una cosa che un `\r` fa
sparire.

Il confine è la prudenza contro il rumore: se prima dell'«a capo» c'è un
quantificatore o una classe che il `\r` se lo mangia (`\s*`, `[\s\S]*?`, `\r?`)
la ricerca regge e non viene segnalata. Una sentinella che accusa il codice sano
la si spegne, e allora non protegge più niente.

Le eccezioni esistono, e si scrivono sulla riga che le usa, non si tolgono in
silenzio da un elenco di cartelle. Dove il testo del file viene solo passato a
qualcun altro invece che analizzato — le regole date in pasto agli emulatori
veri, dove i fini riga non cambiano niente — la riga porta il marcatore
`fini riga: non analizzato`. Un'esenzione scritta si vede in revisione; una
cartella esclusa in silenzio no.

## Dove vive

- `.gitattributes` — la regola per tutti i checkout.
- `tests/helpers/testo.mjs` — `leggiTestoRepo()` e `normalizzaFiniRiga()`.
- `tests/unit/finiDiRiga.test.mjs` — la sentinella: pretende la riga in
  `.gitattributes`, prova che il lettore normalizzi davvero, e diventa rossa se
  un test torna a leggere per conto suo un file che analizza — in qualunque
  forma, sincrona o asincrona — o se ci cerca dentro una stringa o una regex con
  un «a capo» in mezzo, o un `$` di fine riga in modalità multiriga. Guarda
  tutto `tests/`, a qualunque profondità.
- `tests/unit/verificaWindows.test.mjs` — tiene il lavoro su Windows allineato
  al cancello (stesso sistema, stessa versione di Node, stesso comando) e
  registra che gli unit test non aprono Filo, quindi non ne scaricano il
  binario.
- `tests/unit/firestoreRulesLivelli.test.mjs` — il caso da cui è nato, con la
  prova che rifà il ritaglio su una copia del file con i fini riga di Windows.
- `.github/workflows/verifica-windows.yml` — gli unit test su Windows a ogni
  spinta di un ramo: un rosso che si vede solo là non deve aspettare la
  pubblicazione per farsi vedere.
