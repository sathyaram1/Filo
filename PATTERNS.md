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
  bottone resta solo come ripiego se l'utente **annulla**. Le azioni esterne
  (`INVIA_FEEDBACK`) o distruttive (livello 3, comandi) restano a click esplicito —
  niente auto-conferma di cose irreversibili.
- **Test:** `tests/filo-open-link-direct.spec.mjs`, `tests/filo-action-levels.spec.mjs`
  (più popup di livello 2 → si aprono in sequenza, nessun chip resta da cliccare).

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
- **Dove:** `NOTIFS` (`enforceCap`/`syncOverflow`) in `src/renderer/shell.js`;
  `.shell-notifs` in `src/renderer/shell.css`. Test
  `tests/notifications.spec.mjs` (la raffica non straripa e resta chiudibile).
  Stesso pattern nell'editor: `showEditorToast`/`.ed-toasts` in
  `src/pages/editor/editor.{js,css}`, test `tests/editor-trash.spec.mjs`.

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

## Filo ammette una mancanza → propone lui la segnalazione, non la chiede

Quando l'agente risponde "non lo so fare / non ho accesso a quel dato", il buco
non deve morire lì: nella **stessa risposta** compare una segnalazione **già
scritta** con il tasto di conferma (azione `INVIA_FEEDBACK`, livello 2 → niente
parte senza l'OK dell'utente).

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
- **Lo stato "chiuso" vive su una sola fonte di verità e le classi di
  visibilità si RICALCOLANO da lì** (nell'editor: `data-collapsed` sul titolo →
  `reapplyCollapseState()`). Togglare le classi in loco all'apertura sembra
  equivalente ma non lo è: riaprendo una sezione grande farebbe sbucare anche le
  sotto-sezioni che l'utente aveva chiuso.
- **Dove:** `revealCollapsedFor` / `reapplyCollapseState` in
  `src/pages/editor/editor.js`. Test `tests/editor-find-collapsed.spec.mjs`.
