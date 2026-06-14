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
- **UI:** le conferme usano i componenti riusabili `SN_CONFIRM_UI.confirm`
  (livello 2) e `SN_CONFIRM_UI.confirmTyped` (livello 3) in
  `src/shared/confirmUi.js` — mai `window.confirm` nativo.
- **Test:** `tests/unit/actionLevels.test.mjs`, `tests/filo-action-levels.spec.mjs`.

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
