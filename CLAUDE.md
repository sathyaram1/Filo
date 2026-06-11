# Istruzioni per Claude Code

## PRIMA DI TUTTO: sync con `origin/main`

Routine remote (su claude.ai) pushano commit su `origin/main` durante la
giornata. Prima di iniziare **qualsiasi** task, sincronizza il repo locale:

```bash
git -C "C:/Users/agenti AI/Desktop/Filo/Filo" pull --rebase origin main
```

Questo allinea anche tutti i worktree (condividono lo stesso `.git`). Se il
pull fallisce per conflitti, fermati e chiedi all'utente prima di procedere
— non risolvere conflitti senza autorizzazione.

## Lavoro multi-sessione: `TASKS.md`

La coda di lavoro persistente vive in **`TASKS.md`** nella root. Regole:

- Se l'utente dice **"continua"** (o equivalenti) senza altro contesto →
  leggi `TASKS.md` e riprendi dal primo task aperto (`[ ]` o `[~]`).
- Se l'utente consegna una **spec grossa** → spezzala in task da una sessione
  l'uno dentro `TASKS.md` (formato descritto lì), fatti confermare l'ordine,
  poi parti dal primo.
- **Budget contesto**: chiudi la sessione prima di ~150k token (oltre 200k il
  costo sale del 50%). Quando ti avvicini: finisci il pezzo atomico in corso,
  aggiorna `TASKS.md` con lo stato esatto, e di' all'utente di aprire
  un'altra istanza e dire "continua".

## Push automatico su `origin/main`

L'hook `.claude/hooks/auto-commit-merge.sh` pusha automaticamente `main` su
`origin` dopo ogni Edit/Write (oltre a committare e mergiare i worktree).
Non serve fare push manuali. Se vedi nei log `[auto-push] FAILED` in stderr,
significa che il push è stato rifiutato (di solito perché una routine
remota ha pushato nel frattempo): fai `git pull --rebase origin main` e poi
un Edit qualsiasi farà ripartire il push automatico, oppure pusha a mano:

```bash
git -C "C:/Users/agenti AI/Desktop/Filo/Filo" push origin main
```

## MAI committare artefatti dei test (evita i conflitti di rebase)

Gli screenshot dei test sono **output rigenerato**, non sorgente. Sia le
sessioni locali sia le routine cloud li riscrivono di continuo, quindi se
finiscono in git generano **conflitti binari** a ogni `pull --rebase` (git
non sa fondere due PNG diversi). È esattamente la causa dei conflitti che
bloccavano `npm start`.

Per questo TUTTE le cartelle di artefatti dei test sono gitignorate:
`tests/.shots/`, `tests/.smoke/`, `tests/.report/`, `tests/agent/.out/`,
`tests/agent/reports/`, `test-results/`, `.feedback-images/`,
`tests/.fb/*.png` (lo script `render-popup.mjs` lì dentro resta versionato).

Regole:

- **Non committare mai** questi file e **non rimuoverli dal `.gitignore`**.
- Gli screenshot servono come **traccia locale della singola run**
  (ispezionali nella cartella subito dopo il test), non come file versionati.
- Se per qualche motivo un PNG di screenshot risulta di nuovo tracciato
  (`git ls-files tests/.shots/` ritorna qualcosa), è un errore da correggere:
  `git rm --cached <file>` e lascialo gitignorato.

## REGOLA DURA: niente "fatto" senza verifica

**Non dichiarare mai un task completato (né tornare il controllo all'utente,
né chiudere un feedback come `done`) senza aver verificato che la feature
funzioni davvero.** "Funziona davvero" significa **eseguire il codice** che
hai toccato, non solo aver "verificato che compila" o "letto il diff".

Il minimo accettabile dipende dall'ambiente:

