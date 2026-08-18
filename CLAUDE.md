# Istruzioni per Claude Code

Questo file raccoglie le **convenzioni del repo valide per QUALSIASI agente**
(locale o cloud). La recipe operativa specifica vive altrove a seconda di chi sei
→ vedi lo "switch di ruolo" qui sotto.

## Switch di ruolo — leggi PRIMA il file giusto

- **Sessione locale** (owner + Claude, prompt normale in chat) → leggi anche
  **`LOCAL.md`**, che sta **nella cartella SOPRA il repo** (`../LOCAL.md`), non
  qui dentro: descrive cosa si fa in locale ed è volutamente fuori dal repo
  pubblico. Non cercarlo in `Filo/` — non c'è, e non è un file perduto.
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

**Stessa cura per la macchina a stati.** Da quando le consegne delle routine
passano dal server (spec `ROUTINE-AUTH-SPEC.md`), le transizioni legali vivono
in due copie: `src/shared/feedbackStatus.js` qui e
`filo-security/functions/src/routine/stateMachine.js` là. Se cambi le
transizioni, il riempimento dello status cifrato o il tetto delle note,
**riallinea l'altra copia e rideploya**: due copie che divergono sono peggio di
una sola permissiva, perché la dashboard mostrerebbe una regola e il server ne
applicherebbe un'altra.

## PRIMA DI TUTTO: sync con `origin/main`

Routine remote pushano su `origin/main` durante la giornata. Prima di iniziare
**qualsiasi** task, sincronizza il repo locale (allinea anche tutti i worktree,
condividono lo stesso `.git`):

```bash
git -C "C:/Users/agenti AI/Desktop/Filo/Filo" pull --rebase origin main
```

Se il pull fallisce per conflitti, riolvi in utonomia, chiedi all'utente solo se ci sono decisioni importanti.

## Salvataggio continuo, pubblicazione UNA VOLTA a lavoro finito

L'hook `.claude/hooks/auto-commit-merge.sh` committa e pusha **il tuo ramo** dopo
ogni Edit/Write. Questa parte è preziosa e non si tocca: è ciò che salva il
lavoro quando una sessione viene interrotta di colpo.

Quello che **non** fa più (dal 2026-08-07) è portare ogni singola modifica sul
ramo principale. Il motivo: ogni 6 ore un automatismo prende `main` **così com'è**,
costruisce e distribuisce agli utenti; se la fotografia cadeva a metà sessione,
agli utenti arrivava un lavoro incompleto. In più ogni pubblicazione spostava
`main` sotto i piedi delle routine in corso, e faceva sì che il cancello di
sicurezza giudicasse una versione diversa da quella poi fusa.

**Quando il lavoro è finito**, chiudilo con:

```bash
npm run finish
```

Esegue i controlli (logica pura + gli spec delle aree toccate) e **solo se sono
verdi** fonde su `main` e pubblica, riportandoti sul tuo ramo. Se sono rossi non
pubblica niente. Per i soli controlli, senza fondere: `npm run finish:check`.

Se la fusione viene rifiutata perché `main` è avanzato (una routine ha pushato
nel frattempo): `git pull --rebase origin main` e rilancia.

### La verifica indipendente vale anche in locale (dal 2026-08-08)

`npm run finish` **non pubblica** finché un'istanza DIVERSA da quella che ha
scritto il codice non ha provato a romperlo. È lo stesso passaggio che in cloud
esiste da sempre, e serve perché i test scritti insieme al lavoro hanno gli
stessi punti ciechi di chi ha scritto il lavoro: passano anche quando la cosa
chiesta non si ottiene.

```bash
node scripts/verify-local.mjs start "<cosa aveva chiesto l'owner, con le sue parole>"
```

Stampa il compito da consegnare a **un'istanza nuova** (un subagente, non te
stesso). Quel testo contiene la richiesta e il ramo, **mai il diff né il tuo
report**: è l'isolamento che rende la verifica avversariale invece di una
rilettura compiacente. L'istanza che verifica registra l'esito con
`verify-local.mjs pass "…"` o `fail "…"`.

L'esito è legato al **commit** verificato: se dopo il PASS tocchi ancora il
codice, decade e va rifatto — altrimenti basterebbe farsi approvare una versione
e pubblicarne un'altra. `npm run finish -- --no-verify` salta tutto: è la
scorciatoia da usare solo quando serve davvero, e va detto all'owner.

