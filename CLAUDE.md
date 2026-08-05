# Istruzioni per Claude Code

Questo file raccoglie le **convenzioni del repo valide per QUALSIASI agente**
(locale o cloud). La recipe operativa specifica vive altrove a seconda di chi sei
→ vedi lo "switch di ruolo" qui sotto.

## Switch di ruolo — leggi PRIMA il file giusto

- **Sessione locale** (owner + Claude, prompt normale in chat) → leggi anche
  **`LOCAL.md`** (cosa si fa in locale, modalità attiva oggi).
- **Routine cloud** (attivazione schedulata con prompt: 
  `"routine automatica."`) → leggi **`ROUTINES.md`** integralmente, più i
  file-ruolo in **`routines/roles/*`** e la conoscenza condivisa in
  **`routines/shared.md`**. L'orchestratore banale spawna un worker che lancia
  `scripts/dispatch.mjs`, che sceglie il ruolo e inlina il file-ruolo giusto.

In entrambi i casi valgono le convenzioni di questo file.

## Filosofia e design — lettura obbligatoria prima di codice/revisioni

Nella root del repo vivono due documenti dell'owner:

- **`filo_filosofia.txt`** — la filosofia generale di Filo (cos'è, mindset,
  decisioni ad alto livello);
- **`filo_design.txt`** — i principi di design concreti (interattività, attesa,
  gestione modelli, personalizzazione, estetica).

**Qualsiasi istanza che lavora sul codice o fa revisioni** (sessione locale,
routine cloud, ruoli fixer/new-work/verifier…) **deve leggerli ENTRAMBI** prima
di iniziare. I giudici L2 (filo-security) usano solo `filo_filosofia.txt`, come
copia incorporata nei loro prompt: se modifichi `filo_filosofia.txt`, riallinea
la copia in `filo-security/functions/src/l2/principles.js` e rideploya le
functions.

## PRIMA DI TUTTO: sync con `origin/main`

Routine remote pushano su `origin/main` durante la giornata. Prima di iniziare
**qualsiasi** task, sincronizza il repo locale (allinea anche tutti i worktree,
condividono lo stesso `.git`):

```bash
git -C "C:/Users/agenti AI/Desktop/Filo/Filo" pull --rebase origin main
```

Se il pull fallisce per conflitti, riolvi in utonomia, chiedi all'utente solo se ci sono decisioni importanti.

## Push automatico su `origin/main`

L'hook `.claude/hooks/auto-commit-merge.sh` committa, mergia i worktree e **pusha
`main` su `origin`** dopo ogni Edit/Write. Non servono push manuali. Se vedi
`[auto-push] FAILED` in stderr, il push è stato rifiutato (di solito una routine
remota ha pushato nel frattempo): fai `git pull --rebase origin main` e poi un
Edit qualsiasi farà ripartire il push automatico, oppure pusha a mano:

```bash
git -C "C:/Users/agenti AI/Desktop/Filo/Filo" push origin main
```

## MAI committare artefatti dei test (evita i conflitti di rebase)

Gli screenshot dei test sono **output rigenerato**, non sorgente. Sessioni locali
e routine cloud li riscrivono di continuo: se finiscono in git generano
**conflitti binari** a ogni `pull --rebase` (git non sa fondere due PNG). Per
questo TUTTE le cartelle di artefatti sono gitignorate: `tests/.shots/`,
`tests/.smoke/`, `tests/.report/`, `tests/agent/.out/`, `tests/agent/reports/`,
`test-results/`, `.feedback-images/`, `tests/.fb/*.png` (lo script
`render-popup.mjs` lì dentro resta versionato).

- **Non committare mai** questi file e **non rimuoverli dal `.gitignore`**.
- Gli screenshot sono **traccia locale della singola run** (ispezionali subito
  dopo il test), non file versionati.
- Se un PNG di screenshot risulta di nuovo tracciato
  (`git ls-files tests/.shots/` ritorna qualcosa): `git rm --cached <file>` e
  lascialo gitignorato.

## REGOLA DURA: niente "fatto" senza verifica

**Non dichiarare mai un task completato (né tornare il controllo all'utente, né
chiudere un feedback come `done`) senza aver verificato che la feature funzioni
davvero.** "Funziona davvero" = **eseguire il codice** toccato, non solo "compila"
o "ho letto il diff".

