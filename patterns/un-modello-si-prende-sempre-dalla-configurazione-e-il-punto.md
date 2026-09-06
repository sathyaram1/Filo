# Un modello si prende SEMPRE dalla configurazione, e il punto va censito

[← Tutti i pattern](../PATTERNS.md)

Filo usa modelli ovunque, spesso in modo invisibile (riordino schede, riassunti,
memoria, giudici, indicizzazione dell'archivio). Il rischio non è scegliere male
un modello: è **non sapere quanti sono e dove sono**. Una politica sui modelli
che vale solo nei punti di cui ci si ricorda non è una politica.

Il registro è **`src/shared/modelUsage.js`** (#417): una voce per OGNI punto in
cui Filo usa — o volutamente NON usa — un modello, con `from`:

- `user` → lo sceglie chi usa Filo (una funzione di `SN_CONST.ACTIONS`, campo
  in Opzioni → Modelli);
- `owner` → lo sceglie chi gestisce Filo (uno slot di `supportModelsStore.js`,
  Gestione → Modelli di supporto: gira sui server, non sul PC dell'utente);
- `none` → quel punto un modello non lo usa (sta nell'elenco **apposta**, così
  non lo si cerca);
- `code` → deve restare **vuoto**: è l'invariante.

**Regole operative:**

- **Mai un id di modello scritto nel codice**, nemmeno come "default se manca":
  un ripiego scritto nel codice fa girare un modello che nessuno ha scelto e che
  può violare la politica sui fornitori. Dal 2026-09-04 vale anche per i
  "predefiniti": `DEFAULT_MODEL_REGISTRY` è vuoto e `DEFAULT_MODELS` ha tutte
  le catene vuote (le chiavi restano per il censimento). I modelli veri stanno
  nella configurazione condivisa (Gestione → Modelli predefiniti) o nelle
  Opzioni; una funzione senza modello si ferma e lo dice. Un default nel codice
  invecchia in silenzio: costi e prestazioni peggiori senza che nessuno se ne
  accorga. L'unico elenco di nomi che resta in `constants.js` è il listino
  prezzi. I test usano un registro di prova (`tests/fixtures/testModels.js`,
  caricato solo con `NODE_ENV=test`), che fa da registro "di build" per
  `defaultsStore` e da seme dello storage.
- **Mai prendere in prestito lo slot di un'altra funzione.** Se l'editor chiede
  il modello di «Spiega», chi cambia «Spiega» cambia l'editor senza saperlo, e
  chi vuole cambiare l'editor non trova dove: crea uno slot nuovo.
- **Una funzione nuova si aggiunge in tre posti nello stesso commit:**
  `ACTIONS` + `ACTION_LABELS` + `DEFAULT_MODELS` in `constants.js`, la voce nel
  censimento, l'etichetta i18n in `modelChainEditor.js`. L'elenco della griglia
  delle Opzioni **viene dal censimento**, quindi non c'è una quarta lista da
  ricordare.
- **Requisiti del modello:** se la funzione ha bisogno di un tipo di modello
  particolare (immagini, audio, sintesi vocale, indicizzazione), dichiaralo in
  `requirementsFor` di `modelCaps.js`, così l'editor blocca gli abbinamenti
  sbagliati invece di farli fallire a runtime.
- **Test:** `tests/unit/modelUsage.test.mjs` incrocia il censimento con
  `ACTIONS`, con gli slot di supporto, con i default e con la griglia delle
  Opzioni, **e scansiona `src/` alla ricerca di nomi di modello scritti nel
  codice**. `tests/model-usage-census.spec.mjs` verifica in app che ogni punto
  censito come impostabile abbia davvero il suo campo e che gli altri siano
  elencati con il loro "dove si imposta".
