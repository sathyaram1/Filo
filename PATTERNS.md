# Pattern e convenzioni di Filo

Catalogo del **sapere condiviso** su come si costruiscono le cose in Filo: pattern UI,
convenzioni di design, decisioni ricorrenti. Vale per le sessioni locali **e** per le
routine cloud.

**Quando leggerlo:** prima di toccare la UI o di prendere una decisione di design.
**Quando aggiornarlo:** ogni volta che stabilisci (o ti viene indicato) un pattern
nuovo, o che ne scopri uno implicito nel codice che vale la pena rendere esplicito.
Una voce qui dovrebbe **guadagnarsi il suo posto**: è una regola riusabile, non un
appunto monouso.

Formato di una voce: titolo breve → la regola in una frase → il perché → eventuale
riferimento al codice dove vive il pattern.

I principi a monte di questi pattern stanno in **`filo_filosofia.txt`** (filosofia
generale) e **`filo_design.txt`** (principi di design concreti): leggili insieme a
questo file prima di lavorare su codice o revisioni.

---

## Filosofia: Filo è minimale

Filo è volutamente scarno (non c'è nemmeno la barra URL). Scrivere più codice non
significa UX migliore: spesso la mossa giusta è **togliere**, non aggiungere. Le
feature collegate / invarianti UX vanno considerate, ma un'aggiunta deve guadagnarsi
la sua complessità — se rende l'app solo "più piena" e non più coerente, non va fatta.

## Controllo custom dentro una `<label>`: `.sn-page label` te lo appiattisce

`pages.css` ha `.sn-page label { display: block; margin: …; color: var(--sn-muted) }`
per TUTTE le pagine `filo://`. Specificità **0-1-1**: una classe sola (`.mio-switch`,
`.mia-scelta`) non basta a batterla, e non conta che il tuo `<style>` venga dopo.

Il guasto è silenzioso e ingannevole: la label diventa `display: block`, i figli
`<span>` tornano `inline`, e **`width`/`height` smettono di applicarsi**. Un pill di
40×22 collassa a larghezza 0 — ma la pallina interna, che è `position: absolute`,
resta al suo posto: sullo schermo vedi "mezzo controllo" e sembra un problema di
colore, non di layout. È rimasto in produzione per settimane sullo switch della
tab Automazioni (#446/#447: l'owner l'ha fotografato due volte senza che nessuno lo
riconoscesse).

- **Regola:** un controllo custom costruito dentro una `<label>` si stila con
  `.sn-page label.<classe>` (0-2-1), e ci si rimette `margin: 0` e il colore, che
  `.sn-page label` aveva già deciso per te.
- Dai al pezzo interno un `display` **esplicito** (`inline-block`/`flex`): così non
  dipende dal fatto che il genitore sia rimasto flex.
- **Non** rilassare la regola in `pages.css`: serve a tutte le altre pagine.
- **Un test che legge solo `getComputedStyle(...).backgroundColor` non se ne
  accorge**: il colore è giusto anche su una scatola 0×0. Se asserisci su un
  controllo custom, asserisci sulla **geometria** (`getBoundingClientRect()`, o
  `toBeVisible()` sul pezzo visibile — mai sull'`<input>`, che è nascosto per
  costruzione).

## Controlli UI custom: tema di Filo, non default del browser

I controlli dell'interfaccia (menu a tendina, select, ecc.) devono usare la
**palette e il comportamento del tema di Filo**, non i default del browser/OS (es. il
blu di selezione nativo). Devono essere **coerenti tra loro**: un menu a tendina nuovo
deve sembrare e comportarsi come gli altri menu a tendina già presenti in Filo.

- **Perché:** i default nativi (blu di sistema, font, hover) spezzano l'identità
  visiva e fanno sembrare l'elemento "incollato" e non parte dell'app.
- **Dove:** i token di tema vivono in `src/styles/` (theme). Prima di stilare un
  controllo nuovo, guarda come è fatto un controllo equivalente esistente e riusane
  variabili/classi invece di reinventare i colori.
- **Combobox editabili → `SN_COMBOBOX`, mai `<datalist>` nativa.** Il popup della
  `<datalist>` è renderizzato dall'OS (colori di sistema, non tematizzabile): è
  l'esatto opposto di "coerente con Filo". Per un campo a tendina editabile (input
  + lista filtrabile) usa `SN_COMBOBOX.attach(host, input, { readOptions, onPick, … })`
  (`src/shared/comboBox.js`): riusa le classi `.sn-select-pop`/`.sn-select-option`
  (theme.css) come gli altri menu. `host` dev'essere `position:relative` (il popup
  si ancora lì). La `<datalist>` può restare come **sorgente dati** (popolata
  altrove), ma togli l'attributo `list=` dall'input così il popup nativo non
  appare. Usato dal campo "stringa modello" delle Opzioni/admin e dall'editor a
  segmenti (`modelChainEditor.js`).