Il minimo accettabile dipende dall'ambiente:

- **In sessione locale (Windows)**: verifica **solo la feature toccata**, non
  l'intera suite. ⚠️ **NON lanciare `npm test` (suite completa) in locale**: apre
  e chiude Electron centinaia di volte — finestre che lampeggiano mentre l'utente
  usa il PC — ed è lentissimo (~25 min). La regressione completa sulle feature
  vecchie è compito delle routine cloud. In locale usa invece:
  - **prima scelta per la logica pura — gli unit test**: `npm run test:unit`
    (runner `node:test`, gira in ms **senza aprire Electron**). Se hai toccato
    logica pura (parsing, classificazione, validazione, trasformazioni in
    `src/shared/*` o servizi che non toccano Electron), **aggiungi/aggiorna uno
    unit test in `tests/unit/`** e lancialo (vedi `tests/unit/README.md`).
  - **lo/gli spec mirati** della feature toccata:
    `npx playwright test tests/<feature>.spec.mjs` (1-2 avvii di Electron, pochi
    secondi) — minimo accettabile per dichiarare "fatto" in locale;
  - per modifiche visive, `npm run test:shoot` con uno scenario mirato +
    ispezione dello screenshot (vedi "Controlli visivi").

  Non rilanciare l'intera suite "per sicurezza": se temi una regressione altrove,
  lascia che la verifichi la routine cloud.

- **In routine cloud (Linux headless)**: **qui** gira la regressione completa.
  `npm test` (intera suite Playwright); se la feature ha UI nuova, **aggiungi uno
  spec Playwright** che la eserciti (click + assert). `test:shoot` **ora funziona
  in cloud** tramite `scrot`/xvfb (vedi "Controlli visivi"); `test:explore` (LLM
  Gemini) dipende dalla chiave API in `tests/agent/.env` — può non essere
  disponibile.

- **Se la verifica non è possibile** (es. richiede hardware che Playwright non
  simula): dichiaralo esplicitamente nel report finale — "implementato ma non
  verificato perché X", così l'utente sa che deve provarlo a mano.

## Test che servono davvero (asserire successo, non assenza di errore)