Vale **anche se stai lavorando direttamente su `main`**: lì non c'è niente da
fondere, ma i controlli girano lo stesso e la pubblicazione avviene solo se
passano. Nessuna scorciatoia: l'hook non fa più atterrare niente su `main` da
solo, in nessuna forma del repo. Ci si arriva da qui o dal cancello di merge
delle routine — e questo non dipende da nessuna variabile d'ambiente che
qualcuno possa dimenticare di impostare.

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

- **In sessione locale (Windows)**: la regola "non lanciare mai la suite
  completa" **non vale più** (cambiata il 2026-08-07). Nasceva da quando il
  grosso del lavoro si faceva in locale; oggi in locale si fanno **poche cose
  critiche** e il grosso passa dalle routine, quindi il tempo in più è
  accettabile. Un controllo in più, al peggio, fa risparmiare tempo all'owner;
  al meglio trova ciò che gli sarebbe sfuggito.

  In pratica: **`npm run finish` prima di chiudere** (fa da solo logica pura +
  spec delle aree toccate, e solo se sono verdi fonde e pubblica). Lancia
  `npm test` per intero quando hai toccato qualcosa di trasversale o non sai
  quali spec siano rilevanti — sappi solo che apre e chiude Electron molte volte
  (~25 min), quindi avvisa l'owner prima. Gli strumenti singoli:
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

  Se temi una regressione altrove, **verificala**: non rimandarla alla routine.

- **In routine cloud (Linux headless)**: **qui** gira la regressione completa.
  `npm test` (intera suite Playwright); se la feature ha UI nuova, **aggiungi uno
  spec Playwright** che la eserciti (click + assert). `test:shoot` **ora funziona
  in cloud** tramite `scrot`/xvfb (vedi "Controlli visivi"); `test:explore` (LLM
  a pesi aperti) dipende dalla chiave OpenRouter in `tests/agent/.env` — può non
  essere disponibile.

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

### Se fai una cosa DIVERSA da quella chiesta, dillo per primo

Puoi consegnare qualcosa di diverso da quanto chiesto quando è oggettivamente
meglio — è incoraggiato. Ma **la deviazione va dichiarata in cima al report**, con
il perché. Non basta descrivere la cosa che hai fatto: se l'utente si aspettava A
e riceve B, deve leggere "ho fatto B invece di A perché…", non dedurlo usando
l'app.

Vale anche quando la richiesta era **implicita**: il feedback arriva spesso con
uno **screenshot** o un riferimento a un punto preciso della UI. Se l'immagine
indica un posto e tu ne scegli un altro, quella è una deviazione da dichiarare,
anche se a parole l'utente non aveva scritto dove.

Non dichiararla ha un costo doppio: l'utente non trova la cosa dove se
l'aspettava, e non può nemmeno valutare se la tua scelta era quella giusta.

## Tono dei report e delle notes

I report finali (chat) e le `notes` su Firestore sono **per l'utente**, non per
un altro Claude. Le `notes` compaiono come conversazione nella dashboard di
gestione: sono l'unica traccia della lavorazione che l'owner vede.

Il report è **minimo per default**. L'owner ha già scritto il feedback e sa cosa
aveva chiesto: il report serve solo a dirgli *quello che non può dedurre da solo*.

**Struttura**:

1. **La conferma** — una riga: fatto, e cosa vedrà di diverso.
2. **Scelte funzionali** — solo se hai deciso qualcosa di diverso o in più
   rispetto al chiesto (vedi la regola qui sotto). Con il **perché**.
