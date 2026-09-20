# Una pagina divisa in parti: la pagina possiede lo stato, le parti lo chiedono

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Quando una pagina diventa troppo grossa e si taglia, i pezzi
restano in `src/pages/<pagina>/` e si chiamano `<pagina>-<parte>.js`. Ognuno è
un IIFE che registra un oggetto su `globalThis` con un `init(deps)` e **non
tocca il DOM al caricamento**. Lo stato condiviso non si copia in due file: lo
possiede uno solo, e gli altri lo chiedono con una funzione.

## Il caso

`dashboard.js` era 141 KB in un IIFE solo (#635). Chi lo apriva per due righe
di recap si portava dietro il blocco di attività, l'accoglienza, i comandi con
lo slash e il terminale. Il taglio l'ha portato a 73 KB con quattro parti
accanto: `dashboard-attivita.js`, `dashboard-onboarding.js`,
`dashboard-comandi.js`, `dashboard-terminale.js`.

Il pezzo difficile non sono le funzioni: sono le variabili che un IIFE solo
teneva in comune. `terminalMode`, `terminalShell` e `currentCwd` le leggevano
il terminale (per eseguire) e i comandi (per colorare l'input); `sending` lo
leggevano l'accoglienza e il turno di chat.

## La strada sbagliata: una copia per parte

La mossa immediata è dare a ogni modulo la sua copia, e allinearle con dei
`set`. Non regge nemmeno un giro: la cartella corrente cambia da tre porte
diverse — un `cd` digitato, un `cd` che il modello ha eseguito nel turno, il
valore ripescato all'avvio — e ogni porta che dimentica una delle copie lascia
la barra grigia a raccontare una cartella in cui non sei. Tre copie della
stessa cosa sono tre modi di mostrarne una sbagliata.

Quindi: **chi fa la cosa possiede lo stato della cosa**. La cartella corrente
sta in `dashboard-terminale.js`, che è l'unico che la cambia; i comandi la
chiedono con `getCwd()`. `sending` resta in `dashboard.js`, che guida i turni;
l'accoglienza lo chiede con `isSending()`. Le dipendenze passano da `init` come
funzioni, mai come valori: un valore passato a `init` è la fotografia di
quell'istante, e invecchia subito.

## Il contenitore si passa, non si pesca

`createActivity()` pescava `bubblesEl` dalla pagina. Adesso il contratto è
`SN_DASH_ATTIVITA.create(container)`: chi disegna un blocco dice dove va. Così
il modulo non conosce la home — si prova, si riusa, e nessuno scopre a
posteriori che finiva sempre nello stesso posto.

## Quello che si rompe in silenzio

Un file nuovo nella cartella che nessuno mette fra gli `<script>` della pagina
non viene caricato: il suo globale non esiste e la pagina muore alla prima riga
che lo nomina, a runtime, in una superficie sola. È lo stesso debito che il
piano di divisione segnalava per i content script, dove l'elenco è duplicato in
`page-preload.js` e `internal-preload.js`.

Per questo il taglio arriva con la sua sentinella,
`tests/unit/dashboardParti.test.mjs`: carica ogni parte in un contesto **senza
`document`** — se tocca il DOM mentre si carica, esplode lì invece che fra sei
mesi — e pretende che ogni `<pagina>-*.js` della cartella sia fra gli `<script>`
della pagina, prima di quello della pagina, e che la pagina lo inizializzi.

Due sentinelle indicizzate su un percorso si rompono quando quel percorso
cambia, e vanno aggiornate nello stesso commit: `superficiSoloOwner.test.mjs`
(il comando `/feedback`, che ora sta nei comandi) e `capabilities.test.mjs` (le
strade verso una pagina `filo://`, che ora partono da più file — legge la
cartella intera, così un pezzo spostato non esce dal controllo in silenzio).

## Dove vive

- `src/pages/dashboard/dashboard.js` — la home tiene chat e turni, il messaggio
  centrale, la colonna live, i controlli, il recap e i premi; in cima c'è la
  sezione che lega le quattro parti e passa le dipendenze.
- `src/pages/dashboard/dashboard-{attivita,onboarding,comandi,terminale}.js`
- `tests/unit/dashboardParti.test.mjs` — la sentinella.
- Il piano di divisione dei file del 17/09/2026 elenca le altre pagine in coda
  per lo stesso taglio. Non sta nel progetto: è l'allegato del #635, e si legge
  dalla scheda della segnalazione in dashboard.

La mappa di `specsForChangedFiles` (`scripts/finish-local.mjs`) non si tocca:
per una pagina l'area la dà la CARTELLA, quindi `dashboard-comandi.js` lancia
gli stessi spec `dashboard-*` di prima.
