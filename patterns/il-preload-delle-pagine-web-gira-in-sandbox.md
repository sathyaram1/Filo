# Il preload delle pagine web gira in sandbox

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Le schede web, la finestrella di accesso, la shell e i fumetti
nascono con `sandbox: true`: se un giorno un bug rompesse l'isolamento fra la
pagina e il preload, chi ci arriva trova un processo chiuso, non Node. Nella
sandbox `require` conosce solo `electron`, `events`, `timers` e `url`, quindi
`src/preload/page-preload.js` non gira dai sorgenti: `src/main/preloadPacchetto.js`
lo compone in un file solo, con dentro ogni modulo che richiede e i fogli che i
content script leggono, e una `require` che si comporta come quella di Node
(una volta per modulo, relativi, `.js` e `.json`, `path.join(__dirname, …)`).

Chi scrive codice che finisce lì dentro (preload, `src/content/`, i moduli di
`src/shared/` che il preload carica) tiene tre cose:

- **una `require` si legge da ferma**: una stringa, o un `path.join` fatto di
  `__dirname`, stringhe e costanti dello stesso file definite allo stesso modo.
  Un percorso calcolato non entra nel pacchetto;
- **Node non c'è**: niente `node:crypto`, `node:os`, `child_process`. Si usano le
  API del browser (`crypto.getRandomValues`, `URL`). Il pacchetto rifà solo
  `path` sui suoi percorsi, `fs.readFileSync` in sola lettura sui file che un
  modulo nomina in una stringa e legge da quella cartella, e completa `url` con
  `domainToASCII`/`domainToUnicode`;
- **ogni frame paga il pacchetto intero** (circa 2 MB, anche i riquadri
  pubblicitari): misurato su trenta riquadri costa meno di prima, quando ognuno
  si accendeva un Node suo, ma un modulo grosso aggiunto qui si paga in ogni frame.

Dove nasce il file: fuori dal pacchetto (`npm start`, i test) Filo lo compone
all'avvio nella cartella dei dati, `preload-pacchetto/`; nel pacchetto lo scrive
`build.beforePack` (il `default` dello stesso modulo) in `generato/`, fuori da
`src/` perché sentinelle e mappe non leggano tutto due volte. Il file è sempre
uguale a parità di sorgenti: il Mac universale fonde due copie che devono
coincidere. Prima che un pacchetto esca qualcuno ci guarda dentro: «Verifica build
Mac», «Verifica build Linux» e il lavoro Windows della release confrontano il file
nell'asar coi sorgenti, e senza quel file la bozza Windows non si pubblica. Prima di
toccare la ricetta del pacchetto:
[Mac e Linux si rompono in silenzio](mac-e-linux-si-rompono-in-silenzio.md).

**Il caso.** #834, rilievo 7 dell'analisi di sicurezza di giugno 2026: ogni vista
nasceva con `sandbox: false`, e con `nodeIntegrationInSubFrames` il preload con
Node girava anche negli iframe di terze parti. Reggeva solo l'isolamento dei
contesti.

**Cosa resta fuori.** Le pagine interne `filo://` (`internal-preload.js` richiede
ancora i moduli da disco, con `contextIsolation: false`): si decidono a parte.

**Le prove.** `tests/unit/preloadPacchetto.test.mjs` (cosa porta il pacchetto, la
sua `require`, nessuna vista che torni senza sandbox) e
`tests/sandbox-pagine-web.spec.mjs` (sandbox accesa e Filo che lavora, anche in un
riquadro di un altro sito e nella finestrella di accesso).