Il test deve **fallire prima del fix e passare solo se la feature fa la cosa
giusta**. Se può passare in entrambi gli stati cambiando solo un dettaglio
cosmetico (es. il testo di un messaggio d'errore), è inutile e maschera bug.

- **Asserire il successo**, non l'assenza di un errore. Se la lamentela è "non
  posso incollare un'immagine", verifica che l'immagine arrivi al destinatario
  (compare un `<img>`, un file finisce in un attachment store…), non che il toast
  d'errore non contenga "provider".
- **Pensa al comportamento, non al messaggio**. "Appare errore X" va tradotto in
  "la feature Y non funziona" prima di scrivere il fix. Cambiare la stringa
  dell'errore è il fix sbagliato 9 volte su 10.
- **Pre-condizione = stato in cui senza fix fallirebbe**. Immagina di rimuovere
  il fix appena fatto: il test deve diventare rosso. Se non sai *quale assert*
  diventa rosso, riscrivi gli assert.
- **In cloud (Playwright headless)**: per UI che cambia visivamente, oltre agli
  assert salva `page.screenshot()` in `tests/.shots/` (gitignorata) come traccia
  ispezionabile. Non è il primary signal, ma cattura regressioni visive.

## Sintomo vs causa: l'obiettivo è migliorare l'app, non chiudere il feedback

Un feedback descrive il sintomo come lo vede l'utente. La prima domanda non è
"come faccio sparire questo errore" ma **"cosa stava cercando di fare l'utente, e
perché non gli è riuscito"**. Spesso la causa è in tutt'altra parte del codice.

Segnali di "stai fissando il sintomo":

- Stai per cambiare solo una stringa per chiudere un bug funzionale.
- Stai facendo passare il test SBAGLIANDO meno (messaggio meno fuorviante)
  invece di far funzionare la feature.
- Stai per chiudere senza poter rispondere a "se l'utente riprova adesso il
  flusso, gli funziona?". Se la risposta è no, non hai finito.

Segnale di causa vera: emergono **simmetrie mancanti** — due rami che fanno cose
simili divergono in modo sospetto, o un flusso A funziona ma il flusso B
equivalente no perché manca un pezzo. Leggi i due cammini affiancati.

## Iniziativa: completare l'invariante UX, segnalare sempre cosa hai aggiunto

Quando risolvi un feedback puoi (anzi: dovresti) prendere iniziativa sulle
**invarianti UX ovvie** che il feedback implica ma non chiede:

- Se l'utente può aggiungere X, deve poter rimuovere X.
- Se l'app salva N cose, l'utente deve poterle vedere tutte.
- Se Ctrl+V fa Y, anche "Incolla" dal menu deve fare Y (parità tra cammini
  equivalenti).

Queste non sono scelte di design — sono completezza. Falle.

**Regola d'oro anti scope-creep**: nel report finale **elenca esplicitamente cosa
hai aggiunto oltre il chiesto**. Senza elenco esplicito è invisibile e si accumula nel codice.

## Tono dei report e delle notes

I report finali (chat) e le `notes` su Firestore sono **per l'utente**, non per
un altro Claude. Le `notes` compaiono come conversazione nella dashboard di
gestione: sono l'unica traccia della lavorazione che l'owner vede.

- Niente nomi di variabili, funzioni, file con percorso assoluto. Spiega cosa
  l'utente vedrà di diverso, non come l'hai codato.
- Niente paragrafoni "Causa / Fix / Test" in stile diff review.
- **Completo, non telegrafico**: cosa hai fatto, **le decisioni che hai preso e
  perché** (scelte tra alternative, compromessi, cose lasciate fuori apposta),
  **tutto ciò che è emerso** lavorando (vincoli scoperti, dubbi rimasti), **cosa
  hai aggiunto oltre il chiesto**, **come l'hai verificato**. Un report di una
  riga rende il lavoro invisibile e non valutabile.
- Se serve memoria tecnica per la prossima passata (un vincolo non ovvio che
  potrebbe rompersi), aggiungi in fondo una sezione "Note tecniche" separata. Se
  non serve, **non scriverla**.

## Patch notes: aggiorna il changelog ad OGNI fix/feature visibile all'utente

Filo mostra un **recap aggiornamento** ad ogni nuova versione (popup all'avvio).
La sorgente è **`src/shared/patchNotes.js`** (IIFE su globalThis,
`SN_PATCH_NOTES`): lista ordinata di versioni, ciascuna con `features[]` e
`fixes[]` **scritte in italiano, per l'utente, NON tecniche**.

**Regola**: ogni volta che chiudi un fix o aggiungi una feature **visibile
all'utente** (qualcosa che vedrà o userà — non refactor/test/infra), aggiungi una
riga al **primo blocco della lista**, quello marcato `unreleased: true` ("in
lavorazione"):

- novità → `features: [...]`; correzione → `fixes: [...]`.
- Frase breve, orientata al beneficio, **senza spiegare perché era rotto né come
  l'hai codato**. Esempi giusti: *"Migliorata la visualizzazione delle schede con
  audio attivo"*, *"Ora puoi rimuovere le immagini allegate a un feedback"*.
- **MAI creare a mano un blocco con un numero di versione.** La versione in
  `package.json` è quella dell'**ultima release già pubblicata**: una nota messa
  sotto quel numero non la vede nessuno (chi ha già quella versione la salta, e
  la build che la portava è uscita prima che la nota esistesse). È esattamente
  come si perdevano le note (feedback #308, #393).
- Ci pensa la release: quando alza la versione,
  `scripts/stamp-patch-notes.mjs` timbra il blocco "in lavorazione" col numero
  della versione che sta uscendo e rimette in cima un blocco vuoto.
- Le voci puramente interne (refactor, test, build, hook) **non** vanno nel
  changelog.

Il file è la **singola sorgente di verità** sia del recap sia del calcolo "quante
patch sei indietro".

**`package.json` può essere più avanti dell'ultimo blocco del changelog**: è il
caso normale di un rilascio di sola manutenzione (nessuna modifica visibile
all'utente → nessun blocco, nessun popup). Non è un errore e non va "sistemato"
aggiungendo un blocco finto. Le guardie in `tests/unit/patchNotes.test.mjs`
verificano invece che il blocco "in lavorazione" ci sia sempre in cima, che
nessun blocco sia attribuito a una versione non ancora uscita e che il timbro
della release renda davvero visibili le note nel recap.

## Manifesto capacità: aggiorna `capabilities.js` ad OGNI capacità che cambia

Filo tiene un **manifesto curato di tutto ciò che sa fare**, visibile all'utente,
in **`src/shared/capabilities.js`** (IIFE su globalThis, `SN_CAPABILITIES`: voci
`{ id, title, category, desc, invoke, doesNot? }` **in italiano, per l'utente, NON
tecniche**). Serve all'agente dentro Filo per rispondere con verità a "puoi fare
X?" e riconoscere "non posso fare Y".

**Regola (stesso pattern dei patch notes)**: ogni volta che aggiungi/modifichi/
rimuovi una **capacità visibile all'utente**, aggiorna **nello stesso commit** la
voce corrispondente:

- nuova capacità → **aggiungi** una voce con `id` kebab-case **stabile** (non
  riusarne uno vecchio, non cambiarlo più dopo);
- capacità cambiata (diverso modo di invocarla, confine diverso) → **aggiorna**
  `desc`/`invoke`/`doesNot`;
- capacità rimossa → **togli** la voce (lasciarla è peggio: l'agente
  prometterebbe il falso).
- `desc`/`invoke`/`doesNot` sono per l'utente finale: niente nomi di file/funzioni.
  `doesNot` (il confine "cosa NON fa") è opzionale ma prezioso.
- Le voci puramente interne **non** vanno nel manifesto.

Un manifesto che mente è **peggio di uno assente**. L'unit test
`tests/unit/capabilities.test.mjs` incrocia alcune voci col codice reale (shortcut
globali, pagine `filo://`) e diventa **rosso** se una capacità deriva: lancialo
(`npm run test:unit`) dopo aver toccato shortcut, pagine interne o il manifesto.

## Run / test

```bash
npm install                # Electron + Playwright (~150MB)
npm start                  # avvia la app
npm run test:smoke         # smoke headless con screenshot in tests/.smoke/
npm run test:unit          # unit test logica pura (node:test, no Electron, ms)
npm test                   # suite Playwright (~100 spec, ~25 min: solo in cloud)
```

Se `npm install` non scarica il binario Electron (succede su alcuni setup):
`node node_modules/electron/install.js`.

## Controlli visivi / agentici dopo OGNI feature

Gli unit test non vedono i bug **compositi** (shell + WebContentsView native) né
le regressioni visive. Dopo una feature, esegui un controllo visivo dell'area
toccata. Strumenti in `tests/agent/` (cattura la finestra reale composita,
vedi `tests/agent/README.md`):

1. **Controllo a vista (deterministico, gratis)** — `npm run test:shoot`:
   ```bash
   npm run test:shoot -- "nav:filo://editor/editor.html; click-view:#doc; type:ciao; shot:editor"
   ```
   Guarda gli screenshot in `tests/agent/.out/*.png` e verifica a occhio.
2. **Esplorazione guidata da LLM** — `npm run test:explore`:
   ```bash
   npm run test:explore -- --start filo://editor/editor.html --steps 10 \
     --task "<usa la feature appena fatta, passo per passo>"
   ```

**Modelli**: primario `gemini-3.1-flash-lite` (quota generosa), fallback
`gemma-4-31b-it` al 429. Chiave in `tests/agent/.env` (gitignorata).

**Come reagire:** bug ovvio (rotto, vuoto, crash) → **correggilo subito**; scelta
di design discutibile / non-bug → **NON** cambiarla di iniziativa, **segnalala**
all'utente; sospetto falso positivo dell'harness → **riproducilo con `test:shoot`**
prima di trattarlo come bug.

**In cloud (Linux headless)** `test:shoot` **gira**: usa `xvfb-run -a npm run
test:shoot -- "<scenario>"` come tester (`su tester -c "..."`) per catturare
screenshot compositi reali. `test:explore` dipende dalla chiave API Gemini.
Usa `npm run test:smoke` come sanity check rapido. Se non riesci a scrivere un
test affidabile (es. UI dipende da Firestore live): verifica con
`node -e "require('./src/...')"` che i moduli si caricano e dichiaralo nel report.

## Architettura (riepilogo)

```
src/main/                  Processo main Electron (Node)
  main.js / window.js / tabs.js / protocol.js / ipc.js / shortcuts.js
  shim/                    chrome.storage + chrome.* per i moduli portati
  services/
    loader.js              carica shared/* + background/* su globalThis
    handlers.js + handlers/  registro messaggi + handler per dominio
    providers/             openrouter, gemini, fallback
src/preload/               shell-preload / internal-preload / page-preload
src/renderer/              shell.html / shell.css / shell.js
src/pages/                 dashboard, options, history, feedback, manage, board…
src/shared/                IIFE moduli su globalThis (constants, messages, i18n,
                           feedback, patchNotes, capabilities, …)
src/content/               content scripts (menu, popup, sidebar, …)
src/styles/                CSS condivisi
```

Lo storage usa **`%APPDATA%/Filo/storage.json`** in produzione e
`$FILO_USER_DATA/storage.json` nei test.

## Convenzione di porting: IIFE su globalThis

Il codice condiviso è scritto come IIFE che si auto-registra su globalThis:

```js
(function (global) {
  global.SN_MODULE = { ... };
})(typeof globalThis !== 'undefined' ? globalThis : self);
```

`require()` nel main e nei preload esegue il file e i moduli si auto-registrano;
gli altri trovano `SN_CONST`/`SN_MSG`/ecc. su globalThis senza import espliciti.
Quando aggiungi un modulo shared/* o background/* **mantieni questo pattern** e
fai sì che `src/main/services/loader.js` lo `require()` nell'ordine corretto.

**Chrome shim** — il codice portato chiama `chrome.runtime.sendMessage`,
`chrome.storage.local`, `chrome.tabs.*`. Lo shim sta in tre file a seconda del
contesto: main process (`src/main/shim/chrome-api.js`), pagine `filo://`
(`src/preload/internal-preload.js`), pagine web esterne
(`src/preload/page-preload.js`). Per un nuovo tipo di messaggio: (1) definiscilo
in `src/shared/messages.js` (`MSG.*`); (2) gestiscilo nel modulo di dominio giusto
sotto `src/main/services/handlers/` con `on(MSG.X, async (msg, sender, origin) => …)`;
(3) per broadcast main→renderer usa `broadcastToTabs`/`broadcastLiveUpdate`.

## Test (fixture Playwright)

I test usano `_electron.launch` con il fixture `tests/fixtures/electron.mjs`:
`app` (ElectronApplication, userData isolato in temp), `shell` (Page della
BrowserWindow), `openTab(url)` (apre URL come tab → Page del WebContentsView),
`testServer` (mini HTTP server locale). Per selezionare la Page di un
WebContentsView usa `app.windows().find(...)` filtrando sull'hostname
(`waitForEvent('window')` è race-prone). Nota `capturePage` su WebContentsView:
bug Electron #24694 → empty image; il `smoke.mjs` aggira aprendo l'URL in una
BrowserWindow dedicata.

## Pattern e convenzioni UI — leggi `PATTERNS.md` PRIMA di toccare la UI

Il sapere su come si costruiscono le cose in Filo (pattern UI, design, filosofia
minimale) vive in **`PATTERNS.md`**. **Prima di toccare la UI o prendere una
decisione di design, leggilo** — vale anche per le routine. Quando stabilisci un
pattern nuovo, **aggiorna `PATTERNS.md`**.

## Feedback alpha tester — dati di accesso

I feedback arrivano da Firestore (progetto `filo-8b9cb`, collezione `feedback`),
via REST con API key in `src/shared/feedback.js`. La config Firebase
(`firebase.json`, `.firebaserc`, `firestore.rules`, `storage.rules`) vive nella
**root del repo Filo**. Deploy dalla root:

```bash
firebase deploy --only firestore:rules     # solo le regole Firestore
firebase deploy --only storage              # solo le regole Storage
firebase deploy                             # entrambe
```

Per le convenzioni di scrittura su Firestore (coda su git, `queue-triage.mjs`,
GitHub Action) e la macchina a stati dei feedback (`todo`→`working`→
`revision_*`→`done`, spec completa in **`FEEDBACK-STATES.md`**) → vedi
`ROUTINES.md` e `routines/shared.md`.

## Workflow worktree

Per ogni nuovo task crea un worktree dedicato:

```bash
git worktree add .claude/worktrees/<slug> -b claude/<slug>
```

Auto-commit e auto-merge su `main` avvengono via hook a ogni Edit/Write (vedi
`.claude/hooks/`). Non serve committare a mano.