3. **Scelte tecniche non ovvie** — SOLO quelle che ricadono su di lui: uso di
   **servizi a pagamento** (quale modello, quante chiamate, quanto costa, perché
   quello e non un'alternativa più economica), **dati dell'utente** (cosa viene
   letto/inviato/salvato e dove), o altre **decisioni critiche** difficili da
   invertire dopo.

**NON scrivere mai**:

- la **ridescrizione del problema** (l'ha scritto lui);
- **come hai verificato** (test lanciati, spec, screenshot): è il tuo mestiere,
  non una notizia. Se una verifica NON è stata possibile, *quello* sì va detto;
- **comportamenti attesi** spacciati per risultati ("l'icona è nello stile di
  Filo e non un'emoji", "la x chiude", "Esc funziona"): è ovvio e inutile;
- nomi di variabili, funzioni, file, percorsi. Spiega cosa cambia per lui.
- paragrafoni "Causa / Fix / Test" in stile diff review.

Se resta un **vincolo tecnico non ovvio** che la prossima passata rischia di
rompere, mettilo in fondo sotto "Note tecniche". Se non c'è, non scrivere la
sezione.

**Esempio di report giusto**:

> Fatto. Ho messo la lente in alto a destra della barra delle schede e NON dove
> l'avevi indicata nell'immagine, perché cerca su tutte le sezioni insieme e non
> solo su quella aperta: legarla a una sezione avrebbe suggerito il contrario.
>
> La ricerca a senso passa il titolo e il testo di tutti i feedback a un modello
> a ogni ricerca (non usa un indice pre-calcolato): una ricerca = una chiamata a
> pagamento sul modello di Categorizzazione. Ho scelto così perché questa
> dashboard la usi solo tu e di rado; costruire un indice sarebbe costato di più
> di quanto risparmia. Se il modello non risponde, ripiega sulla ricerca per
> parole e te lo dice.

### Chi scrive il report: chi ha fatto il lavoro, e nessun altro

Il report lo scrive **l'istanza che ha scritto il codice** (`new-work` o
`fixer`), nel momento in cui passa il lavoro alla verifica. È l'unica che sa
quali alternative ha scartato, cosa costa in chiamate a pagamento e cosa ha
deciso di lasciare fuori: un'istanza successiva quelle cose può solo
ricostruirle a naso, e in genere le riempie di dettagli inutili.

Nella stessa passata quell'istanza produce **tre testi distinti**:

1. **il report per l'owner** — la nota che accompagna il feedback (struttura qui
   sopra). **Viene cifrato**: lo legge solo l'owner, nessun altro;
2. **la frase per chi ha mandato il feedback** — **una riga** in chiaro, che dice
   cosa può fare adesso, senza scelte tecniche né alternative scartate. Chi ha
   segnalato non ha la chiave del report: senza questa frase vede solo "risolto".
   Si consegna con `--frase "…"` (owner: `npm run feedback -- … --frase "…"`).
   Se il lavoro non cambia niente di visibile per chi ha segnalato, non si
   scrive;
3. **la riga di changelog** — vedi "Patch notes" più sotto. **Una riga**, molto
   più asciutta del report, e **spesso nessuna**: se il lavoro tocca solo
   superfici riservate all'owner o parti interne, non si scrive niente.

Non sono lo stesso testo accorciato: il report parla all'owner di scelte, la
frase parla a chi ha segnalato di quel problema lì, la riga di changelog parla a
un utente qualunque di cosa può fare adesso.

**I ruoli a valle non riscrivono il report.** `verifier`, `secaudit` e chi chiude
la pratica aggiungono **al massimo una riga** sull'esito del proprio passaggio
(es. "bloccato dal cancello di sicurezza: serve la tua approvazione"), in coda a
quello esistente. Non lo rigenerano da capo: il risultato sarebbe un racconto di
seconda mano, più lungo e meno vero dell'originale.

## Patch notes: aggiorna il changelog ad OGNI fix/feature visibile all'utente

Filo mostra un **recap aggiornamento** ad ogni nuova versione (popup all'avvio).
La sorgente è **`src/shared/patchNotes.js`** (IIFE su globalThis,
`SN_PATCH_NOTES`): lista ordinata di versioni, ciascuna con `features[]` e
`fixes[]` **scritte in italiano, per l'utente, NON tecniche**.

**Il destinatario è l'UTENTE COMUNE, non l'owner.** Prima di scrivere una voce,
chiediti: *una persona qualsiasi che ha installato Filo può usare questa cosa?*

- **No** → nessuna voce. Le superfici riservate all'owner (dashboard di gestione,
  statistiche red team, automazioni, log) e tutto ciò che è interno
  (refactor, test, build, hook, routine) **non entrano nel changelog**: per chi
  legge sarebbero il racconto di una funzione che non può nemmeno aprire.
- **Sì** → **una riga sola**. Non un paragrafo: il recap è un popup che si scorre
  in dieci secondi, non un report.

**Regola**: ogni volta che chiudi un fix o aggiungi una feature che supera quel
filtro, aggiungi **una riga** al blocco della versione corrente:

- novità → `features: [...]`; correzione → `fixes: [...]`.
- Frase breve, orientata al beneficio, **senza spiegare perché era rotto né come
  l'hai codato**. Esempi giusti: *"Migliorata la visualizzazione delle schede con
  audio attivo"*, *"Ora puoi rimuovere le immagini allegate a un feedback"*.
- Se la versione corrente non ha ancora un blocco, crealo con `version` = quella
  in `package.json` e la data di oggi; altrimenti **accoda** alla versione
  corrente.

Il file è la **singola sorgente di verità** sia del recap sia del calcolo "quante
patch sei indietro". Tienilo allineato a `package.json`.

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
npm test                   # suite Playwright (~100 spec: solo in cloud)
```

**Gli spec Playwright NON mostrano più la finestra** (dal 2026-08-08): l'app parte
fuori dallo schermo, trasparente e senza fuoco, così lanciare i test mentre
l'owner lavora non gli fa lampeggiare finestre davanti. Vale per **tutti** gli
spec, anche i ~50 che lanciano Electron per conto proprio senza passare dalla
fixture: l'interruttore sta in `playwright.config.js`, sull'ambiente del worker,
e ogni lancio lo eredita. Tutto il resto funziona identico — menu nativi
compresi, che sono finestre a sé e vengono resi invisibili anche loro — e gli
screenshot dei test vengono lo stesso (passano dal debugger, non dal compositor).

Il "come" e i due modi in cui la protezione era caduta stanno in
`src/main/test-window-mode.js`; `tests/hidden-window.spec.mjs` la sorveglia.
Per guardare l'app mentre uno spec la pilota: `FILO_TEST_VISIBLE=1 npx playwright
test …`. `test:shoot` e `test:smoke` restano visibili sempre: lì la finestra
fotografata **è** il risultato.

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

**Modelli**: primario `google/gemma-4-31b-it`, fallback
`google/gemma-4-26b-a4b-it` al 429 — pesi aperti serviti da fornitori
indipendenti via OpenRouter, come vuole la politica sui modelli (che vale anche
per gli strumenti che testano Filo). Chiave `OPENROUTER_API_KEY` in
`tests/agent/.env` (gitignorata): **nessuna chiave Google**.

**Come reagire:** bug ovvio (rotto, vuoto, crash) → **correggilo subito**; scelta
di design discutibile / non-bug → **NON** cambiarla di iniziativa, **segnalala**
all'utente; sospetto falso positivo dell'harness → **riproducilo con `test:shoot`**
prima di trattarlo come bug.

**In cloud (Linux headless)** `test:shoot` **gira**: usa `xvfb-run -a npm run
test:shoot -- "<scenario>"` come tester (`su tester -c "..."`) per catturare
screenshot compositi reali. `test:explore` dipende dalla chiave OpenRouter.
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

**Chi scrive sui feedback, e come.** Ci sono due strade, e una sola per ciascuno:

- **tu (sessione locale)** → `npm run feedback -- <id> <status> "nota"`. Scrive
  direttamente con le tue credenziali e valida il passaggio di stato leggendo lo
  stato VERO. Se stai chiudendo a mano una pratica dell'iter di lavorazione
  (presa in carico, consegna, chiusura di un fix) aggiungi `--come-routine`: la
  macchina a stati distingue chi scrive, e quei passaggi appartengono alle
  routine;
- **le routine** → il canale autenticato verso il server, che valida ogni
  consegna. Non hanno, e non devono avere, un altro modo.

La coda su git, l'automatismo che la applicava e i semafori come file **non
esistono più** (spec `ROUTINE-AUTH-SPEC.md`): le note — cioè i report scritti per
te — ci passavano in chiaro dentro un repo pubblico, e ci restavano anche dopo.

Macchina a stati dei feedback (`todo`→`working`→`revision_*`→`done`): spec
completa in **`FEEDBACK-STATES.md`**; il flusso delle routine in `ROUTINES.md`.

## Workflow worktree

Per ogni nuovo task crea un worktree dedicato:

```bash
git worktree add .claude/worktrees/<slug> -b claude/<slug>
```

Auto-commit e auto-merge su `main` avvengono via hook a ogni Edit/Write (vedi
`.claude/hooks/`). Non serve committare a mano.