- **In sessione locale (Windows)**: verifica **solo la feature che hai toccato**,
  non l'intera suite. ⚠️ **NON lanciare `npm test` (la suite completa) in
  locale**: apre e chiude Electron centinaia di volte — finestre che lampeggiano
  sullo schermo mentre l'utente sta usando il PC — ed è lentissimo (~25 min).
  La regressione completa sulle **feature vecchie** è compito delle routine cloud
  (vedi sotto), non delle sessioni locali. In locale usa invece:
  - **il/gli spec mirati** della feature toccata:
    `npx playwright test tests/<feature>.spec.mjs` (1-2 avvii di Electron, pochi
    secondi) — questo è il minimo accettabile per dichiarare "fatto" in locale;
  - in più, per modifiche visive, `npm run test:shoot` con uno scenario mirato +
    ispezione dello screenshot (vedi "Controlli visivi" più sotto).
  Non rilanciare l'intera suite "per sicurezza": se temi una regressione su
  un'altra area, lascia che la verifichi la routine cloud.

- **In routine cloud (Linux headless)**: **qui** gira la regressione completa.
  `npm test` (intera suite Playwright) per assicurarti che nulla si sia rotto
  sulle feature vecchie, e — se la feature ha un comportamento UI nuovo —
  **aggiungi un test Playwright** che lo eserciti (click + assert). `test:shoot`
  e `test:explore` **non funzionano nel cloud** (vedi sezione dedicata).

- **Se la verifica non è possibile** (es. richiede interazione hardware che
  Playwright non simula): dichiaralo esplicitamente nel report finale —
  "feature implementata ma non verificata perché X", così l'utente sa che
  deve provarla a mano.

## Test che servono davvero (asserire successo, non assenza di errore)

Il test deve **fallire prima del fix e passare solo se la feature fa la cosa
giusta**. Se può passare in entrambi gli stati cambiando solo un dettaglio
cosmetico (es. il testo di un messaggio di errore), il test è inutile e
maschera bug invece di scoprirli.

Regole pratiche:

- **Asserire il successo**, non l'assenza di un certo errore. Se la lamentela
  è "non posso incollare un'immagine", il test giusto verifica che l'immagine
  arrivi al destinatario (es. compare un `<img>`, un file viene aggiunto a
  un attachment store, ecc.) — non che il toast d'errore non contenga
  "provider".

- **Pensa al comportamento, non al messaggio**. Lamentele tipo "appare errore
  X" vanno tradotte in "la feature Y non funziona" prima di scrivere il fix.
  Cambiare la stringa dell'errore è il fix sbagliato 9 volte su 10.

- **Pre-condizione del test = stato in cui senza fix fallirebbe**. Quando
  scrivi il test, immagina di rimuovere il fix appena fatto: il test deve
  diventare rosso. Se non puoi articolare *quale assert* diventa rosso,
  riscrivi gli assert.