- **`::selection` NON entra in uno shadow root: va ridichiarata dentro (#414).**
  La regola del tema (`[data-sn-theme] ::selection` in `theme.css`) sta nel foglio
  del DOCUMENTO e non si applica ai nodi di uno shadow tree: dentro un componente
  in Shadow DOM (il popup di conferma, `src/shared/confirmUi.js`) selezionare il
  testo tornava al **blu di sistema** — l'unico punto fuori palette di tutta la UI.
  Chi crea un componente in Shadow DOM ripete le regole `::selection` /
  `::-moz-selection` nel `<style>` del root, con `var(--sn-selection-bg)` (i custom
  properties, quelli sì, attraversano il confine: gli override estetici dell'utente
  continuano a valere) e un letterale come ripiego.

## Estetica: ogni variabile visiva è un token del registro, mai un valore sparso

Ogni variabile estetica (colori, font, raggio angoli, opacità…) deve passare dal
**registro dei token** in `src/shared/themeTokens.js` (#146.1): nome stabile →
tipo → default → eventuale categoria da cui eredita. Gli override dell'utente
vivono in `settings.themeTokens` e si applicano **live** su tutte le superfici
(shell, pagine filo://, popup/menu/sidebar su pagine esterne) via il broadcast
`SETTINGS_UPDATED`.

- **Gerarchia a due livelli:** i token specifici (es. `selection.color`)
  ereditano dalla categoria (es. `accent`). Nel CSS l'eredità è la catena
  `var()` nativa (`--sn-selection-color: var(--sn-accent)` in theme.css); in JS
  la replica `effectiveValue()` per la UI delle preferenze e i test.
- **Regola operativa:** quando aggiungi un elemento UI, usa le variabili
  `--sn-*` esistenti (o aggiungi un token al registro se serve una nuova "manopola"
  utente) — mai colori hardcoded. Un override emesso dall'utente vince perché
  esce a specificità `html[data-sn-theme]` (0,1,1) sopra i blocchi di theme.css.
- **Sicurezza:** i valori degli override finiscono in `<style>` iniettati anche
  nelle pagine esterne → la whitelist per tipo (`validate`) è obbligatoria e il
  choke point è `applySettingsUpdate` nel main. Non aggiungere percorsi di
  scrittura che la saltino.
- **Dove:** registro `src/shared/themeTokens.js`; default CSS `src/styles/theme.css`
  (+ gemelli shell in `src/renderer/shell.css`); applicazione in `pageBootstrap.js`
  (filo://), `content.js` (pagine esterne), `shell.js` (shell). Test:
  `tests/unit/themeTokens.test.mjs`, `tests/theme-tokens.spec.mjs`.

## Nuovo tipo di messaggio: decidi SUBITO se le pagine web possono chiamarlo

Il canale `filo:message` è **uno solo** e ci arrivano sia le pagine interne
(shell, `filo://`) sia i content script delle pagine web esterne. Registrare un
handler senza dire nulla significa **aprirlo a qualunque sito visitato**: è il
default sbagliato, e non ce ne si accorge finché qualcuno non lo cerca.

- **Domanda obbligatoria** per ogni `MSG.*` nuovo: *"ha senso che un sito
  qualsiasi lo chiami?"*. Se la risposta è no — e lo è per tutto ciò che legge
  dati dell'utente, tocca il disco, o aziona il sistema operativo — gattalo:
  ```js
  const isFilo = (origin) => String(origin || '').startsWith('filo://');
  on(MSG.X, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    …
  });
  ```
  (`origin` è il terzo argomento dell'handler; la shell è `filo://shell/shell.html`.)
- **Due bandiere rosse** che rendono il gate non negoziabile: la risposta
  contiene **percorsi assoluti su disco** (rivelano lo username e la struttura
  del computer), oppure il comando fa **aprire/eseguire qualcosa** al sistema
  (`shell.openPath`, `showItemInFolder`, spawn). Un sito che può far aprire un
  file appena scaricato, su Windows, può farlo eseguire.
- **Documentalo dove il messaggio è definito** (`src/shared/messages.js`), non
  solo nell'handler: chi aggiunge il messaggio gemello lo vede.
- **Testalo** con un dispatch di origine web: `SN_HANDLE_MESSAGE(msg, { tab: {
  url: 'http://sito-ostile.example/' }, url: '…' })` deve dare `forbidden`, e la
  stessa chiamata da `filo://` deve passare. Esempi:
  `tests/downloads-nav.spec.mjs`, `tests/clipboard-origin-gate.spec.mjs`,
  `tests/audit-quit-app-origin.spec.mjs`.

## Azioni di Filo: livello di sicurezza statico nel registro, mai deciso dall'LLM

Ogni azione che Filo (l'AI) può intraprendere dichiara il proprio livello nel
**registro** `src/shared/actionLevels.js` (#146.2): 1 = reversibile, esegue
subito; 2 = popup di conferma con spiegazione (OK/Annulla); 3 = irreversibile,
l'utente digita "conferma". Il dispatch (`executeFiloAction` nel main)
**rifiuta le azioni non registrate**: un nuovo potere di Filo che non dichiara
il livello non viene eseguito.

- **Regola operativa:** quando aggiungi un'azione Filo, registrala in
  `actionLevels.js` con livello + `describe()` (la spiegazione in chiaro per il
  popup). Per le preferenze il livello è per-setter in `preferences.js`
  (`level: 2` su ciò che tocca sicurezza/shell). La sospensione e la conferma
  passano da `needsConfirm` → bottone in chat → `MSG.FILO_CONFIRM_ACTION`; il
  main **riclassifica** alla conferma, non si fida del client.
- **Il popup di livello 2 spiega COSA Filo fa e i RISCHI (#183).** Non basta
  nominare la modifica: ogni setter di `preferences.js` di livello 2 **deve**
  dichiarare un campo `risk` — una frase in chiaro su cosa controlla
  l'impostazione e cosa si rischia a toccarla. `describe()` compone
  label + `risk`, e il popup mostra entrambi. Un setter di livello 2 senza
  `risk` è un bug: lo intercetta `tests/unit/preferences.test.mjs`.
- **UI:** le conferme usano i componenti riusabili `SN_CONFIRM_UI.confirm`
  (livello 2) e `SN_CONFIRM_UI.confirmTyped` (livello 3) in
  `src/shared/confirmUi.js` — mai `window.confirm` nativo.
- **Sicurezza (#249):** il dialogo vive in uno **Shadow DOM chiuso** agganciato
  a un host neutro `.sn-confirm-host`: gli script della pagina non possono
  trovarne i bottoni (querySelector/MutationObserver) né auto-cliccare OK. NON
  tornare mai ad appendere i bottoni al DOM del documento. Nei test Playwright
  i locator non attraversano il root chiuso: usa `tests/helpers/confirm.mjs`
  (presenza → host `.sn-confirm-host`; contenuto/click/input → hook
  `SN_CONFIRM_UI._test` via `page.evaluate`, disponibili sulle pagine filo://).
- **Test:** `tests/unit/actionLevels.test.mjs`, `tests/filo-action-levels.spec.mjs`,
  `tests/audit-confirm-dom-bypass.spec.mjs`.

**Filo ESEGUE, non mostra bottoni inerti (#162/#159).** Quando l'utente chiede
un'azione, Filo la compie — non lascia un bottone "da cliccare per davvero":
- **NAVIGA apre subito** la scheda (in `executeFiloAction`, via `tm.openTab`); il
  chip che resta nella bolla è solo un riferimento per RIAPRIRE e ha SEMPRE
  un'etichetta (favicon + hostname), mai un favicon muto. Quando l'unica cosa che
  Filo fa è aprire un link, `text` resta vuoto: niente "(vuoto)" di riempimento
  (il fallback "(vuoto)" vale solo per la risposta davvero vuota, senza azioni).
  Per PROPORRE link tra cui scegliere si usano link markdown nel testo, non NAVIGA
  (che aprirebbe da solo).
- **Le impostazioni di livello 2 sono SEMPRE un popup, mai un chip inerte (#183).**
  `renderActions` riceve `autoConfirm:true` sulle risposte fresche e apre da sé il
  popup di conferma dei bottoni `IMPOSTA_PREFERENZA`/`IMPOSTA_ESTETICA` di livello 2.
  Se nella stessa risposta ce ne sono **più d'una**, i popup si aprono **uno alla
  volta** (`renderActions` attende `_runConfirm()` di ciascuno prima del successivo):
  niente stacking di modali, ma neanche bottoni lasciati lì da cliccare a mano. Il
  bottone resta solo come ripiego se l'utente **annulla**. Vale anche per la
  segnalazione che Filo propone da sé (`INVIA_FEEDBACK`, #414): il popup non invia
  nulla, mostra il testo e aspetta l'OK — è la stessa cosa che fa da sempre la
  sidebar, e lasciare un chip da cliccare aggiungeva un passaggio prima ancora di
  poter leggere cosa sarebbe partito. Restano a click esplicito solo le azioni
  distruttive (livello 3) e i comandi: niente auto-conferma di cose irreversibili.
- **Il popup di livello 2 mostra il testo INTERO, non un estratto (#414).** Se è
  lungo scorre dentro il box (`.sn-confirm-text` ha `max-height` + `overflow-y`),
  mai un `…` a metà frase: un consenso su un testo che l'utente non ha potuto
  leggere per intero non è un consenso. Vale in particolare per il feedback, che
  parte a nome suo.
- **Test:** `tests/filo-open-link-direct.spec.mjs`, `tests/filo-action-levels.spec.mjs`
  (più popup di livello 2 → si aprono in sequenza, nessun chip resta da cliccare).

## Un modello si prende SEMPRE dalla configurazione, e il punto va censito

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
  può violare la politica sui fornitori. L'unica eccezione è il registro dei
  modelli configurabili in `constants.js` (`DEFAULT_MODEL_REGISTRY`,
  `DEFAULT_MODELS`, listino prezzi), dove i nomi **sono** il dato configurabile.
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

## Un interruttore che promette una garanzia non ha ripieghi silenziosi

"Solo modelli a pesi aperti" (#461) spegne tutti i modelli proprietari. Un
interruttore così non è una preferenza estetica: è una **garanzia**, e una
garanzia vale solo se regge anche quando le cose vanno male. Il pattern, valido
per qualunque interruttore che prometta "questa cosa non succederà":

- **Sostituisci, non spegnere.** Se quasi tutte le funzioni nascono col modello
  che l'interruttore vieta, spegnerlo e basta spegne mezza app: ogni funzione
  passa all'equivalente ammesso (`OPEN_WEIGHTS_SUBSTITUTES` in `constants.js`).
- **Il sostituto deve saper fare QUEL mestiere.** La sostituzione automatica è
  l'unico punto in cui Filo cambia modello da solo: se ci mette un modello che
  legge solo testo dove la funzione deve ascoltare un audio, la funzione muore
  con un errore qualunque — che per chi la usa è lo stesso ripiego silenzioso,
  con un finale diverso. Si guardano i requisiti della funzione
  (`SN_MODEL_CAPS.requirementsFor`) contro le capacità DICHIARATE del sostituto
  (`OPEN_WEIGHTS_SUBSTITUTE_MODALITIES`); se non combaciano, la funzione si ferma
  dicendolo, e le Opzioni la elencano fra quelle che si fermano invece che fra
  quelle che cambiano modello.
- **Diffidente per costruzione.** Ciò che non si sa classificare vale come
  vietato — e vale anche per le capacità: capacità ignote = niente sostituzione.
  Ammettere l'ignoto trasforma la garanzia in una promessa a caso.
- **Il cancello sta su OGNI cammino che chiama davvero, non solo sul principale.**
  Le funzioni passano da `buildAttemptChain`, ma i pulsanti «Prova» delle Opzioni
  e della pagina di amministrazione costruiscono la chiamata a mano: sono rimasti
  fuori dalla politica finché non ha avuto un punto solo
  (`openWeightsBlockKind` + `openWeightsBlockReason`/`providerRouting`), e stavano
  proprio nella pagina dove l'interruttore si accende. Quando aggiungi un cammino
  che chiama un modello senza passare dalla catena, il cancello va rimesso lì.
- **Niente ripiego verso ciò che l'interruttore vieta.** La catena di fallback
  viene POTATA prima di partire (`applyOpenWeightsPolicy` dentro
  `buildAttemptChain`): i tentativi vietati non esistono, quindi non possono
  scattare quando il sostituto non risponde. Se non resta niente, la funzione si
  ferma con un errore che la nomina — **mai** un ripiego zitto.
- **Dichiara l'effetto PRIMA.** Le Opzioni dicono quante funzioni cambiano
  modello e **quali si fermano**, calcolato sulla configurazione vera
  (`openWeightsImpact`). Scoprirlo usando l'app è il modo peggiore.
- **Verifica a posteriori, non solo a priori.** L'esclusione a monte è una
  speranza finché non si guarda **chi ha davvero servito** la risposta
  (`servedBy`): se risulta escluso, toast + voce di cronologia marchiata.
- **Vale anche dove decide qualcun altro.** L'interruttore sta sopra la config
  condivisa (crediti di Filo) e allunga la lista di esclusione con Anthropic: il
  punto è poter rifiutare anche la scelta dell'owner.
- **Test:** `tests/unit/openWeightsOnly.test.mjs` (parte pura),
  `tests/unit/testDefaultModel.test.mjs` (i pulsanti «Prova»),
  `tests/open-weights-only.spec.mjs` (catena reale costruita dall'app),
  `tests/options-open-weights.spec.mjs` (l'interruttore, cosa dichiara e quali
  «Prova» resta possibile premere).

La stessa politica vale per gli strumenti che testano Filo
(`tests/agent/llm.mjs`): stessa lista di esclusione dell'app — importata, non
ricopiata — e stesso controllo su chi ha servito.

## Richieste ambigue: Filo applica subito + offre un controllo per raffinare

Quando l'utente chiede in chat una modifica con un valore "giusto" non univoco
("rendi i bottoni verdi", "angoli più arrotondati"), Filo **non chiede** il
valore esatto: applica **subito** una scelta ragionevole (azione di livello 1,
reversibile) e nella bolla mostra un **bottone che apre un box di raffinamento**
(#146.4). Il principio è "agisci, non interrogare": l'affordance GUI risolve
l'ambiguità *dopo*, senza bloccare l'utente con una domanda.

- **Il tipo di controllo deriva dal tipo del dato**, non lo si sceglie a mano:
  colore → color picker, opacità/dimensione → slider, scelta discreta (font) →
  menu. La mappa tipo→controllo vive nel modulo riusabile
  `src/shared/aestheticRefiner.js` (`SN_AESTHETIC_REFINER`), che riceve da fuori
  le dipendenze (token correnti, `applyLive`, `persist`) così resta testabile e
  ignaro di IPC/storage. Per i token estetici il tipo è quello del registro
  `themeTokens.js`.
- **Anteprima live + persistenza:** ogni interazione col controllo applica il
  valore live (`pageBootstrap.applyThemeTokens`, locale e immediato) e lo
  persiste con `UPDATE_SETTINGS` debounced (broadcast a tutte le superfici). Il
  box ha "Fatto" (tiene) e "Annulla" (torna al valore che Filo aveva messo).
- **Eccezione di leggibilità:** se la modifica rende il testo ≈ allo sfondo
  (contrasto WCAG sotto soglia, `themeTokens.illegibleAfter`) l'azione sale a
  **livello 2** → conferma prima di applicare. Il flag lo calcola il main (ha i
  token correnti), mai l'LLM.
- **Estensione:** lo stesso pattern vale per qualsiasi preferenza dove un
  controllo aiuta (es. un volume → slider con anteprima sonora); oggi il refiner
  copre i token estetici, ma l'API è generica (un'azione + un controllo per tipo).
- **Test:** `tests/filo-estetica-chat.spec.mjs` (azione applica + box compare +
  picker scrive live), `tests/unit/themeTokens.test.mjs` (contrasto/leggibilità),
  `tests/unit/actionLevels.test.mjs` (livello 1 vs 2 illeggibile).

## Menu contestuale proprio nelle pagine filo://: `preventDefault` e il menu di Filo si fa da parte

Una pagina interna può avere un **menu contestuale proprio** su certi elementi
(chip dell'archivio, card dei mazzi): l'handler `contextmenu` dell'elemento
chiama `e.preventDefault()` e apre il suo popup (classi `.sn-select-pop`/
`.sn-select-option`, posizionato `fixed` alle coordinate del click). Il menu
generale di Filo, sulle pagine filo://, ascolta in **bubble** su window e cede
il passo se `e.defaultPrevented` è già vero.

- **Perché:** sulle pagine web ESTERNE Filo intercetta il tasto destro in
  capture aggressiva (deve battere gli handler di siti ostili come YouTube);
  sulle pagine INTERNE gli handler sono nostri e più specifici → vince la
  pagina, il menu di Filo è il fallback sul resto della superficie.
- **Regola operativa:** in una pagina filo:// basta `preventDefault()`
  nell'handler dell'elemento; NON serve `stopPropagation`. Se non chiami
  `preventDefault`, il tasto destro apre il normale menu di Filo.
- **Dove:** registrazione in `src/content/content.js` (ramo pagine interne);
  esempi in `src/pages/archive/archive.js` e `src/pages/decks/decks.js`.

## Menu contestuale: se Filo sostituisce il menu nativo, deve coprire OGNI tipo di elemento

Sulle pagine esterne il menu di Filo **rimpiazza** quello di Chromium. Ogni tipo
di contenuto per cui il menu nativo avrebbe delle voci (testo, immagine, link,
campo di testo, **video, audio**) deve avere il suo ramo nella matrice
contestuale: un tipo scoperto non significa "menu più povero", significa che
l'utente **perde del tutto** quelle azioni, senza alternative (#400).

- **Regola operativa:** quando aggiungi il supporto per un nuovo tipo di
  elemento, parti dall'elenco di ciò che il menu nativo offriva e completalo con
  ciò che ha senso in Filo; ogni stato attivabile deve essere disattivabile
  dalla stessa voce (l'etichetta racconta lo stato: "Ripeti in continuo" ⇄ "Non
  ripetere"), e le azioni senza riscontro visivo immediato confermano con un toast.
- **Elemento coperto da overlay:** i player veri stendono i loro comandi sopra al
  `<video>`, quindi il tasto destro arriva all'overlay e il media **non è tra gli
  antenati** del target. Il ramo va cercato anche con
  `document.elementsFromPoint(x, y)`, ma **solo come ripiego** quando non c'è
  altro contesto (selezione, immagine, link, campo di testo): altrimenti un video
  di sfondo a tutta pagina ruberebbe il menu al contenuto che gli sta sopra.
- **Un elemento può appartenere a PIÙ famiglie insieme — i rami non sono
  mutuamente esclusivi (#401).** Una miniatura racchiusa in un `<a>` (anteprime
  di articoli, schede prodotto, risultati di ricerca per immagini) è **sia**
  immagine **sia** link: un browser normale mostra le due famiglie di voci
  insieme. Con rami a `return` anticipato, quello dell'immagine chiudeva prima di
  valutare il link e le azioni sul collegamento sparivano del tutto. Regola:
  quando due contesti coesistono sullo stesso target, **componi** entrambe le
  famiglie (separatore fra loro), a partire da quella dell'elemento cliccato più
  in profondità. Costruisci le voci-azione in helper senza la sezione "Spiega",
  così il chiamante decide: **una sola** sezione "Spiega" inline (quella
  dell'elemento primario), perché ogni box `inline` fa una chiamata al modello a
  ogni apertura del menu — due box = doppio costo per un menu che si apre spesso.
- **Le famiglie non sono annidate: sono IMPILATE (#444).** "Appartiene a più
  famiglie" non vuol dire "una sta dentro l'altra". Le schede delle home video e
  social sono strati sovrapposti: l'anteprima che parte al passaggio del mouse si
  stende SOPRA la copertina, e il link della scheda le passa sotto, o sopra
  quando è un velo trasparente che copre tutto. Cercare il collegamento solo fra
  gli **antenati** (`closest('a[href]')`) lo perde in tutti questi casi, e la
  scheda diventa irraggiungibile col tasto destro proprio mentre l'anteprima
  suona. Regola: **ogni** famiglia ha il suo ripiego "sotto il punto cliccato"
  (`findUnder` sulla pila di `deepElementsFromPoint`) — media, immagine **e
  collegamento**, anche da solo.
- **Guardare sotto il cursore vuole un freno, uno solo, per tutte le famiglie
  (#444).** Adottare quello che sta sotto senza controllare che sia la stessa
  cosa che l'utente sta GUARDANDO regala il menu a roba invisibile: la barra
  fissa di un sito di notizie sotto cui sono scivolati i titoli, il riquadro dei
  cookie, un manto che la pagina stende su tutta se stessa sotto al testo.
  Nell'ultimo caso il collegamento lo sceglie la pagina. «Copia URL» le mette in
  mano gli appunti, «Apri in nuova tab» e «Condividi link» decidono dove mandare
  l'utente, e a ogni clic destro parte l'analisi del link, che va a scaricare
  quell'indirizzo. Il freno è `sameSurface` e misura l'elemento **davvero
  cliccato** contro il candidato, con due condizioni: si sovrappongono per almeno
  metà del più piccolo, e nessuno dei due **inghiotte** l'altro. Il freno sta in
  un posto solo, `detectContext`: i tre `*Under` escono da lì già vagliati, così
  nessun ramo a valle può dimenticarsene. Era già successo: il controllo c'era
  per due casi su tre.
- **Inghiottire non è contenere: circondare da tutte le parti non basta a dire
  di no (#444).** La prima versione del freno scartava il candidato appena
  sforava l'elemento cliccato su tutti e quattro i lati. Ma è esattamente la
  forma della scheda con un bordo, o con l'imbottitura fra il bordo e la
  copertina — mezzo web — e su quelle schede le quattro voci del collegamento
  sparivano di nuovo, col filmatino in funzione e da fermo. La differenza fra un
  contenitore e una copertura è la **scala**, non il numero di lati: un
  contenitore abbraccia quello che tiene (la copertina rientrata di dodici pixel
  riempie l'85% della scheda; anche la scheda che si tiene dentro il titolo resta
  sopra alla metà), mentre una barra fissa, un riquadro dei cookie o un manto
  sono grandi come la finestra e nascondono una riga di poche parole — sotto al
  5% di sé. `swallows` = circonda **e** l'altro sta sotto a `CONTAINER_MIN_RATIO`
  (0.35, con margine largo da tutt'e due le parti). Quando allarghi un freno,
  cerca la grandezza che distingue davvero i due casi: alzare i pixel di
  tolleranza avrebbe solo spostato il confine di qualche scheda.
- **Ci sono due cose opposte con la stessa forma: lì la geometria non può
  decidere, e la domanda vera è se si VEDE (#444).** La riga di un elenco di
  risultati — miniatura piccola a sinistra, titolo e tre righe di descrizione a
  destra, il collegamento della riga steso sopra a tutto — ha lo stesso ingombro
  di una barra fissa sopra un titolo scivolato sotto: un rettangolo largo quanto
  la pagina che ne circonda uno piccolo. Nessuna soglia di area li separa, e
  infatti `CONTAINER_MIN_RATIO` cadeva esattamente in mezzo: su una riga larga
  760 i comandi del filmato sparivano con miniature alte 101 e 160, tornavano da
  220 in su — cioè quasi mai, perché le miniature vere dei risultati e dei feed
  stanno tutte sotto. Quello che distingue i due casi non è una misura: sopra la
  miniatura c'è un collegamento invisibile, sopra il titolo sepolto c'è una barra
  opaca. Quindi il freno ha una **seconda prova, che vale da sola**: se fra il
  punto cliccato e il candidato non c'è niente di **dipinto**, il candidato è
  esattamente quello che l'utente sta guardando (`coveredAt` scorre la pila di
  `deepElementsFromPoint` fino al candidato — chi sta prima sta sopra — e chiede
  a `paintsSomething` se qualcuno disegna: sfondo, immagine di sfondo, bordo,
  ombra, tag che si disegna da sé, o testo che si vede davvero). Le due prove
  stanno in OR dentro `sameSurface`: la geometria dice "stessa scala, stessa
  scheda", la visibilità dice "è lì sotto gli occhi". Nessuna delle due copre
  l'altra — un velo con la sfumatura del titolo dipinge eccome, e passa per
  geometria.
  - `paintsSomething` guarda l'elemento intero, non il pixel: il paragrafo
    cliccato di fianco all'ultima parola dipinge lo stesso, altrimenti il manto
    invisibile steso sulla pagina tornava nel menu.
  - Il testo dei lettori di schermo è ritagliato a un pixel: `hasVisibleText`
    misura l'ingombro del testo con un `Range` e sotto i 2 px lo considera
    assente, se no una riga di risultati con il titolo ripetuto dentro il
    collegamento-velo si comporterebbe da elemento opaco.
  - **Un rettangolo vale come misura solo se copre il punto cliccato**
    (`coversPoint`). Il collegamento steso sulla scheda lo fa mezzo web con uno
    pseudo-elemento (`.stretched-link::after { inset: 0 }`): l'hit-test
    restituisce l'`<a>` del titolo, il cui rettangolo sta nella colonna del
    testo, lontano dalla miniatura. Ogni conto sui rettangoli lì dice "non
    c'entrano niente" e la miniatura spariva dal menu; e nel senso opposto, quel
    titolo contava come cosa dipinta davanti alla miniatura, che invece copre
    solo dov'è. Quindi `sameSurface` salta la geometria quando uno dei due
    rettangoli non copre il punto, e `coveredAt` ignora chi non è lì. Il punto
    viaggia insieme alla pila (`view = { stack, x, y }`): sono un dato solo.
- **Se lo dice il DOM, la geometria non ha voce in capitolo (#444).** Il freno
  serve a indovinare quando la pagina non dice niente: strati sovrapposti che
  nessuna parentela lega. Quando invece la copertina adottata sta **dentro** un
  `<a>`, la pagina ha già dichiarato che copertina e collegamento sono la stessa
  scheda, e rifare il conto sui rettangoli può solo buttare via un'informazione
  certa — è quello che succedeva con la striscia del titolo stesa sopra una
  copertina racchiusa nel collegamento: la struttura diceva di sì, la geometria
  (bordo, imbottitura, titolo in mezzo) diceva di no, e vinceva il no. Quindi:
  `findLinkUnder` cerca prima l'`<a>` che **contiene** il media o l'immagine
  adottati, e solo se non ne trova guarda la pila sotto il cursore; `belongsTo`
  mette la parentela prima di `sameSurface`, e la cerca con
  `containsAcrossShadow` (`contains()` di un elemento in chiaro non vede dentro
  uno shadow root, e le schede a componenti sono proprio quelle che rompeva).
- **Il ripiego vale per la famiglia da SOLA, non solo in coppia (#444).** Finché
  il ripiego esisteva solo dentro i rami "media + link" e "immagine + link", lo
  stesso identico pixel dava due esiti opposti a seconda dello strato che vinceva
  in quell'istante: menu completo mentre l'anteprima suonava, menu **vuoto** un
  istante dopo che si era fermata. E non serve un video: un velo trasparente
  sopra una scheda-link — come è costruito quasi ogni elenco di schede — bastava
  a far sparire tutte e quattro le voci del collegamento. Quando aggiungi un
  ripiego a una famiglia, chiediti sempre come si comporta quando è l'unica cosa
  lì sotto.
- **`closest()` si ferma al confine di un componente web — e `elementsFromPoint`
  pure, dall'altra parte.** `realTarget` con `composedPath()[0]` ti dà l'elemento
  vero dentro lo shadow root, ma da lì la risalita non vede più gli antenati in
  chiaro: un `<video>` in un componente dentro l'`<a>` della scheda sembrava
  senza collegamento. Chi cerca un antenato a partire dal target usa
  `closestAcrossShadow` (risale, e quando la radice è uno shadow root riparte dal
  suo host), mai `closest` nudo. Specularmente, `document.elementsFromPoint()`
  di un componente restituisce **l'host**, mai quello che c'è dentro: con
  collegamento e anteprima impilati dentro lo stesso componente la ricerca si
  fermava al bordo e il link spariva. Chi guarda cosa
  c'è sotto il cursore usa `deepElementsFromPoint`, che per ogni elemento con uno
  shadow root ripete il colpo là dentro e mette le parti del componente PRIMA del
  loro host (è l'ordine in cui si vedono). Limite noto: uno shadow root `closed`
  resta opaco a entrambi.
- **Il riconoscimento del contesto sta in UN posto** (`detectContext`): il menu
  si apre da due strade (menu normale e menu di correzione) e con la ricerca
  copiata in tutt'e due lo stesso clic finiva col dare due menu diversi a seconda
  che sotto ci fosse o no una parola da correggere.
- **Una scheda, un argomento: il riquadro «Spiega» non cambia discorso a seconda
  del punto cliccato (#444).** Sulla stessa scheda — copertina dentro il
  collegamento, fascia del titolo stesa sopra il fondo — il riquadro descriveva
  l'immagine se il clic cadeva sulla copertina scoperta e analizzava il
  collegamento centoventi pixel più in basso, con le stesse identiche
  voci-azione: tre modi di cliccare la stessa cosa, due risposte diverse, e
  nessun modo per chi guarda di sapere quale gli toccherà. L'argomento è
  **l'elemento primario**, cioè quello le cui voci aprono il menu: se abbiamo
  adottato la copertina, il riquadro parla di lei, anche quando il clic è
  arrivato al collegamento. Sul filmato resta il collegamento — una spiegazione
  del filmato non esiste — ed è già così in tutti e tre i modi. L'argomento è
  scritto nell'item (`subject`) e finisce su `data-subject` del riquadro: è
  leggibile prima che la risposta sostituisca il testo d'attesa, e i test lo
  controllano di lì invece di fare la corsa con la rete.
- **Dove:** `buildContextualItems` (+ `buildImageActionItems`/`buildLinkActionItems`),
  `detectContext`, `findMedia`, `findUnder`, `findLinkUnder`, `sameSurface`
  (+ `swallows`, `coveredAt`, `paintsSomething`, `hasVisibleText`), `belongsTo`
  (+ `containsAcrossShadow`),
  `closestAcrossShadow` e `deepElementsFromPoint` in `src/content/content.js`, voci in
  `src/content/actions.js` (`subject` sugli item `inline`), reso da
  `src/content/menu.js`. Test: `tests/context-menu-media.spec.mjs`,
  `tests/context-menu-image-link.spec.mjs`,
  `tests/context-menu-media-link.spec.mjs`,
  `tests/context-menu-video-preview-link.spec.mjs`.

## Riquadri incorporati (iframe): Filo gira anche lì, ma un riquadro non è la pagina

Le pagine vere sono piene di riquadri di altri siti: un video dentro un articolo,
una mappa, un blocco commenti, un modulo. Sono `iframe`, e i preload girano nei
sottoframe **solo** con `nodeIntegrationInSubFrames` (attivo per le schede
esterne, MAI per le pagine `filo://`: lì un riquadro esterno erediterebbe il
preload privilegiato). Senza, dentro il riquadro Filo semplicemente non esiste —
il tasto destro non produce nulla, e per l'utente è un buco nero senza spiegazione
(#405).

Quattro regole quando si tocca qualcosa che vive nel content script:

- **Costo pigro.** Una pagina può avere decine di riquadri che l'utente non tocca
  mai. Nel sottoframe `page-preload.js` non carica NIENTE finché non arriva la
  prima interazione vera (tasto destro, clic, tasto premuto, una scorciatoia
  indirizzata a quel frame); il primo tasto destro viene **rigiocato** appena
  l'handler è pronto, così non serve cliccare due volte.
- **Frame vs pagina.** Ciò che riguarda l'ELEMENTO cliccato funziona identico nel
  riquadro. Ciò che riguarda la PAGINA no: colore della scheda, segnali di
  attività, banner cookie/sito pericoloso, avvisi di sistema, e le azioni globali
  del menu (traduci, condividi, salva, QR, screenshot, feedback, sidebar Aiuto).
  Quelle o restano al frame principale, o gli vengono **rimandate**
  (`MSG.RUN_IN_TOP_FRAME` → `MSG.TOP_FRAME_COMMAND`): eseguirle nel riquadro
  significherebbe condividere l'indirizzo del player invece dell'articolo, o
  disegnare un pannello a tutta superficie dentro un rettangolo di 300 px.
- **I frame non si parlano da soli.** Eventi del mouse e chiamate JS non
  attraversano il confine di un iframe di un'altra origine: ogni coordinamento
  passa dal main (chiusura dei menu degli altri frame, consegna dei suggerimenti
  ortografici nativi a `params.frame`, stream AI verso `event.senderFrame`,
  scorciatoie di selezione verso l'ultimo frame usato). `webContents.send`
  raggiunge **solo** il frame principale: per parlare a tutti serve
  `mainFrame.framesInSubtree`.
- **Un'azione di pagina che tocca il TESTO deve entrare nei riquadri** (#407).
  "Frame vs pagina" dice dove l'azione si esegue, non fin dove arriva: un post
  incorporato o un blocco commenti è testo che l'utente legge, e lasciarlo in
  lingua originale sotto un avviso "Pagina tradotta" è la bugia della
  segnalazione, in un caso più stretto. Il frame principale non può toccarlo (è
  un'altra origine), ma il content script gira già lì dentro: gli si passa
  parola, e ogni riquadro lavora su se stesso. Quattro conseguenze che si pagano
  se si saltano. **Il giro passa dal main**, non da `postMessage`: una postMessage
  la sa scrivere anche il sito, e si ritroverebbe a comandare un riquadro che non
  è suo; il main invece conosce l'albero dei frame e sa chi è il frame
  principale. **Il riquadro va svegliato**: per il costo pigro lì dentro non c'è
  ancora niente di montato, quindi il messaggio che lo comanda deve far partire
  `ensureContentScripts()` e farsi consegnare dopo (stesso cammino delle
  scorciatoie). **Chi non risponde entra nell'avviso**: un riquadro chiuso a
  chiave dal `sandbox` non ha script e non risponderà mai, e il conto dei
  riquadri che si VEDONO (grandi abbastanza da starci del testo) meno quelli che
  si sono fatti vivi è ciò che fa dire "una parte è rimasta fuori" invece di
  "fatto". E se si può tradurre lì dentro si deve poter tornare indietro lì
  dentro: il ritorno all'originale passa parola con lo stesso giro.
  **In un riquadro SENZA indirizzo il preload non entra affatto**, e questo si
  scopre solo provandolo: un `iframe` vuoto riempito dalla pagina stessa
  (`about:blank`, `srcdoc`) resta senza Filo dentro, e quasi tutti i riquadri
  pubblicitari nascono così. Lì non c'è nessuno a cui passare parola e nessuno
  che risponda, quindi due cose insieme: il documento lo legge chi ospita (è
  della stessa origine e `contentDocument` si apre), e quel riquadro esce dal
  conto di chi deve rispondere, o ogni pagina che ne ha uno si prenderebbe a
  torto l'avviso "una parte è rimasta fuori". Entrare così vale SOLO per i
  riquadri senza indirizzo: in quelli con un indirizzo vero il content script
  c'è e traduce da sé, e leggerli anche da fuori è pagare due volte.

Il menu si adatta anche allo spazio: se il riquadro è più basso del menu, il menu
diventa scorrevole invece di essere tagliato.

**Dove:** `_makeView` in `src/main/tabs.js`, `src/preload/page-preload.js`,
`IS_SUBFRAME` in `src/content/content.js` e `src/content/menuIcons.js`, ponte in
`src/main/services/handlers/nav.js`. Test: `tests/iframe-context-menu.spec.mjs`,
`tests/translate-page.spec.mjs`.

## Popup menu: il "submenu" è una voce a due zone che riapre il menu

Il popup menu custom (`src/main/popup-menu.js`, una BrowserWindow frameless)
non ha submenu a comparsa: quando una voce ha bisogno di un secondo livello
(es. la lista paesi di "Apri da un altro paese"), la voce dichiara `subAction`
e viene resa **a due zone di click** — il corpo esegue l'azione di default, la
freccia `›` a destra manda `subAction` al renderer, che **riapre il popup**
nello stesso punto con le voci del secondo livello.

- **Perché:** un hover-submenu richiederebbe una seconda finestra sincronizzata
  (posizione, blur, z-order) per un beneficio minimo; riaprire lo stesso popup
  è coerente, robusto e riusa tutto (stile, selezione, chiusura su blur).
- **Dove:** rendering in `buildHTML` (`.row` + `.subarrow`); esempio d'uso in
  `openTabContextMenu` / `openProxyCountryMenu` in `src/renderer/shell.js`.

## Icone: il popup della shell ha un registro SUO, cambiare `icons.js` non basta

Le icone di Filo vivono in **`src/shared/icons.js`** (`SN_ICONS`), ma il popup
menu della shell (menu App, menu tab, `src/main/popup-menu.js`) è una
BrowserWindow separata che **non carica quel file**: tiene una **copia** dei path
SVG in `ICON_PATHS`. Cambiare l'icona in `icons.js` lascia il popup sull'icona
vecchia, e la stessa cosa finisce disegnata in due modi diversi a seconda della
superficie (scoperto in #379.12: l'Editor mostrava il foglio-appunti nel menu
tasto destro e la vecchia penna nel menu App).

- **Regola operativa:** quando cambi (non solo quando aggiungi) un'icona in
  `icons.js`, cerca lo stesso nome in `ICON_PATHS` di `popup-menu.js` e
  allineala. Vale anche al contrario.
- **Come si testa:** confronta l'SVG **renderizzato** dalle due superfici invece
  di fidarti del sorgente — apri il popup e il menu tasto destro nello stesso
  spec e asserisci che l'`innerHTML` dell'`<svg>` coincida (esempio in
  `tests/audit-notes-visibility.spec.mjs`). Un assert "c'è un'icona" non vede la
  divergenza: entrambe le superfici *hanno* un'icona, semplicemente diversa.

## Feature opzionali nel menu: la voce compare solo se può funzionare

Una voce di menu che dipende da configurazione esterna (es. "Apri da un altro
paese" richiede un endpoint configurato) **non deve comparire** quando la
feature non è configurata — niente voci disabilitate o toast "configura prima
X" da un menu. Lo stato si chiede al main all'apertura del menu (è un IPC da
millisecondi), non si cachea alla partenza.

## Colore identità delle tab: brand del sito, mai chrome neutra

Il colore con cui si tingono le tab (attiva = "vetro smerigliato" §1.1; inattive
= tinta identità attenuata §1.2) deve rappresentare il **brand del sito**, non la
sua chrome neutra. Un `theme-color`/sfondo bianco, nero o grigio **non è
un'identità** e non va usato come tinta: in quel caso si ripiega sul **favicon**
(il segnale di brand più affidabile). Es: YouTube dichiara `theme-color` bianco
ma il suo brand è il rosso del favicon → la tab dev'essere rossa, non bianca.

- **Regola operativa:** un colore "conta" come identità solo se ha croma
  sufficiente (max−min dei canali RGB ≥ 24). La logica pura è in
  `src/shared/tabColor.js` (`SN_TAB_COLOR.hasIdentity`), unit-testata in
  `tests/unit/tabColor.test.mjs`. La catena di derivazione è
  `theme-color → manifest → favicon`, ma ogni anello neutro viene saltato.
- **Perché:** una tinta bianca/grigia è indistinguibile dal tab bar (tinta
  invisibile) o, per la tab attiva, dà un bianco senza significato. Il favicon
  porta quasi sempre il colore vero del sito.
- **Limite noto:** se il favicon è cross-origin senza header CORS, il canvas si
  "taint-a" e il colore non è estraibile → la tab resta neutra (meglio che
  sbagliata). I favicon same-origin (come YouTube) funzionano.
- **Dove:** campionamento in `src/content/pageColor.js` (catena `compute()`);
  applicazione/ripiego nella shell in `src/renderer/shell.js` (`render`,
  `hasColorIdentity`).
- **Parametri regolabili (6):** l'estrazione e il blend sono governati da sei
  parametri (`soglia_saturazione`, `peso_centralita`, `bucket_tinta`,
  `saturazione_tab`, `luminosita_tab`, `opacita_tab`). La **fonte di verità** di
  default/range/etichette/commenti è **una sola**: `IDENTITY_PARAM_META` in
  `src/shared/tabColor.js` (con `defaultParams()`/`clampParams()`). I primi
  cinque (`stage:'extract'`) sono passati a `extractIdentityFromPixels`; il
  sesto (`opacita_tab`, `stage:'blend'`) è la frazione di tinta nel `color-mix`
  della shell. I valori vivono in `settings.tabColor`; `DEFAULT_SETTINGS` in
  `constants.js` deve restare allineato ai default del meta.
- **Due strade per cambiarli (parità di cammini):** (1) **a voce in chat** — il
  setter `colore_tab` in `src/shared/preferences.js` mappa richieste verbali
  ("più vivaci"/"più neutre"/"nessuno"/"più preciso"/"predefinito") su preset
  **assoluti** dei parametri (non delta: il setter non vede lo stato corrente);
  (2) **Preferenze avanzate** — la "zona codice" numerica (stesso stile dei token
  estetici) in `src/pages/preferences/`. Entrambe scrivono via `UPDATE_SETTINGS`,
  che fa **deepMerge** su `tabColor` (un preset parziale lascia intatti gli altri
  parametri) e ribroadcast `SETTINGS_UPDATED`: il content **ri-estrae** il colore
  del favicon coi nuovi parametri e la shell **ri-renderizza** il blend, live.
- **Quando aggiungi/cambi un parametro:** toccalo SOLO in `IDENTITY_PARAM_META`
  (più il default speculare in `constants.js`); UI prefs, validazione e mapping a
  voce lo ereditano. Niente slider per questi: sono valori numerici espliciti.

## Evidenziare testo sulla pagina: CSS Custom Highlight API, mai wrappare in `<span>`

Per evidenziare testo su una pagina ESTERNA (es. la parola letta dalla lettura
ad alta voce) si usa la **CSS Custom Highlight API** (`CSS.highlights` + `Highlight`
+ Range, stilati via `::highlight(nome)`), **non** si avvolgono le parole in
`<span>`. Avvolgere muterebbe il DOM della pagina ospite: rompe il layout, scatena
reflow e si scontra con i framework (React rigenera i nodi). La Highlight API
dipinge sopra senza toccare l'albero.

- **Funziona dal mondo isolato del content script:** un `CSS.highlights.set(...)`
  fatto nel mondo isolato del preload **viene dipinto sul documento** ed è visibile
  anche dal mondo principale della pagina (il registro è a livello documento, non
  per-realm) — verificato in `tests/tts-highlight.spec.mjs`. Lo `::highlight()`
  però va in uno stylesheet del documento: lo si inietta come `<style>` con un
  fallback letterale sul token (`var(--sn-accent,#c45a3b)`) così rende anche su
  pagine senza il theme.css di Filo.
- **Disponibilità:** Electron 33 (Chromium ~130) la supporta; fai comunque
  feature-detect (`CSS.highlights && typeof window.Highlight === 'function'`) e
  degrada silenziosamente (la feature audio resta, salta solo l'evidenziazione).
- **Dove:** controller in `src/content/tts.js` (`ensureReadStyle`, `setHighlight`,
  `buildReadModel` tokenizza la selezione in Range-parola).

## Riscrivere il testo di una pagina esterna: niente whitelist di tag, e si spostano i NODI

Quando Filo sostituisce del testo su una pagina che non è sua (oggi: "Traduci la
pagina") valgono due regole imparate a caro prezzo con #407.

- **Cosa toccare non lo decide il tag.** Una lista di tag "di prosa"
  (`p/li/h1…/figcaption`) più lo scarto dei sottoalberi `nav/header/aside/form`
  sembra ragionevole e invece **lascia fuori metà pagina**: sui siti moderni il
  testo sta in `div`/`span` generici, il titolo è dentro `<header>`, i riquadri
  "Leggi anche" dentro `<aside>` e le voci di menu sono link. La regola giusta è
  l'opposta: **prendi ogni elemento che ha un text node come figlio DIRETTO** e
  scarta solo ciò che non è prosa (script/media/`pre`/`code`, campi di testo,
  `[translate="no"]`, `.notranslate`, `contenteditable`, elementi nascosti e la
  UI di Filo stessa, riconoscibile dal **marchio** che si mette da sé). Così ogni
  pezzo di testo appartiene a **una sola** unità (niente doppie sostituzioni) e
  anche il testo dentro i link diventa una unità sua invece di restare un
  segnaposto intoccato.
- **Rimonta spostando i nodi originali, non re-inserendo HTML.** I figli
  dell'unità diventano segnaposto `[[Lk]]` nel testo mandato al modello e
  tornano al loro posto come **nodi vivi**: re-parsare l'`outerHTML` creerebbe
  nodi nuovi e butterebbe via listener, stato dei componenti e i figli già
  tradotti. Il testo del modello entra come **text node** (mai `innerHTML`):
  niente escaping da ricordare, niente HTML del modello nella pagina. Corollari:
  i figli che il modello "dimentica" di richiamare vanno **riappesi in fondo**
  (mai perdere contenuto), e l'annullamento (`Mostra originale`) ripristina la
  **lista di nodi originali** tenuta in memoria, non una stringa HTML salvata in
  un attributo (che, con unità annidate, conterrebbe già la traduzione dei figli).
- **Metà del testo che si legge non sta nel testo: sta negli ATTRIBUTI.** Il
  grigio dentro un campo di ricerca (`placeholder`), il suggerimento che compare
  fermando il mouse (`title`), la descrizione di un'immagine (`alt`),
  l'etichetta di una voce di menu a tendina, `aria-label`. Lasciarli in lingua
  originale sotto un avviso "Pagina tradotta" è la stessa bugia dei blocchi
  saltati: si vede a occhio che il lavoro non è finito. La riga di confine è
  **si legge / si rimanda indietro**: si traduce ciò che l'utente LEGGE, mai ciò
  che il sito INVIA (`value` di un campo, voci di un `datalist`, `href`,
  `name`). La riga passa **in mezzo agli `<input>`**: la scritta su un bottone è
  il suo `value`, e quel valore entra nei dati del modulo solo se il bottone ha
  un `name` — quindi un bottone che azzera il modulo, o che apre qualcosa nella
  pagina, o un invio senza `name` si traduce, un invio con `name` no. Corollario
  pratico: la voce di un menu a tendina si traduce
  **scrivendo l'attributo `label`**, mai sostituendone il testo — il testo di una
  `<option>` senza `value` è proprio ciò che il modulo invia, e il browser mostra
  `label` quando c'è. Conseguenza sul filtro dei sottoalberi: "qui non c'è prosa"
  (`script`, `video`, un campo di testo) e "qui non si tocca niente"
  (`translate="no"`, nascosto, `contenteditable`, la UI di Filo) diventano **due
  motivi diversi** di saltare: nel primo il contenuto resta intoccato ma le
  etichette si traducono lo stesso.
- **Il testo della pagina non finisce col `<body>`.** Il nome della scheda in
  alto (`document.title`) resta sotto gli occhi per tutto il tempo, e su una
  pagina per il resto tutta tradotta era l'ultima riga in lingua originale.
  Entra nella stessa coda di lavoro come un'unità sola, si applica scrivendo
  `document.title` (Electron rilancia `page-title-updated` e la scheda si
  aggiorna da sé) e va **marcato** come tutto il resto: senza
  `data-sn-translated` sul `<title>`, la sentinella del testo nuovo scambia la
  nostra stessa scrittura per testo appena arrivato dal sito e l'avviso finale
  annuncia roba nuova che non c'è.
- **Il messaggio finale deve dire la verità**: "fatto" solo se tutte le unità sono
  state sostituite, "solo in parte" se qualcuna è rimasta indietro, e un avviso
  esplicito quando non c'è **niente** da tradurre — il silenzio fa ritentare
  l'utente all'infinito. L'avviso "sto lavorando" di un'operazione lunga si apre
  con `showToast(testo, { duration: 0 })` e si **chiude** con l'handle restituito
  quando arriva l'esito: i toast delle pagine non si impilano, si sovrapporrebbero
  nello stesso angolo diventando illeggibili.
- **Anche l'avviso onesto deve essere vero: "solo in parte" vuole una PROVA, non
  prudenza.** Un "è rimasto fuori qualcosa" che scatta a vuoto manda l'utente a
  cercare del testo in lingua originale che non esiste, e brucia la credibilità
  dell'avviso per le volte in cui è vero: sbagliare "dalla parte della prudenza"
  non è gratis. Concretamente, per dire che il contenuto di un componente del
  sito è illeggibile non basta che l'elemento sia vuoto e abbia il trattino nel
  nome (un separatore o uno spaziatore disegnato in CSS è fatto così): servono
  segnali positivi — che il sito l'abbia davvero **registrato** (`:defined`,
  interrogabile sul DOM anche da un altro mondo JS, al contrario del registro dei
  componenti) e che lì dentro qualcosa sia **disegnato e irraggiungibile** (sopra
  un elemento vuoto il punto d'inserimento del cursore cade sull'elemento stesso,
  sopra un componente chiuso viene rimbalzato fuori).
- **"Non lo so" non è "sì": dove la prova non si può fare, si tace.** Una prova
  che si appoggia al cursore vale solo dentro lo schermo e solo su ciò che i clic
  non attraversano — cioè quasi mai: qualsiasi pagina più lunga di una schermata
  ha roba sotto il bordo, e le decorazioni sono quasi tutte `pointer-events:none`.
  Contare quel "non lo so" come prova rovescia la bugia invece di toglierla: la
  pagina è tutta tradotta e l'avviso manda comunque a cercare dell'inglese che non
  c'è. Il prezzo giusto è l'altro: un avviso in meno quando il pezzo illeggibile
  sta fuori portata. **Un avviso mancato costa uno; un avviso falso li svaluta
  tutti.** Vale per qualunque diagnosi appoggiata alla geometria della finestra
  (`elementFromPoint`, `caretPositionFromPoint`, il rettangolo visibile): il
  risultato "indeterminato" va tenuto separato dal risultato negativo, e trattato
  come tale fino in fondo. Corollario: se tacere costa, **conviene insistere solo
  dove la risposta manca**. La sonda riprova su altre righe dell'elemento quando
  la prima non ha risposto (una barra fissa che lo taglia a metà), e si ferma
  appena una risposta arriva: righe in più non devono poter ribaltare un esito
  già certo, o la sonda diventa una votazione.
- **"È roba mia" si MARCA alla nascita, non si indovina dal nome.** Chi cammina
  su una pagina che non è sua deve saltare la UI che Filo ci ha disegnato dentro
  (menu, avvisi, popup, riquadri di conferma): è già nella lingua dell'utente, e
  tradurla vuol dire pagare il modello per riscrivere il proprio menu.
  Riconoscerla dal nome — una classe che comincia per `sn-`, un id che comincia
  per `filo-` — **sbaglia su siti veri**: i portali costruiti con ServiceNow
  chiamano `sn-qualcosa` ogni loro pezzo, e "filo" è una parola italiana normale
  in un nome. Il prezzo dell'errore non è simmetrico: un riquadro del sito
  scambiato per nostro resta intero in lingua originale **sotto un avviso che
  dichiara la pagina tradotta**, e nessun conteggio se ne accorge (il pezzo
  saltato non è "rimasto fuori": è come se non esistesse). La regola è
  `SN_FILO_UI.mark(el)` sulla **radice** di ogni pezzo di UI che attacchiamo al
  documento, nella stessa funzione che la crea, e `SN_FILO_UI.is/inside` come
  unica risposta alla domanda "chi l'ha disegnato". Un attributo (`data-sn-ui`),
  non una classe: le classi le riscrive anche il sito. Vale per chiunque
  cammini sulla pagina, non solo per la traduzione — la sentinella del testo
  nuovo usa lo stesso marchio, o scambia i nostri avvisi per roba appena
  arrivata dal sito.
- **L'etichetta gemella si copia, non si ricompra.** Un link col suggerimento
  del mouse uguale al proprio testo, un bottone a sola icona con l'etichetta di
  accessibilità ripetuta: sono dappertutto (sulla home di un giornale sono
  decine di frasi). Mandare al modello due volte la stessa frase costa il doppio
  e sullo schermo non cambia niente. Quando il valore dell'attributo è identico
  al testo che l'elemento MOSTRA, l'unità non si spedisce: si applica dopo,
  copiando il `textContent` appena tradotto (che può venire da un figlio —
  `<a title="…"><span>…`). Due dettagli che tengono onesto il conto: se il
  testo non è cambiato (richiesta fallita) l'etichetta **non** si marca come
  fatta, così la ripresa ci riprova; e la copia non entra fra le unità del giro,
  perché non è lavoro rimasto fuori.
- **Dove:** `extractTranslatableBlocks` in `src/content/extractContext.js`
  (`extractMainTextNodes`, accanto, resta la versione "solo l'articolo" per
  l'excerpt del categorizer: sono due domande diverse); applicazione e ripristino
  in `src/content/translatePage.js`. Test `tests/translate-page.spec.mjs`.

## Operazione a chunk che può fallire a metà: tre stati, ripresa, avviso onesto

Un lavoro spezzato in N richieste al modello (traduzione di pagina, e in futuro
qualsiasi elaborazione lunga applicata al DOM) **fallisce quasi sempre a metà**,
non del tutto: la rete cade al terzo pezzo, il credito finisce a metà strada. Il
booleano "fatto / non fatto" è quindi il modello di stato sbagliato — mente
all'utente e gli fa buttare (e ripagare) il lavoro già riuscito.

- **Tre stati, non due**: assente / **parziale** / completa. Il menu offre azioni
  diverse nei tre casi ("Traduci" / "Riprendi traduzione" / "Mostra originale").
- **Su una pagina viva, "completa" scade.** I siti che si allungano scorrendo e
  quelli che cambiano schermata senza ricaricare aggiungono testo DOPO che il
  lavoro si è dichiarato finito: se il menu in quello stato offre solo il ritorno
  all'originale, l'unico modo di tradurre tre righe nuove è buttare (e ripagare)
  l'intera pagina. Serve un quarto stato — **completa ma con roba nuova** → "Traduci
  il testo nuovo" — che riusa la stessa ripresa. Accorgersene costa una
  `MutationObserver` che alza soltanto un flag (l'apertura del menu deve restare
  istantanea: niente scansioni lì dentro); il conto vero lo rifà la traduzione,
  che rilegge la pagina e salta ciò che è già marcato. L'osservatore ignora la UI
  di Filo iniettata nella pagina (prefisso `sn-`) e non ha bisogno di staccarsi
  mentre traduciamo: le nostre sostituzioni nascono **già marcate**
  (`data-sn-translated` scritto nella stessa esecuzione in cui si sostituiscono i
  figli), quindi il filtro le scarta da sé.
- **Il testo arrivato DURANTE il lavoro conta come quello arrivato dopo.**
  Scorrere mentre si aspetta è il comportamento normale: se la sorveglianza parte
  solo a lavoro finito, quelle righe non le vede nessuno e l'avviso finale
  dichiara tradotta una pagina che sotto gli occhi è mezza in lingua originale.
  Sorvegliare **da prima di cominciare** e rifare un giro (con un tetto: su un
  sito che carica all'infinito rincorrerlo non finirebbe mai) costa solo il testo
  nuovo, perché la rilettura salta ciò che è già marcato. Se dopo il tetto ne è
  arrivato dell'altro, lo dice e lascia la voce di menu.
- **"Nascosto adesso" non è "da non tradurre mai".** Una fisarmonica chiusa, una
  scheda in secondo piano, un "leggi tutto" ripiegato: quel testo non si traduce
  (l'utente potrebbe non aprirlo mai, e lo pagherebbe), ma i sottoalberi saltati
  **per motivi di visibilità** si segnano a parte — sono un motivo di salto
  diverso da `translate="no"`/UI di Filo. Quando uno di quelli torna visibile, per
  chi guarda lo schermo è identico al testo che il sito ha appena aggiunto, e il
  menu deve offrire la stessa cosa: "Traduci il testo nuovo", non "butta via
  tutto e ricomincia".
- **Un lavoro lungo si deve poter fermare, e fermarlo deve durare.** Mentre la
  traduzione lavora l'icona del menu è il **ritorno all'originale** (prima lì
  c'era "Traduci la pagina", che a lavoro in corso non faceva niente: un vicolo
  cieco). E il ritorno indietro deve reggere contro le richieste già spedite: un
  **numero d'ordine del giro** sulle unità di lavoro fa buttare via le risposte in
  volo, invece di lasciarle ricadere sulla pagina qualche secondo dopo e
  ritradurla a metà. E l'avviso "sto lavorando" si chiude **nell'istante** in cui
  l'utente ferma, non quando le richieste già spedite si decidono a tornare. Un
  riquadro "in corso" accanto a "annullata" gli dice che nessuno l'ha ascoltato.
  Quindi l'handle dell'avviso di avanzamento vive dove arriva anche
  l'annullamento, non solo dentro la funzione che lavora. Vale per qualsiasi
  lavoro asincrono annullabile, non solo qui.
- **La ripresa non ripaga ciò che è già fatto**: i pezzi conclusi si marcano nel
  DOM (`data-sn-translated`) e si escludono **prima** di costruire le richieste,
  non dopo aver ricevuto la risposta. Escluderli dopo significa pagare due volte
  gli stessi token.
- **Saltare il pezzo fatto, non il suo sottoalbero**: nel walker di estrazione un
  elemento già elaborato è `FILTER_SKIP`, mai `FILTER_REJECT`. Con REJECT i
  blocchi *annidati* che l'interruzione non ha ancora toccato diventano
  irraggiungibili e nessuna ripresa può più completarli.
- **L'avviso dice a che punto si è fermato e perché**: "interrotta dopo X di Y" +
  la frase di `SN_CHAT_ERRORS` (la regola "mai il messaggio grezzo" vale per i
  toast di pagina esattamente come per le bolle di chat) + come riprendere. Mai
  un messaggio di successo su un lavoro monco.
- **"Il modello ha risposto a vuoto" non è un errore, ed è un motivo a sé.** La
  richiesta è partita, la risposta è tornata, semplicemente non conteneva testo:
  fabbricare un `Error` per farla passare da `SN_CHAT_ERRORS` produce "Qualcosa è
  andato storto. Riprova", che non dice niente e contraddice la riga successiva,
  dove si spiega come riprendere. Il ripiego per l'errore mancante esisteva già
  ("alcuni blocchi sono tornati vuoti dal modello"): la risposta vuota deve
  arrivarci, non scavalcarlo. In generale: prima di tradurre un guasto in una
  frase, chiedersi se un guasto c'è stato davvero.
- **Se l'icona cambia mestiere, l'azione che ha lasciato scoperta torna come
  voce**: nello stato parziale l'icona serve a riprendere, quindi "Mostra
  originale" compare come voce etichettata del menu (stesso schema di
  "Interrompi lettura", che appare solo mentre la sintesi è in corso).
- **Avanzamento reale mentre lavora**: il totale dei pezzi è noto, quindi
  l'avviso "in corso" mostra `fatti/totale` invece di una frase fissa.
- **Dove:** `src/content/translatePage.js` (stato + ripresa),
  `src/content/extractContext.js` (`extractTranslatableBlocks`),
  `src/content/menuIcons.js` + `src/content/content.js` (menu). Test:
  `tests/translate-page.spec.mjs`, `tests/verify-407-stress.spec.mjs`.

## Sintesi vocale/operazioni a modello lente: spezza in chunk + cache, non un colpo solo

Il modello TTS (Gemini) sintetizza TUTTO l'audio prima di rispondere: su testo
lungo l'attesa iniziale è di parecchi secondi. Il pattern per le operazioni a
modello con latenza che cresce con l'output è **spezzare in pezzi piccoli e fare
pipeline**: sintetizza/elabora il PRIMO pezzo corto e usalo subito, mentre i
successivi si preparano in parallelo (concorrenza limitata: corrente + successivo
in volo). Il tempo prima del primo risultato crolla; il modello non diventa più
veloce, ma l'utente smette di aspettarlo tutto.

- **Affianca SEMPRE una cache** keyed sul contenuto (qui `sha1(model|voce|testo)`):
  rifare lo stesso pezzo dev'essere istantaneo. Per artefatti GROSSI (audio) la
  cache è **in-memoria, limitata per byte** (`src/shared/ttsCache.js`), NON
  `chrome.storage`/`storage.json` (lo gonfierebbe e rallenterebbe ogni I/O di
  storage — diversamente da `aiCache.js` che cachea solo testo).
- **Logica pura testabile a parte:** il chunking e la mappa avanzamento→posizione
  vivono in `src/shared/ttsChunk.js` (unit test `tests/unit/ttsChunk.test.mjs`),
  così non serve aprire Electron per verificarli.
- **Dove:** pipeline in `src/content/tts.js` (`readAloud`), cache+hash
  nell'handler `MSG.TTS_SYNTH` in `src/main/services/handlers/ai.js`.

## Grafici/chart: SVG generato a mano, niente librerie esterne

I grafici (es. la torta del consumo nella pagina Crediti) si disegnano come
**SVG costruito a mano nel DOM**, una `<path>`/`<circle>` per fetta — niente
librerie di charting.

- **Perché:** la CSP delle pagine filo:// è `script-src 'self' filo:` (niente CDN,
  niente eval); aggiungere una lib di chart bundlata contraddice la filosofia
  minimale. Una torta sono ~15 righe di trigonometria.
- **Testabilità:** ogni fetta porta un `data-group="<nome>"` (e l'item di legenda
  lo specchia) così uno spec Playwright può asserire *quali* fette esistono e i
  valori, non solo che "c'è un grafico". Con una sola categoria disegna un
  `<circle>` pieno (l'arco 0→2π collasserebbe).
- **Colori:** palette fissa scelta per restare distinguibile su tema chiaro E
  scuro (i token `--sn-*` da soli non bastano: servono N colori distinti). Tutto
  il resto (testo, bordi) resta su token di tema.
- **Dove:** `src/pages/credits/credits.js` (`drawChart`/`slicePath`/`drawLegend`),
  icona moneta in `src/shared/icons.js` (`credits`). Test `tests/credits-page.spec.mjs`.

## Animazioni che coprono la pagina: vivono nel content overlay, non nella shell

Le animazioni celebrative o gli overlay che devono coprire **l'area pagina**
(es. le monete che "volano" dopo una ricompensa) si disegnano nel **content
script / overlay della pagina**, non nella shell.

- **Perché (vincolo architetturale non ovvio):** la shell (`src/renderer/`)
  renderizza **solo la barra in alto**; tutta l'area pagina è una
  **WebContentsView nativa** sovrapposta. Un elemento DOM disegnato dalla shell
  nell'area pagina sarebbe **occluso** dalla view nativa. Quindi ciò che deve
  apparire sopra la pagina va creato nel mondo del content script (che vive
  *dentro* quella view), con `position: fixed` e uno `z-index` altissimo.
- **Come:** layer transitorio appeso a `document.documentElement`, animato con
  la **Web Animations API** (`element.animate`, niente CSS keyframes da iniettare
  né lib), che si **auto-rimuove** a fine animazione. Rispetta sempre
  `prefers-reduced-motion` (salta il volo, lascia al più l'etichetta).
- **Bersaglio "profilo/account":** l'icona profilo non sta nella shell (la barra
  chrome è nascosta) ma nella home; per un'animazione che parte da una pagina
  qualsiasi, puntare all'**angolo in alto a destra** della viewport è la
  direzione coerente del profilo.
- **Testabilità:** dai al layer una classe stabile (`.sn-fb-credit-fly`) così uno
  spec può osservarne la comparsa con un `MutationObserver` anche se si rimuove
  dopo ~1s. L'effetto vero (es. saldo +5) si asserisce a parte.
- **Dove:** `src/content/feedback.js` (`flyCredits`). Test
  `tests/feedback-credit-reward.spec.mjs`.
- **Variante "home":** quando l'animazione parte da una pagina filo:// (es. il
  popup ringraziamento C5 nella dashboard), l'icona profilo è un **elemento DOM
  reale** (`accountCtrlBtn`): punta al **centro del suo `getBoundingClientRect()`**
  invece che all'angolo. Stesso resto (Web Animations API, auto-rimozione,
  `prefers-reduced-motion`). Dove: `dashboard.js` (`flyCreditsToAccount`).

## Popup d'avvio della home: incatenali, non sovrapporli

La dashboard può avere **più popup all'avvio** (recap aggiornamento C4,
ringraziamento feedback risolto C5). Mostrarli insieme li impila e confonde.

- **Sequenza, non stack:** il primo popup riceve un callback `onClose`; il
  secondo parte **alla chiusura** del primo, o **subito** se il primo non compare.
  In `dashboard.js`: `maybeShowUpdateRecap(onClose)` ritorna `true`/`false` (se ha
  mostrato il recap) e invoca `onClose` quando l'utente lo chiude; l'init fa
  `if (!shown) await maybeShowFeedbackRewards()`.
- **Side-effect una volta sola:** un popup che *accredita crediti* va calcolato
  lato main con un anti-doppio-premio persistente (`rewardedFeedback` nel doc
  credits), non lato UI. Così se l'init rigira (reload, seconda apertura) non
  ripaga. Attenzione nei test: l'`init` chiama l'handler in modo asincrono — se
  semini lo stato *durante* quel volo, premi prima del previsto. Lascia decantare
  l'init iniziale (es. `waitForTimeout`) prima di seminare, poi `reload`.
- **Dove:** `dashboard.js` (`renderFeedbackRewards`, `maybeShowFeedbackRewards`).
  Test `tests/feedback-resolved-reward.spec.mjs`.

## Stack di overlay impilati: limita il numero e non superare mai il viewport

Qualsiasi contenitore che **impila elementi nell'angolo** (toast/notifiche in
basso a destra, e in futuro simili) deve avere **due argini**, altrimenti una
raffica di eventi (es. una tempesta di popup bloccati, o il ripristino con molte
schede su siti in blacklist) lo fa crescere all'infinito: le card più vecchie
finiscono **fuori dal viewport** insieme al loro tasto di chiusura, diventando
irraggiungibili.

- **Tetto al numero** di card vive contemporaneamente: quando ne arriva una che
  sfora, rimuovi subito la più vecchia (non aspettare il suo timeout). Tieni le
  **più recenti** (le più rilevanti in una raffica). In una raffica estrema le
  azioni delle notifiche più vecchie (es. «Apri comunque») si perdono: è un
  compromesso accettabile — l'utente può rifare l'azione, e il contrario
  (schermo coperto, X fuori campo) è peggio.
- **Tetto all'altezza:** `max-height: calc(100vh - margini)` + `overflow-y:auto`
  come rete di sicurezza per finestre molto basse, dove anche il piccolo gruppo
  non entrerebbe. Quando c'è overflow, tieni in vista la card più recente
  (`scrollTop = scrollHeight`) e attiva `pointer-events` sul contenitore (con
  `pointer-events:none` di base non si potrebbe afferrare la scrollbar; una
  classe `.scrolling` la riabilita solo quando serve, così le aree vuote
  continuano a lasciar passare i click al contenuto sotto).
- **Mai UN solo elemento riusato.** Un contenitore-avviso singolo che si riazzera
  a ogni messaggio distrugge il contenuto precedente **insieme ai suoi bottoni**:
  un'azione offerta lì (un "Annulla") può sparire prima che l'utente la prema, e
  basta un avviso che arriva da solo per farla evaporare. Ogni avviso è una card
  con il SUO timer; il tetto sopra tiene la crescita sotto controllo.
- **Tronca i dati che vengono da fuori.** Il testo di un avviso spesso contiene
  una stringa che decide qualcun altro (il nome file che manda il server, il
  titolo di una pagina): senza un tetto, una card sola diventa un muro di testo
  che copre lo schermo — il tetto al *numero* di card non basta. Accorcia **in
  mezzo** (`inizio…estensione`), così resta leggibile sia l'inizio sia il pezzo
  che dice di cosa si tratta. Vedi `shortName()` in
  `src/main/services/downloads.js`, test `tests/unit/downloadNames.test.mjs`.
- **UN contenitore per angolo, non uno per avviso.** Ogni riquadro ancorato con
  `position: fixed` allo stesso angolo è cieco rispetto agli altri: due che
  compaiono a pochi secondi l'uno dall'altro si disegnano nello stesso punto e
  non se ne legge nessuno (#409). Vale anche fra **famiglie diverse** di avviso:
  un toast, una pill interattiva e una conferma cliccabile che condividono
  l'angolo devono condividere anche la pila. Il caso più frequente non è nemmeno
  l'utente che fa due cose di fila: è **un'azione sola** che mostra prima
  «sto lavorando» e poi l'esito.
- **Non tutti gli avvisi sono sfrattabili.** Il tetto butta via i più vecchi, ma
  un avviso che porta **l'unico comando** per una cosa in corso (fermare una
  registrazione, raggiungere la lista dove è appena finita una pagina) va marcato
  come non sfrattabile: perderlo non è "un messaggio in meno", è una funzione che
  sparisce a metà.
- **⚠️ `overflow` + animazione d'ingresso = falso overflow, e uno `scroll`
  parassita.** Se le card entrano con `transform: translateY(Npx)`, quello sposto
  allarga l'area scrollabile del contenitore: `scrollHeight > clientHeight`
  risulta vero anche con una card sola, il contenitore si dichiara "in overflow",
  riaccende i `pointer-events` (una zona morta sopra la pagina) e — assegnando
  `scrollTop` — **emette un evento `scroll`**. Chi ascolta lo scroll in capture su
  `window` (il menu del tasto destro: `src/content/menu.js`) lo legge come "la
  pagina si è mossa" e **si chiude da solo**. Confronta con una tolleranza pari
  allo sposto d'ingresso e scrivi `scrollTop` solo se cambia davvero.
- **Dove:** `NOTIFS` (`enforceCap`/`syncOverflow`) in `src/renderer/shell.js`;
  `.shell-notifs` in `src/renderer/shell.css`. Test
  `tests/notifications.spec.mjs` (la raffica non straripa e resta chiudibile).
  Stesso pattern nell'editor: `showEditorToast`/`.ed-toasts` in
  `src/pages/editor/editor.{js,css}`, test `tests/editor-trash.spec.mjs`.
  Lato **pagina visitata** (content script): `mountToast`/`unmountToast` +
  `.sn-toasts` in `src/content/popup.js` e `src/styles/popup.css` — ci passano
  toast, `.sn-dictate-pill` e `.sn-save-confirm`. Test `tests/toast-stack.spec.mjs`.

## Un cancello automatico che blocca deve avere una via d'uscita, e la via d'uscita è una PERSONA

Un controllo deterministico che dice di no a un caso legittimo — e lo dice
spesso — non è una difesa stabile: è una difesa che prima o poi qualcuno
smonta, perché il lavoro deve pur passare. Il controllo di sicurezza sulle
fusioni (L5) blocca chi tocca guardie, automatismi, regole del database e
chiavi; il lavoro locale dell'owner ci cade dentro quasi sempre, perché in
locale si lavora proprio su quelle cose (§10 di `SPEC-RIDISEGNO-MAX.md`).

La forma giusta non è indebolire il controllo né aggiungere un permesso a chi
chiede, ma **spostare la decisione su una superficie diversa da quella da cui
è partita la richiesta**:

- **Il blocco apre una RICHIESTA IN ATTESA, non un rifiuto secco.** Chi ha
  chiesto riceve "l'ho messa in attesa, ecco dove approvarla" — mai un "decidi
  tu cosa farne" che non nomina nessuna mossa possibile.
- **Approvare richiede un gesto umano su un'altra superficie.** Il terminale
  (dove gira un LLM che legge testo di sconosciuti) può chiedere quanto vuole:
  resta in attesa. Il click nella finestra dell'app non lo può dare una
  sessione catturata. È questo — non la fiducia in chi chiede — a rendere
  l'eccezione accettabile.
- **Due invarianti non negoziabili, e una scadenza che non è una di loro.**
  Reggono l'eccezione: si applica solo a ciò che è stato ESAMINATO (si registra
  lo `sha`, e si fonde quello, non "il ramo"; se il ramo si muove la richiesta
  decade), e vale **una volta sola** (la presa è una transazione, così due
  click non passano entrambi). Nessuna delle due si indebolisce col tempo.
- **La scadenza è comodità, non difesa: tararla come tale.** Era di mezz'ora,
  contro l'"approvo a memoria" — ma a quello risponde già la scheda, che dice
  cosa è stato bloccato: chi approva non deve ricordare, deve **leggere**. Il
  costo invece era vero: rifare la richiesta costa un giro di controlli intero
  (~15 minuti), e sul campo la prima è scaduta prima che l'owner riuscisse a
  cliccare. Ora è di 24 ore. **Regola generale:** una scadenza corta si paga
  con quanto costa rifare la cosa scaduta — se il costo è alto e la sicurezza
  che aggiunge è zero, è solo un modo per far smontare la difesa.
- **Chi approva deve leggere COSA sta scavalcando, in parole sue.** Le frasi
  che traducono i controlli scattati vivono dove vive la tabella dei controlli
  (il server privato) e viaggiano col dato: ricopiarle nel client le farebbe
  divergere, e un controllo nuovo comparirebbe come voce muta. Un blocco senza
  frase si mostra comunque col suo nome grezzo — nascondere una voce
  dell'elenco fa approvare più di quel che si crede. Vale anche per **chi ha
  chiesto**: su una superficie che esiste per separare chi chiede da chi
  approva, tacerlo le toglie metà del senso (e un identificativo tecnico non si
  stampa — si dice cosa significa).
- **Un'eccezione lascia traccia** dove l'owner la può guardare (chi, cosa,
  quando, quali blocchi scavalcati), non solo nei log del server.
- **Dove:** decisione pura + I/O in `filo-security/functions/src/routine/
  mergeApprovals.js`; avviso condiviso in `src/shared/mergeApprovals.js` +
  `src/styles/mergeApprovals.css`; campanello in
  `src/main/services/mergeApprovalSignal.js`. Test:
  `functions/test/routine-merge-approvals.test.js`,
  `tests/unit/mergeApprovals.test.mjs`,
  `tests/unit/mergeApprovalSignal.test.mjs`, `tests/merge-approvals.spec.mjs`.

## "Vai a guardare in quell'altro posto": quel posto deve accorgersene DA APERTO

Quando una superficie manda l'utente su un'altra (il terminale che dice
"approvala dalla dashboard di gestione"), la seconda è quasi sempre **già
aperta** — la pagina di gestione lasciata lì in una scheda. Se carica
il suo elenco solo all'apertura, l'avviso compare soltanto a chi pensa di
riaprirla: cioè a nessuno. È successo il giorno stesso in cui l'indicazione è
stata scritta.

- **Chi PRODUCE l'evento lo dice; nessuno chiede a ripetizione.** Se il
  produttore gira sulla stessa macchina (qui `npm run finish`), gli basta
  scrivere un file in un punto che main e script calcolano **allo stesso modo**
  (`FILO_USER_DATA` nei test, la cartella temporanea fuori — mai il percorso
  dell'app: uno script Node non sa come si chiama). Il main guarda la
  **cartella** dedicata, non il file (che può ancora non esistere) e non la
  cartella temporanea intera (si sveglierebbe a ogni file del sistema).
  Costo a riposo: zero. Se i due percorsi divergessero, il campanello non
  suonerebbe **in silenzio** — per questo il calcolo sta in un posto solo, con
  uno unit test sopra.
- **La rilettura la fa il MAIN, non ogni pagina.** Una lettura sola con dieci
  schede aperte, il cancello del proprietario in un punto solo, e il dato
  viaggia **dentro** il messaggio di broadcast: la pagina ridisegna senza
  richiedere niente.
- **Un broadcast che porta dati dell'utente va SOLO alle pagine `filo://`**
  (`broadcastToFiloPages`, il gemello di `broadcastToTabs`): `broadcastToTabs`
  raggiunge anche il content script del sito visitato. È il gate d'origine
  visto dal verso opposto — se un sito non lo può *chiedere*, non glielo si
  manda nemmeno da soli.
- **Rete di sicurezza guidata da una persona, non da un orologio.** Il
  campanello può mancare (app chiusa quando è arrivato l'evento, cartella
  ripulita, un domani un produttore remoto). Il ripiego è il **rientro nella
  finestra** (`browser-window-focus`, e solo la finestra vera: il popup dei menu
  è una BrowserWindow sua e ogni menu conterebbe come un rientro), con un
  intervallo **largo** — cinque minuti: il caso vero lo copre già il campanello,
  quindi la rete non deve costare. Chi resta sulla pagina per ore non genera
  nemmeno una chiamata. Un intervallo fisso invece paga sempre, soprattutto
  quando non c'è niente da mostrare.
- **Se l'elenco non è cambiato, non si tocca la pagina**: un avviso che si
  ridisegna sotto le dita (magari con "Confermi?" già armato) è rumore.
- **Dove:** `src/main/services/mergeApprovalSignal.js` (campanello + decisione
  con l'I/O iniettato), `broadcastToFiloPages` in
  `src/main/services/handlers.js`, `MSG.MERGE_APPROVALS_CHANGED`. Test:
  `tests/unit/mergeApprovalSignal.test.mjs`, `tests/merge-approvals.spec.mjs`.

## Le cose che aspettano una decisione dell'owner stanno in UN posto: i Ricevuti

Le fusioni bloccate in attesa del via libera vivevano su DUE superfici — la
prima schermata del browser e la pagina di gestione — con l'idea che "così
l'owner le trova senza cercarle". La scelta dell'owner (2026-08-26) è stata
l'opposta: la home di tutti i giorni non è il posto delle sue pratiche, e le
cose che aspettano una sua decisione hanno GIÀ una casa — la scheda Ricevuti
della dashboard di gestione, dove stanno i feedback da decidere.

- **Regola:** una cosa da decidere si mette dove l'owner decide le altre, in
  cima se è più urgente — non su una superficie in più "per visibilità". Due
  posti per la stessa decisione sono rumore per uno dei due, e prima o poi i
  due imparano cose diverse.
- Il pannello dei Ricevuti è condiviso dalle quattro schede-lista: la
  visibilità dell'avviso dipende da "c'è qualcosa" E "sei sulla scheda giusta",
  e il cambio scheda riapplica la regola senza rileggere dal server.
- L'avviso nomina la segnalazione da cui nasce il lavoro (`automazione ·
  feedback #N`) e — vivendo già dentro la dashboard dei feedback — quel numero
  è un bottone che la apre: "guarda cosa era stato chiesto" è il gesto che
  serve prima di approvare.
- **Dove:** `#mgMergeApprovals` dentro `panel-list` in
  `src/pages/manage/manage.html`, `applyMergeApprovalsVisibility()` /
  `openFeedbackByNum()` in `manage.js`, modulo `src/shared/mergeApprovals.js`.
  Test: `tests/merge-approvals.spec.mjs`.

## Azione distruttiva: l'"Annulla" effimero non può essere l'UNICA rete

Rendere un'eliminazione **immediata e reversibile** (niente conferma, un avviso
con "Annulla" subito dopo) è la scelta giusta per l'attrito — ma l'undo nel
toast è una **scorciatoia**, non la rete di sicurezza: dura pochi secondi, muore
col reload e vive in un pezzo di UI che altri eventi possono sovrascrivere.

- Dietro l'undo effimero serve **uno stato persistente**: un cestino con gli
  ultimi N eliminati (contenuto + dati collegati), raggiungibile dalla UI e
  vivo dopo la chiusura della pagina. L'undo diventa allora solo il cammino
  veloce sullo stesso stato.
- **Non buttare i dati collegati** (storico versioni, allegati) all'atto
  dell'eliminazione: vanno liberati quando l'elemento esce davvero dal cestino,
  altrimenti il ripristino torna monco.
- Se l'eliminazione ha creato **qualcosa al posto** dell'elemento tolto (il
  foglio bianco quando si cancella l'ultimo documento), all'undo rimuovilo
  **solo se è rimasto vuoto**: nel frattempo può essere diventato un contenuto
  vero, e toglierlo sarebbe la stessa perdita che stai prevenendo.
- L'unica azione **irreversibile** (svuotare/eliminare per sempre) chiede
  conferma sul posto — il bottone diventa "Confermi?" e torna com'era da solo —
  senza aprire finestre di mezzo.
- **Dove:** cestino documenti dell'editor (`deleteFile`/`restoreDeletedFile`/
  pannello `Cestino` in `src/pages/editor/editor.js`), test
  `tests/editor-trash.spec.mjs`.

## Liste/chat che si ricostruiscono in streaming: auto-follow SOLO se sei in fondo

Una lista che si **rirenderizza di continuo** mentre arriva contenuto (una chat
con risposta in streaming, un log dal vivo) non deve **strappare lo scroll**
all'utente. Il pattern anti-attrito:

- Prima di ricostruire, misura se l'utente è **vicino al fondo**
  (`scrollHeight - scrollTop - clientHeight < ~48px`). Segui il fondo
  (`scrollTop = scrollHeight`) **solo se lo era**; altrimenti **ripristina la sua
  posizione** (`scrollTop = prevTop`) — così può leggere a metà mentre genera.
- Attenzione al **clamp**: se ricostruisci svuotando e reinserendo i figli,
  all'istante in cui il contenitore è vuoto `scrollHeight` collassa e il browser
  clampa `scrollTop` a 0. Non basta "non seguire il fondo": senza ripristino
  esplicito la vista **salta in cima**. Cattura `prevTop` PRIMA di svuotare.
- Un'eccezione esplicita "vai comunque in fondo" serve quando è **l'utente** a
  produrre il nuovo contenuto (ha appena inviato un messaggio: vuole vederlo) o
  all'apertura (mostra l'ultimo scambio). Passala come flag, non come default.
- **Dove:** `renderChat`/`renderBuilder` in `src/pages/decks/decks.js` (flag
  `stickBottom`/`stickChat`). Test `tests/decks-chat-scroll.spec.mjs` (scroll su
  mentre genera → posizione conservata; resti in fondo → segue).

## Errori in chat: mai il messaggio grezzo, sempre una frase + un modo di riprovare

Una bolla di chat non è un log. Il messaggio di un'eccezione (`fetch failed`,
`OpenRouter 400: …`, `ETIMEDOUT`, uno stack) non dice niente all'utente e lo
lascia bloccato: il dettaglio tecnico va nei log del main, in chat va **cosa non
ha funzionato e cosa fare**.

- **Traduzione unica**: `SN_CHAT_ERRORS` (`src/shared/chatErrors.js`).
  `friendly(err, { dataSource })` ritorna una proposizione con l'iniziale
  minuscola (da incastonare in "Non ha funzionato: …"), `sentence(err, …)` la
  stessa cosa come frase a sé (per chi la mostra da sola nella bolla). Gli errori
  con `code` applicativo (`NO_API_KEY`, `LIMIT_REACHED`) portano già un messaggio
  i18n per l'utente e passano invariati.
- **`dataSource` va passato solo da chi interroga un archivio esterno** oltre al
  servizio AI (es. la chat dei mazzi con Scryfall): serve ad attribuire un errore
  HTTP "nudo". Chi non lo passa ottiene una frase generica — meglio che
  incolpare il servizio sbagliato.
- **Il turno deve catturare**: se l'handler lascia scappare l'eccezione, il
  gestore IPC generico rimanda `e.message` e il grezzo arriva in chat comunque.
  Ogni chat cattura e traduce nel suo handler.
- **Guasti di rete passeggeri si ritentano prima di arrendersi**: la catena dei
  provider (`src/main/services/providers/index.js`) ripete lo stesso tentativo una
  volta dopo una breve pausa quando non è arrivata nessuna risposta HTTP; un
  400/401 non si ritenta mai (tornerebbe identico). In streaming, se dei delta
  erano già usciti si ritenta solo se il chiamante sa azzerare il buffer
  (`onReset`, #273).
- **Se il messaggio dice "riprova", il tasto per riprovare ci deve essere**: la
  bolla d'errore porta un "↻ Riprova" che rimanda lo stesso messaggio senza
  farlo riscrivere (parità col "Riprova" della pagina d'errore di una scheda).
- **Dove:** chat della home (`src/pages/dashboard/dashboard.js` +
  `src/main/services/handlers/filo.js`), chat dei mazzi
  (`src/main/services/handlers/scryfall.js`), assistente laterale
  (`src/content/sidebar.js`). Test: `tests/unit/chatErrors.test.mjs`,
  `tests/unit/providerNetworkRetry.test.mjs`,
  `tests/dashboard-chat-gap-feedback.spec.mjs`, `tests/verify-331-stress.spec.mjs`.

## Un controllo che RIFIUTA non rifiuta mai in silenzio (e si può scavalcare)

I controlli di plausibilità ("questo indirizzo esiste?", "questo file è troppo
grande?") esistono per risparmiare all'utente un vicolo cieco. Ma quando
scattano diventano loro il vicolo cieco, se l'unica cosa che succede è **niente**:
premere invio e non vedere accadere nulla è indistinguibile da un'app bloccata,
e l'utente non ha nemmeno modo di sapere che c'è un controllo (#433 — "/nas.lan"
restava rosso e muto).

- **Regola in due tempi:** (1) dillo — una riga di Filo che nomina la cosa
  rifiutata e il perché; (2) lascia insistere — un `.dash-action-btn` che fa
  comunque l'azione. Un controllo euristico si sbaglia (VPN, rete aziendale, DNS
  che non conosce quel nome): l'ultima parola è dell'utente, non dell'euristica.
- **Dopo l'"apri comunque", il controllo su quel bersaglio smette di parlare**
  (l'esito forzato entra in cache): ripetere l'avviso su una cosa già decisa è
  solo rumore.
- **L'input NON si svuota** quando il controllo rifiuta: se era un errore di
  battitura si corregge sul posto, senza riscrivere tutto.
- **Prima di aggiungere un controllo, guarda chi è già esente**: se localhost e
  gli IP privati sono esclusi, anche i nomi della rete di casa (`nas.lan`,
  `raspberrypi.local`) lo devono essere — la simmetria mancante È il bug.
- **Dove:** `showUnresolvedSite()` in `src/pages/dashboard/dashboard.js`,
  esenzioni in `src/shared/urlNav.js` (`isLocalHost`/`isLocalNetworkName`) usate
  da `src/main/services/hostResolve.js`. Test
  `tests/dashboard-local-network-address.spec.mjs`,
  `tests/unit/urlNav.test.mjs`, `tests/unit/hostResolve.test.mjs`.

## Filo ammette una mancanza → propone lui la segnalazione, non la chiede

Quando l'agente risponde "non lo so fare / non ho accesso a quel dato", il buco
non deve morire lì: nella **stessa risposta** compare una segnalazione **già
scritta**, e il popup di conferma si apre **da solo** con il testo per intero
(azione `INVIA_FEEDBACK`, livello 2 → niente parte senza l'OK dell'utente).

- **Deterministico, non affidato al prompt**: il prompt lo chiede al modello, ma
  l'invariante è garantito nel main (`maybeProposeFeedbackAction` in
  `src/main/services/handlers.js`) analizzando la risposta con
  `SN_AUTO_FEEDBACK.analyzeReply` + `composeProposal`.
- **Due canali distinti, mai insieme**: la segnalazione **proposta** cita le
  parole dell'utente (le legge prima di autorizzarla, ed è ciò che la rende
  utile); quella **anonima automatica** resta generica come prima. Se in un turno
  compare la proposta, l'anonima non parte: una sola segnalazione per lo stesso
  buco.
- **Non insistere**: una proposta per conversazione, e nessuna sui turni di
  prosecuzione automatica (il "messaggio utente" lì è un nudge interno, non una
  richiesta: il client li marca `internal: true`).

## Colonne ridimensionabili: divisore trascinabile, misura persistita, mai auto-resize

I layout a pannelli affiancati (banco di lavoro dei Mazzi, dashboard di
gestione) si ridimensionano **solo** trascinando i divisori: le due colonne
esterne hanno larghezza fissa decisa dall'utente, quella centrale assorbe il
resto. È l'applicazione diretta di "la GUI è personalizzabile" (`filo_filosofia`).

- **Struttura:** un grid a 5 tracce — `Lpx | divisore | minmax(0,1fr) | divisore
  | Rpx` con `gap: 0`; sono i divisori a fare anche da spaziatura fra le colonne
  (niente doppio spazio). `min-width: 0` sulle colonne, altrimenti il contenuto
  impedisce di stringerle.
- **Aspetto del divisore:** trasparente a riposo se le colonne hanno già un
  bordo proprio (una terza linea sarebbe rumore), **tinto d'accento su hover e
  durante il trascinamento** — l'hover deve sempre dare un segnale che è una
  presa. Se le colonne non hanno bordo, la linea sottile fissa va bene (Mazzi).
- **Persistenza:** le misure finiscono in `chrome.storage.local` (una chiave UI
  per pagina in `STORAGE_KEYS`) e si riapplicano all'apertura. Mai un resize
  automatico non richiesto.
- **Rientro nello spazio disponibile:** le misure salvate possono non entrare
  (finestra più piccola, altro schermo). Il calcolo — restringere le esterne in
  proporzione a quanto possono cedere, mai sotto i loro minimi, preservando il
  minimo della centrale, **senza toccare le preferenze salvate** — è UNO e vive
  in `src/shared/paneLayout.js` (`SN_PANE_LAYOUT.fitWidths`, logica pura con
  unit test). Riapplicalo anche sul `resize` della finestra.
- **Invarianti da completare sempre:** doppio clic sul divisore = ritorno alla
  misura iniziale (se si può cambiare, si deve poter tornare indietro);
  `role="separator"` + `tabindex="0"` e frecce ←/→ per farlo da tastiera.
- **Dove:** `src/pages/decks/decks.js`, `src/pages/manage/manage.js`. Test
  `tests/decks-layout.spec.mjs`, `tests/manage-layout.spec.mjs`,
  `tests/unit/paneLayout.test.mjs`.

## In chat: i passi intermedi sono TRACCE, i risultati sono bottoni

Nella conversazione di Filo ha la forma di bottone (pill `.dash-action-btn`)
**solo ciò su cui l'utente può agire**: il link aperto, la conferma, il pannello.
I passi che Filo compie per arrivarci — la ricerca sul web, la lettura di un
file, la consultazione del manifesto capacità — sono **tracce scritte**
(`.dash-action-step`: riga in corsivo, tenue, senza bordo né pill).

- **Perché:** i chip inerti erano `<button disabled>` con la stessa pill dei
  bottoni veri; una singola azione ("mettimi questa canzone") lasciava così due
  pill affiancate e l'utente contava "due bottoni" per una cosa sola (#376).
  Restano visibili — la trasparenza sui passi (#368) è un valore — ma non
  competono col risultato.
- **Regola pratica:** se cliccarlo non fa niente, non deve *sembrare* cliccabile.
- **Dove:** `stepTrace()` in `src/pages/dashboard/dashboard.js`, stile in
  `dashboard.css`. Test `tests/filo-open-background-tab.spec.mjs`.

## Ripristini e annullamenti: riportano indietro SOLO ciò che il pannello mostra

Un "ripristina"/"annulla" che rimette in piedi uno **snapshot intero** riporta
indietro anche cose che l'utente non stava chiedendo di annullare e che non ha
modo di vedere prima di premere (nell'editor: il nome del documento, la
conversazione con Filo nel riquadro chat, la disposizione dei riquadri — #384).
È perdita silenziosa, ed è peggio dell'attrito che si voleva evitare.

- **Regola:** il confine di ciò che torna indietro deve coincidere con ciò che
  l'affordance mostra e promette. Lo storico versioni dell'editor mostra
  un'anteprima di TESTO → ripristina testo e commenti (ancorati al testo:
  separarli lascerebbe note appese a frasi inesistenti) e lascia com'è adesso il
  "contenitore" (nome, metadati, moduli con i loro dati). Il resto dello
  snapshot si continua a salvare: è la ricomposizione a scegliere cosa applicare.
- **Dillo comunque, una riga:** dove il pannello non può mostrare tutto, una
  frase tenue accanto al bottone dice cosa torna indietro e cosa no. Non è
  "spiegare la UI": è dichiarare la portata di un'azione distruttiva.
- **Uno snapshot è una COPIA PROFONDA, mai un alias del modello vivo.** Se il
  serializzato condivide oggetti col documento aperto, lo snapshot continua a
  cambiare insieme a lui: in memoria sembra "aggiornato", su disco è la
  fotografia vera → la stessa azione dà due risultati diversi prima e dopo un
  riavvio, che è il modo più rapido per far perdere fiducia in una funzione di
  ripristino. Clona alla frontiera della serializzazione, una volta sola.
- **Dove:** `composeRestored` in `src/shared/editorVersions.js` (logica pura),
  `serializeDocModel`/`restoreVersion` in `src/pages/editor/editor.js`. Test
  `tests/unit/editorVersions.test.mjs`, `tests/editor-versions.spec.mjs`.

## Aprire una scheda: primo piano solo se l'utente vuole ARRIVARCI

`TabManager.openTab(url, { activate })` decide se la nuova scheda passa davanti.
Attivarla è il default (chi chiede "apri X" vuole vedere X), ma **non è sempre
giusto**: la musica che Filo mette per te, il Ctrl+click su un link mentre stai
leggendo, le schede ripristinate all'avvio non devono strapparti da dove sei.

- **Agente:** l'azione `NAVIGA` accetta `background: true` (il prompt gli spiega
  quando usarlo: ciò che si ascolta e basta, o "senza cambiare scheda").
- **Gesti del browser:** `setWindowOpenHandler` apre dietro quando la
  `disposition` è `background-tab` (Ctrl+click, click centrale).
- **Vincolo tecnico da non rompere:** una scheda di sottofondo NON va nascosta
  con `setVisible(false)` — per Chromium diventerebbe una scheda "hidden" e i
  media potrebbero non partire. Si lascia visibile con bounds `{0,0,0,0}`
  (`layout()` lo fa da sé per ogni scheda non attiva).
- **Invariante UX:** se Filo apre qualcosa dietro, il riferimento che lascia in
  chat deve **portare a quella scheda** (messaggio `FOCUS_TAB`), non aprirne un
  doppione sullo stesso indirizzo.

## Contenuto nascosto (sezioni chiuse, filtri, collassi): rivelalo, non toccarlo di nascosto

Se una parte del documento/lista è nascosta da un collasso o da un filtro, ogni
funzione che ci lavora sopra ha solo due comportamenti onesti: **includerlo E
rivelarlo**, oppure **escluderlo del tutto** (e non contarlo). La terza via —
contarlo e modificarlo lasciandolo invisibile — è la peggiore: il contatore
sembra mentire, i tasti di navigazione non portano da nessuna parte e le
modifiche si scoprono per caso più tardi (editor, Cerca/Sostituisci nelle
sezioni chiuse — #385).

- **Scelta di default: includere e rivelare.** L'utente ha cercato quella parola,
  non ha chiesto di limitare la ricerca a ciò che si vede; nascondere una
  corrispondenza legittima sarebbe attrito. Quindi la sezione si apre da sé e la
  vista ci arriva sopra. La stessa regola vale per "applica a tutti": ciò che
  viene toccato deve essere visibile **prima** che cambi.
- **Rivelare significa risalire la catena.** Un blocco può essere nascosto da un
  antenato di livello più alto, non dal titolo che gli sta subito sopra: si
  risale la catena dei titoli che lo governano e si riaprono tutti.
- **Rivelare per NAVIGARE è un prestito; rivelare per MODIFICARE è definitivo.**
  Aprire una sezione per mostrare dove sei è uno stato di passaggio: va marcato
  come tale (`data-search-opened` sul titolo) e **ritirato da solo** appena ti
  sposti su un altro risultato, svuoti il campo o esci. Altrimenti una ricerca
  incrementale (che riparte a ogni lettera e passa su corrispondenze che non
  c'entrano) smonta l'impaginazione costruita dall'utente, che deve richiudere
  tutto a mano (#385 bis). Se invece dentro quella sezione il testo è **cambiato**
  (Sostituisci / Sostituisci tutto), l'apertura resta: nascondere una modifica
  appena fatta è la stessa disonestà di prima.
- **Il prestito non vince mai sull'utente.** Una sezione che l'utente apre o
  chiude con la freccia, o in cui scrive, smette di essere in prestito e non si
  richiude più da sola: mai far sparire testo da sotto il cursore.
- **Una ricerca incrementale "va" sul risultato solo dopo una pausa** (~350ms):
  evidenziazione e contatore sono immediati (feedback subito), ma aprire sezioni
  e scorrere il documento a ogni lettera è attrito. La navigazione esplicita
  (Prec/Succ, Invio, sostituzione) salta la pausa.
- **Lo stato "chiuso" vive su una sola fonte di verità e le classi di
  visibilità si RICALCOLANO da lì** (nell'editor: `data-collapsed` sul titolo →
  `reapplyCollapseState()`). Togglare le classi in loco all'apertura sembra
  equivalente ma non lo è: riaprendo una sezione grande farebbe sbucare anche le
  sotto-sezioni che l'utente aveva chiuso.
- **Dove:** `revealCollapsedFor` / `reapplyCollapseState` in
  `src/pages/editor/editor.js`. Test `tests/editor-find-collapsed.spec.mjs`.

## Se un dato ESCE da Filo, deve poter RIENTRARE (e l'import mostra prima cosa scrive)

Un "esporta" senza il gemello "importa" non è una mezza feature: è una promessa
falsa. Il bottone "Esporta dati (.zip)" dichiarava di servire "come backup o per
trasferire i dati su un altro computer", ma sull'altro computer non c'era nulla
in cui caricare lo zip (#234) — la promessa era irrealizzabile. Vale per
qualsiasi formato che Filo produce (archivio dati, lista di un mazzo, documento):
se lo scriviamo noi, dobbiamo saperlo rileggere noi.

- **Il lettore è l'INVERSO ESATTO dello scrittore, e il round-trip è il test.**
  L'esportazione stacca le immagini dai data-URL e le mette in `images/…`; la
  reimportazione le rimette dentro come data-URL. L'assert che conta è
  `readExportZip(buildExportZip(x)).data` **deep-equal** `x`: un test sulle
  singole voci lascia passare le perdite silenziose.
- **Accetta il file "usato male".** L'utente ha il diritto di scompattare
  l'archivio, guardarci dentro e ri-comprimerlo: il lettore accetta anche
  DEFLATE (non solo lo STORE che scriviamo) e `data.json` dentro una cartella.
  Un file che non è nostro si **rifiuta con un codice riconoscibile**
  (`not_a_zip` / `no_data_json` / `bad_data_json` → un messaggio umano), mai
  importato a metà.
- **Prima leggere, poi chiedere, poi scrivere.** L'import è in due messaggi:
  `IMPORT_DATA_PREVIEW` sceglie e legge il file e ritorna cosa contiene (data
  del backup, quante sezioni, quante immagini); `IMPORT_DATA_APPLY` scrive solo
  dopo un sì esplicito (`SN_CONFIRM_UI.confirm`). Una conferma generica prima di
  sapere cosa c'è nel file non è una conferma. Il contenuto letto **resta nel
  main** fra i due passi (con scadenza): non si fa attraversare l'IPC a un dump
  completo dei dati utente — chiavi API comprese — solo per contarne le sezioni.
- **Importare AGGIUNGE, non cancella.** Le liste si uniscono senza duplicati
  (identità per `id`, altrimenti per contenuto), le sezioni assenti si prendono,
  sui conflitti vince il file importato perché è un ripristino — e ciò che il
  backup non conosce resta. Conseguenza voluta: reimportare due volte lo stesso
  file non duplica nulla. Detto tutto nel popup, perché il confine di un'azione
  che tocca i dati va dichiarato prima (vedi "Ripristini e annullamenti").
- **Ciò che si ripristina dev'essere ATTIVO, non solo scritto.** Le impostazioni
  importate passano da `applySettingsUpdate` come qualsiasi altra modifica, così
  tema, sicurezza, cookie e fingerprint del backup valgono subito senza
  riavviare. E si riscrivono **solo le chiavi davvero cambiate**: rimettere a
  posto valori identici sveglia per niente i listener `onChanged`.
- **Stesso confine d'origine dell'export**: `filo://` soltanto — una pagina web
  non deve poter aprire un file dialog né riscrivere lo storage.
- **Dove:** `readExportZip` / `mergeImportedData` in
  `src/main/services/exportData.js`, handler in
  `src/main/services/handlers/storage.js`, UI in `src/pages/security/`. Test
  `tests/unit/importData.test.mjs`, `tests/import-data.spec.mjs`.

## Un mittente nuovo si classifica su DUE assi: da dove viene, e quanto ci si fida

Quando nasce una provenienza nuova di feedback (un prefisso di `clientId`: l'agente
esploratore, i ruoli delle routine, i rilievi residui, la sessione locale di Claude),
ci sono **due domande diverse** e vanno risposte separatamente:

- **Chi l'ha scritto** — serve a LEGGERE la coda: un ritrovamento nato esplorando l'app,
  uno nato scrivendo il codice, uno nato verificando il lavoro di un altro e uno nato in
  chat con l'owner vanno letti in contesti diversi. Qui ogni provenienza è una categoria
  **propria** (`authorKind` in `src/shared/feedbackThread.js` + `AUTHOR_META`/`AUTHOR_RANK`
  in `manage.js`): farla collassare su un'altra cancella l'unica informazione che il
  mittente serve a dare.
- **Quanto ci si fida** — serve a DECIDERE se entra in coda da sola
  (`autoApproveGroup`, specchiato in `filo-security/functions/src/autoApprove.js`) e se è
  un'identità fidata che non va mai flaggata come attacco/spam (`identities.js`). Dal
  2026-08-22 i due assi COINCIDONO per l'ingresso in coda: un interruttore per ogni
  categoria d'autore, sessione locale e istanze cloud comprese. Prima ne bastava uno per
  tutte le istanze di Claude, e non ci si poteva fidare di una senza fidarsi delle altre.

**Regola operativa:** una provenienza nuova aggiunge una categoria d'autore E il suo
interruttore di fiducia — con un test che lo inchioda su entrambi i repo, e ricordando
che costa: voce in `manage.html`, copia sul server, rideploy delle functions. Se per una
volta si sceglie di NON dargliene uno proprio, la motivazione va scritta accanto al
codice e l'etichetta dell'interruttore che la copre deve dire onestamente cosa copre.
Una mappa salvata prima non deve mai riaccendere da sola ciò che l'owner aveva spento:
chi sdoppia un interruttore scrive anche il ripiego sul vecchio.

**Perché il test:** senza, la scelta la fa il `return` in fondo alla funzione — e "è
finita lì da sola" e "l'abbiamo deciso" diventano indistinguibili il giorno dopo.
Precedenti: `routine:residuo` (SPEC-RIDISEGNO-MAX.md §13), `local:` (la sessione locale,
2026-08-22).

**Completezza da non dimenticare:** un mittente che è un processo dell'owner va aggiunto
**anche** alla lista delle identità fidate del backend di sicurezza
(`TRUSTED_CLIENT_RE` in `filo-security/functions/src/data/identities.js`, elencata in
`FEEDBACK-STATES.md` §3). Lasciarlo fuori non dà un errore: dà un rate-limit da spam
nelle giornate di lavoro fitto, e un'identità marcata pericolosa alla prima segnalazione
tecnica letta male — dopo di che tutti i feedback di quel mittente saltano i giudici.

**Dove:** `src/shared/feedbackThread.js` (classificazione pura + gruppi), `manage.js`
(icona, etichetta, ordinamento) e `manage.html` (interruttori). Test:
`tests/unit/feedbackThread.test.mjs`, `tests/unit/autoApprove.test.mjs`,
`tests/manage-author-sort.spec.mjs`, e i gemelli in `filo-security/functions/test/`.