- **Se in cloud (Playwright headless)**: per UI che cambia visivamente, oltre
  agli assert salva `page.screenshot()` in `tests/.shots/` come traccia
  ispezionabile della run (la cartella è **gitignorata**: lo screenshot resta
  locale all'esecuzione e non va committato). Non è il primary signal, ma
  cattura regressioni visive che gli assert non vedono.

## Sintomo vs causa: l'obiettivo è migliorare l'app, non chiudere il feedback

Un feedback descrive il sintomo come lo vede l'utente. La tua prima domanda
non è "come faccio sparire questo errore" ma **"cosa stava cercando di fare
l'utente, e perché non gli è riuscito"**. Spesso la causa è in tutt'altra
parte del codice rispetto a dove si manifesta l'errore.

Segnali di "stai fissando il sintomo":

- Stai per cambiare solo una stringa per chiudere un bug funzionale.
- Stai facendo passare il test SBAGLIANDO meno (es. messaggio meno
  fuorviante) invece di fare passare la feature.
- Stai per chiudere senza poter rispondere alla domanda "se l'utente
  riprova adesso il flusso, gli funziona?". Se la risposta è no, non hai
  finito.

Segnale che hai trovato la causa vera: spesso emergono **simmetrie mancanti**
— due rami di codice che fanno cose simili divergono in modo sospetto, oppure
un flusso A funziona ma un flusso B equivalente no perché manca un pezzo.
Leggi i due flussi affiancati.

## Iniziativa: completare l'invariante UX, segnalare sempre cosa hai aggiunto

Quando risolvi un feedback puoi (anzi: dovresti) prendere iniziativa sulle
**invarianti UX ovvie** che il feedback implica ma non chiede:

- Se l'utente può aggiungere X, deve poter rimuovere X.
- Se l'app salva N cose, l'utente deve poterle vedere tutte.
- Se Ctrl+V fa Y, anche "Incolla" dal menu deve fare Y (parità tra cammini
  equivalenti).

Queste non sono scelte di design — sono completezza. Falle.

**Limite**: quando ci sono più modi non equivalenti di fare la cosa (es.
"vedere tutte le immagini" → grid, accordion, modal-galleria, lista a thumb),
non scegliere tu. Proponi 2-3 opzioni nel report o lascialo come `clarify`.

**Regola d'oro per evitare scope creep**: nel report finale **elenca
esplicitamente cosa hai aggiunto oltre il chiesto**, in modo che l'utente
veda subito cosa è "in più" e possa dirti "no, questo non lo voglio". Senza
elenco esplicito è invisibile e si accumula nel codice.

## Tono dei report e delle notes

I report finali (chat) e le `notes` su Firestore vanno scritti **per
l'utente**, non per un altro Claude. Quindi:

- Niente nomi di variabili, funzioni, file con percorso assoluto. Spiega
  cosa l'utente vedrà di diverso, non come l'hai codato.
- Niente paragrafoni "Causa / Fix / Test" in stile diff review.
- Una sintesi breve di **cosa hai fatto in pratica** (1-3 frasi), **cosa
  hai aggiunto oltre il chiesto** (se qualcosa), e **come l'hai verificato**.
- Se serve memoria tecnica per la prossima passata (es. il fix ha un
  vincolo non ovvio che potrebbe rompersi), aggiungi una sezione
  "Note tecniche" a fondo, separata. Se non serve, **non scriverla**.

Questo è **Filo desktop** — un browser AI-native costruito su Electron. È
l'evoluzione dell'estensione Chrome `filo-extension` (archiviata, o in via di
archiviazione, sotto `../ROBA VECCHIA/`). Tutto il valore dell'estensione
(menu tasto destro, popup, sidebar, spellcheck, dashboard, salva per dopo)
è stato portato qui 1:1; in più ora abbiamo controllo completo del browser
e shortcut globali OS.

## Run / test

```bash
npm install                # Electron + Playwright (~150MB)
npm start                  # avvia la app
npm run test:smoke         # smoke headless con screenshot in tests/.smoke/
npm test                   # suite Playwright (~100 spec, ~25 min: solo in cloud)
```

Se `npm install` non scarica il binario Electron (succede su alcuni setup):
`node node_modules/electron/install.js`.

## Architettura (riepilogo da README)

```
src/main/                  Processo main Electron (Node)
  main.js                  app lifecycle, smoke sentinel
  window.js                BrowserWindow + shell
  tabs.js                  TabManager multi-WebContentsView
  protocol.js              filo:// custom protocol
  ipc.js                   IPC routing main↔renderer
  shortcuts.js             globalShortcut Alt+E/T/S/H
  shim/
    storage.js             chrome.storage.local → userData/storage.json
    chrome-api.js          chrome.* namespace per i moduli portati
  services/
    loader.js              carica shared/* + background/* su globalThis
    handlers.js            registro messaggi + helper condivisi (ex background.js)
    handlers/              handler per dominio (nav, tabs, storage, pages, ai,
                           filo, auth, safebrowse, misc)
    providers/             openrouter, gemini, fallback
    categorizer.js, savedPages.js, historyStore.js, ...
src/preload/
  shell-preload.js         filoShell IPC per la shell (tab bar + addr bar)
  internal-preload.js      chrome shim + content script su pagine filo://
                           (escluse options/history/feedback/spellcheck)
  page-preload.js          chrome shim + content script su pagine web esterne
src/renderer/              shell.html / shell.css / shell.js
src/pages/                 dashboard, options, history, feedback, spellcheck
src/shared/                IIFE moduli che attaccano a globalThis (constants,
                           messages, i18n, icons, storage, filoMemory,
                           filoState, paths, feedback, pageBootstrap)
src/content/               content scripts (menu, popup, sidebar, highlight,
                           spellcheck, feedback, extractContext, pageColor,
                           translatePage, tts, editBox, actions, menuIcons,
                           content)
src/styles/                CSS condivisi (theme, menu, popup, sidebar, ...)
```

Lo storage usa **`%APPDATA%/Filo/storage.json`** in produzione e `$FILO_USER_DATA/storage.json`
nei test.

## Convenzione di porting

Il codice originale dell'estensione era scritto in stile **IIFE su globalThis**:

```js
(function (global) {
  global.SN_MODULE = { ... };
})(typeof globalThis !== 'undefined' ? globalThis : self);
```

Si è rivelato un dono per il porting: `require()` nel main process e nei
preload esegue il file e i moduli si auto-registrano. Gli altri trovano
SN_CONST/SN_MSG/ecc. su globalThis senza bisogno di import espliciti.

Quando aggiungi un modulo, **mantieni questo pattern** se appartiene al
codice condiviso shared/* o background/*. Il loader (`src/main/services/loader.js`)
deve poi chiamare `require()` su di esso nell'ordine corretto.

## Chrome shim

Il codice portato chiama `chrome.runtime.sendMessage`, `chrome.storage.local`,
`chrome.tabs.*`. Lo shim sta in tre file diversi a seconda del contesto:

- **Main process**: `src/main/shim/chrome-api.js` (per i moduli background)
- **Pagine filo://**: `src/preload/internal-preload.js` (contextIsolation:false,
  assegna direttamente a `window.chrome`)
- **Pagine web esterne**: `src/preload/page-preload.js` (contextIsolation:true,
  assegna a `globalThis` del mondo isolato)

Quando aggiungi un nuovo tipo di messaggio:
1. Definiscilo in `src/shared/messages.js` (costante `MSG.*`)
2. Gestiscilo nel modulo di dominio giusto sotto `src/main/services/handlers/`
   (es. `nav.js`, `filo.js`, …) registrandolo con `on(MSG.X, async (msg, sender, origin) => …)`;
   il registro e le funzioni di supporto condivise (passate via `ctx`) stanno in `handlers.js`
3. Per broadcast main→renderer usa `broadcastToTabs` o `broadcastLiveUpdate`

## Test

I test usano `_electron.launch` di Playwright con un fixture custom in
`tests/fixtures/electron.mjs` che fornisce:
- `app`: l'istanza ElectronApplication (userData isolato in temp dir)
- `shell`: Page object della shell (BrowserWindow primary webContents)
- `openTab(url)`: apre URL come tab e ritorna la Page del WebContentsView
- `testServer`: mini HTTP server locale per pagine di test

**Selettore di Page per un WebContentsView**: usa `app.windows().find(...)`
filtrando sull'URL hostname. `app.waitForEvent('window')` è race-prone perché
la newtab apre subito al boot e il suo event può coincidere con quello del
tab che hai appena aperto.

**Limitazione capturePage su WebContentsView**: noto bug Electron #24694 —
ritorna empty image in molte configurazioni. Il `smoke.mjs` aggira aprendo
l'URL in una BrowserWindow primary dedicata e cattura quella. Replica il
pattern se vuoi screenshot affidabili in nuovi test.

## Pattern e convenzioni UI — leggi `PATTERNS.md` PRIMA di toccare la UI

Il sapere condiviso su come si costruiscono le cose in Filo (pattern UI, convenzioni
di design, filosofia minimale) vive in **`PATTERNS.md`** nella root. **Prima di
toccare la UI o prendere una decisione di design, leggilo** — vale anche per le
routine cloud. Quando stabilisci un pattern nuovo (o ne rendi esplicito uno implicito),
**aggiorna `PATTERNS.md`**: è il modo in cui le decisioni si accumulano tra sessioni
invece di essere ri-litigate ogni volta.

## Controlli visivi / agentici dopo OGNI feature

Gli unit test Playwright non vedono i bug **compositi** (shell + WebContentsView
native) né le regressioni visive. Dopo aver implementato o modificato una feature,
esegui SEMPRE un controllo visivo dell'area toccata. Strumenti in `tests/agent/`
(cattura la finestra reale via Win32 `PrintWindow`, vedi `tests/agent/README.md`):

1. **Controllo a vista (deterministico, gratis)** — `npm run test:shoot`:
   ```bash
   npm run test:shoot -- "nav:filo://editor/editor.html; click-view:#doc; type:ciao; shot:editor"
   ```
   Guarda gli screenshot in `tests/agent/.out/*.png` e verifica a occhio.

2. **Esplorazione/compito guidato da LLM** — `npm run test:explore`:
   ```bash
   npm run test:explore -- --start filo://editor/editor.html --steps 10 \
     --task "<usa la feature appena fatta, passo per passo>"
   ```
   Dai un `--task` che esercita la feature: il modello la usa con interazioni
   reali e segnala i bug incontrati (finiscono nei feedback, tab "Agente").

**Modelli (strategia):** usa **`gemini-3.1-flash-lite`** come primario (è "il
modello buono" e ha quota generosa), con **`gemma-4-31b-it`** come **fallback**
automatico quando il primario esaurisce i crediti/quota (429). Così si sfrutta
prima il modello migliore. La chiave sta in `tests/agent/.env` (gitignorata).

**Come reagire a ciò che emerge:**
- **Bug ovvio** (qualcosa di palesemente rotto: area vuota, crash, funzione che
  non risponde) → **correggilo subito** nello stesso worktree.
- **Scelta di design discutibile / non-bug ovvio** (ridondanze, UX opinabile,
  incoerenze minori) → **NON** cambiarla di tua iniziativa: **segnalala**
  all'utente (o lasciala nel report/feedback) perché decida lui.
- **Sospetto falso positivo** dell'harness (es. focus rubato, percezione errata
  dello screenshot): prima di trattarlo come bug **riproducilo in modo
  deterministico con `test:shoot`**. Se non si riproduce, è un artefatto: non
  segnalarlo come bug reale.

### In routine cloud (Linux headless)

`test:shoot` usa Win32 `PrintWindow` → **non funziona in Linux**, ignoralo.
`test:explore` richiede la chiave Gemini in `tests/agent/.env` che è
gitignorata → **probabilmente non è disponibile nel cloud**, ignoralo.

Cosa puoi (e devi) usare invece:

1. **`npm test`** — la suite Playwright (~100 spec) parte in Electron headless.
   Eseguila SEMPRE prima di dichiarare un task done in cloud. Se rompi un
   test esistente, è un regress: fixalo prima di chiudere.

2. **Aggiungi un test Playwright per la feature che hai toccato**, in
   `tests/`. Usa il fixture `tests/fixtures/electron.mjs`. Esempio per una
   modifica alla dashboard feedback:
   ```js
   import { test, expect } from './fixtures/electron.mjs';
   test('reopen feedback opens inline textarea', async ({ openTab }) => {
     const page = await openTab('filo://feedback/feedback.html');
     // ... click tab "done", click "Riapri", expect textarea visible
   });
   ```

3. **`npm run test:smoke`** come sanity check rapido (avvia la app headless
   e cattura screenshot di alcune pagine in `tests/.smoke/`).

Se non riesci a scrivere un test affidabile per la feature (es. l'UI
dipende da Firestore live), almeno verifica via `node -e "require('./src/...')"`
che i moduli toccati si caricano senza errori, e dichiara nel report finale
"non testato end-to-end perché X".

## Feedback alpha tester

I feedback arrivano da Firestore (progetto `filo-8b9cb`, collezione `feedback`).
Accesso via REST con API key in `src/shared/feedback.js`. La config Firebase
(`firebase.json`, `.firebaserc`, `firestore.rules`, `storage.rules`) vive nella
**root del repo Filo** — non dipende più dalla vecchia cartella `extension/`.
Le rules si deployano dalla root:

```bash
firebase deploy --only firestore:rules     # solo le regole Firestore
firebase deploy --only storage              # solo le regole Storage
firebase deploy                             # entrambe
```

### Scrittura feedback: coda su git (NON più PATCH diretta da cloud)

⚠️ **L'account robot delle routine è stato BLOCCATO da Google.** Le routine
cloud NON possono più autenticarsi a Firestore: ogni PATCH come ruolo
`routines` ora fallisce. I vecchi script `routine-feedback.mjs`,
`routine-login.mjs` e `_verify-routine.mjs` sono stati **rimossi**: non
esistono più, non cercarli.

Al loro posto c'è una **coda su git** (`feedback-triage/`, vedi il README lì
dentro). La routine non scrive lo stato su Firestore: deposita la decisione
come un file `feedback-triage/<id>.json`; l'hook di auto-commit lo pusha su
`origin/main`. Da lì una **GitHub Action** (`.github/workflows/apply-triage.yml`)
si sveglia a ogni push, applica la decisione a Firestore come **service account**
(non un account personale → nessun rischio di blocco) e svuota la coda. L'owner
**non deve fare niente**: nessun `npm start`, nessun token personale nel cloud.
È una **coda di comandi**, non un registro: ogni file sparisce appena applicato,
quindi nessun elenco di ID diventa stantio quando un feedback viene riaperto.

- **In sessione locale / dashboard app**: le scritture passano dal main process
  (`feedback_update`), che allega l'ID token Firebase dell'admin loggato. Questo
  continua a funzionare (è l'owner, non l'account robot).

- **In routine cloud — accoda, non scrivere**: per ogni decisione di triage
  esegui

  ```bash
  node scripts/queue-triage.mjs <id> <status:todo|done|clarify> "testo note"
  ```

  Niente token, niente rete: lo script scrive `feedback-triage/<id>.json` e lo
  **committa+pusha** lui stesso su `origin/main` (non dipende dall'hook). In
  alternativa puoi creare il file `feedback-triage/<id>.json` con l'editor: in
  quel caso lo committa l'hook di auto-commit. Una volta su `main`, la GitHub
  Action la applica da sola entro ~1-2 minuti. **Nel report finale di sessione,
  dì all'utente che le decisioni sono in coda e vengono applicate in automatico
  dalla Action** (nessuna azione manuale richiesta).

- **Applicazione automatica (GitHub Action — primario)**: il workflow
  `apply-triage.yml` esegue `scripts/apply-triage.mjs` autenticandosi col
  service account il cui JSON sta nel secret di repo `FILO_SA_KEY`. Patcha i
  feedback e committa la coda svuotata con `[skip ci]` (anti-loop). L'owner lo
  configura una sola volta (creare il service account + incollare la chiave nei
  Secrets) — vedi le istruzioni in `feedback-triage/README.md`. Da lì in poi è
  zero-touch.

- **Applicazione manuale (owner, in locale — fallback)**: se la Action è giù o
  vuoi applicare subito:

  ```bash
  npm run feedback:apply              # applica a Firestore e svuota la coda
  npm run feedback:apply -- --dry-run # mostra cosa farebbe, senza scrivere
  ```

  In locale usa un refresh token Firebase dell'account **owner** in
  `FILO_ADMIN_REFRESH_TOKEN` (NON il service account). Setup una tantum:
  `node scripts/admin-login.mjs` (login Google con l'account owner, quello in
  `admins`/`adminEmails`), poi salva il refresh token stampato come
  `FILO_ADMIN_REFRESH_TOKEN` nel file `tests/agent/.env` della **root del repo
  principale** (`C:/Users/agenti AI/Desktop/Filo/Filo/tests/agent/.env`), accanto
  alla chiave Gemini. È **gitignorato**: NON viene committato. L'applier sceglie
  in automatico: service account se presente (`FILO_SA_KEY` /
  `GOOGLE_APPLICATION_CREDENTIALS`), altrimenti il token admin. **Non mettere mai
  `FILO_ADMIN_REFRESH_TOKEN` nel cloud**: resta SOLO su questa macchina. Se il
  refresh dà 401/403, rigeneralo con `admin-login.mjs`.

**Workflow**: quando l'utente chiede di "risolvere i feedback", lavora
**solo** sui feedback con status `todo` ("Da risolvere"). Ignora quelli
in `new` (inbox), `draft` (bozze — richiedono decisioni di design dell'utente),
`done` (già risolti, in attesa di verifica), `verified` e `ignored`.

**Ordine di lavorazione = priorità.** Ogni feedback ha un campo `priority`
(intero 0-3, dove 3 = massima urgenza, 0/assente = nessuna priorità assegnata).
Tra i feedback `todo`, **affronta sempre per primi quelli con `priority` più
alta**; a parità di priorità, parti dai più recenti. Non azzerare né modificare
la `priority` di un feedback (è un segnale dell'utente): toccala solo se
l'utente te lo chiede esplicitamente.

Per ogni feedback `todo`:
1. Leggi testo + screenshot allegati. **Distingui sintomo da causa**: la
   lamentela descrive ciò che l'utente vede, non necessariamente cos'è
   rotto. Riformula in "l'utente voleva fare X, gli è fallito perché Y".
2. Trova il codice coinvolto. Se due cammini fanno cose simili (es. Ctrl+V
   e "Incolla" dal menu) leggili affiancati: le **simmetrie mancanti** sono
   spesso la causa.
3. Implementa il fix sul **comportamento**, non sul messaggio. Se ti trovi
   a cambiare solo una stringa per un bug funzionale, fermati e ripensa.
4. Considera le **invarianti UX ovvie** intorno al fix (vedi sezione
   "Iniziativa" sopra) e applicale, elencandole nel report.
5. **Verifica con un test che asserisce successo** (vedi sezione "Test che
   servono davvero"):
   - In cloud: `npm test` + un test Playwright che eserciti il flusso
     dell'utente e asserisca che la feature fa la cosa giusta (non solo che
     un messaggio è cambiato).
   - In locale: `npm run test:shoot` con scenario mirato + ispezione visuale.
6. Solo se la verifica passa: **accoda** lo status `done` con
   `node scripts/queue-triage.mjs <id> done "testo note"` (in cloud) o, in
   locale dopo aver applicato, vedi sopra. Nelle `notes` scrivi un breve report
   (vedi "Tono dei report e delle notes"): cosa vedrà l'utente di diverso, cosa
   hai aggiunto oltre il chiesto, come l'hai testato. La decisione finisce nella
   coda `feedback-triage/` e diventa effettiva su Firestore in automatico, via la
   GitHub Action, entro ~1-2 minuti dal push. Stesso meccanismo per `clarify`.

**Insistere prima di mollare (vale soprattutto per routine cloud):**
non abbandonare al primo intoppo. Se un test fallisce, capisci perché e
ritenta con un approccio diverso. Se il fix che hai scelto non funziona,
prova un altro. Se non trovi il codice giusto al primo colpo, cerca con
pattern diversi. **L'unica ragione legittima per non chiudere un feedback
è una di queste tre:**

a) **Il feedback è ambiguo** — non riesci a capire cosa l'utente voglia
   davvero, anche dopo aver letto testo + screenshot + codice circostante.
b) **Richiede una decisione di design** — il fix esiste tecnicamente ma
   ci sono N modi non equivalenti e non sai quale preferisca l'utente.
c) **Mancano informazioni concrete** — il feedback fa riferimento a uno
   stato o a un comportamento che non puoi riprodurre dai dati disponibili
   (es. "il pulsante X non funziona" ma X non esiste nel codebase con quel
   nome).

In uno di questi casi: **sposta il feedback in stato `clarify`** (non
`done`, non `todo`), e nelle `notes` scrivi:
- cosa hai capito del feedback
- cosa hai provato (se hai provato)
- *cosa ti serve sapere* per procedere — domande specifiche, non vaghe

L'utente le vede nel tab "Chiarimenti" della dashboard, risponde, e poi
le rimette in `todo` per la prossima routine.

**Non usare `clarify` come scappatoia.** "Non sono sicuro al 100%" non è
ambiguità: prova la cosa più ragionevole, verificala, e se funziona chiudi.
`clarify` è per feedback che ti bloccano davvero, non per quelli che ti
fanno solo dubitare.

## Cosa NON è in scope

- L'estensione MV3 (`../extension/` o `../ROBA VECCHIA/extension-mv3/`) è
  congelata. Niente fix né nuove feature lì. Se l'utente dice "fai X anche
  sull'extension", **chiedi conferma** — di solito vuole solo Filo. La config
  Firebase non vive più lì: è stata spostata nella root di Filo, quindi
  `../extension/` può essere eliminata senza rompere il deploy delle rules.

## Workflow worktree

Per ogni nuovo task crea un worktree dedicato:

```bash
git worktree add .claude/worktrees/<slug> -b claude/<slug>
```

Auto-commit e auto-merge su `main` avvengono via hook a ogni Edit/Write
(vedi `.claude/hooks/`). Non serve committare a mano.
