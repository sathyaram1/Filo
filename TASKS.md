# TASKS — coda di lavoro persistente tra sessioni

Questo file è il ponte tra sessioni Claude. Quando una sessione finisce (per
contesto, per tempo, o perché l'utente chiude), la prossima riparte da qui.

## Come si usa (istruzioni per Claude)

- **L'utente dice "continua" (o simili)** → leggi questo file, prendi il primo
  task `[ ]` dall'alto, marcalo `[~]` (in corso), lavoralo, e a fine sessione
  marcalo `[x]` con una riga di esito. Se resta a metà, lascia `[~]` e scrivi
  nelle note **dove sei arrivato e qual è il prossimo passo concreto**.
- **L'utente consegna una spec grossa** → NON iniziare a implementare subito.
  Prima spezzala in task da una sessione l'uno (~sotto i 100k token di lavoro
  stimato), scrivili qui sotto con questo formato, fatti confermare l'ordine
  dall'utente, poi parti dal primo.
- **Ogni task deve essere self-contained**: chi lo legge non ha memoria delle
  conversazioni precedenti. Percorsi file, criterio di "fatto", e vincoli vanno
  scritti nel task stesso.
- **Budget contesto**: chiudi la sessione PRIMA di superare ~150k token di
  contesto (oltre i 200k il costo sale del 50%). Quando ti avvicini, finisci il
  pezzo atomico in corso, aggiorna questo file, e di' all'utente: "ok, fatto X —
  apri un'altra istanza e dimmi *continua*".
- Aggiorna questo file con Edit normale (l'hook committa e pusha da solo).

## Formato task

```
- [ ] **Titolo breve** — descrizione self-contained: file coinvolti, cosa fare,
  criterio di fatto, come verificare. (stima: S/M/L)
```

`[ ]` = da fare · `[~]` = in corso (vedi note) · `[x]` = fatto

---

## Coda

### Sistema routine: verifica avversariale + cancello di merge + utilizzo budget (spec 2026-06-22)

Spec utente (chat 2026-06-22). Obiettivo: rendere il ciclo delle routine cloud
più sicuro e capace di **sfruttare tutto il budget 5h** disponibile su **2
account** Filo. Decisioni di design confermate dall'utente:

- **Verificare TUTTO, non selettivo.** Anche un CSS mediocre è un difetto in
  un'app che vive di UX. Niente giudice "quale feedback verificare": si verifica
  ogni correzione. Il verificatore è un sotto-agente sull'abbonamento → zero
  costi API extra.
- **Verifica indipendente e avversariale.** Chi verifica NON è chi ha corretto
  (spawn separato, parte freddo, vede SOLO il sintomo utente del feedback —
  mai il diff/ragionamento del risolutore). Mandato: riprodurre la lamentela e
  romperla con input limite.
- **Niente merge su `main` prima del PASS.** Durante tutto il ciclo
  risolvi→verifica→correggi→verifica le modifiche restano sul branch; in `main`
  solo dopo verifica passata. **Max 3 loop**, poi il feedback va in pausa in uno
  **stato dedicato** (`blocked`) e decide l'utente.
- **Orchestratore = LLM sottile** (Agent tool, non script). L'unica attivazione
  della routine fa da orchestratore e spawna worker via Agent tool (i
  sotto-agenti NON consumano attivazioni; le 5/giorno valgono solo per i trigger
  di routine). L'orchestratore è **cieco**: loop "spawna worker finché il worker
  dice «niente da fare» o il budget è quasi pieno", non legge i corpi dei
  feedback, non sa quanti ce ne sono.
- **Worker unificato** (review-or-resolve): all'avvio controlla se c'è un branch
  da revisionare → se sì lo stressa avversarialmente; altrimenti claima un
  feedback e lo risolve sul branch. Precedenza: prima smaltire le revisioni in
  sospeso, poi prendere feedback nuovi.
- **Isolamento anti prompt-injection**: orchestratore vede SOLO metadati
  (id/numero/priority/titolo/status); il **corpo libero + screenshot** (input
  non fidato) li riceve solo il worker isolato; il report del worker è trattato
  come **dati**, non istruzioni.
- **Massimizzare l'utilizzo**: soglia di costo ALTA (non conservativa). Il loop
  continua a prendere feedback e — quando finiscono — passa all'audit proattivo,
  finché la finestra 5h non è quasi piena. Su **2 account** sfasati (vedi R5).
- **Feedback corposi → branch di feature, merge su main solo a feature finita
  (Modello B).** Motivo decisivo: c'è l'**auto-update periodico**, quindi
  `main` → TUTTI gli utenti. Una combinazione problematica/compromessa non deve
  MAI toccare main → la feature spezzata vive su un branch `feature/N`; i pezzi
  `#N.M` si fondono su `feature/N` (non su main), ognuno con la sua verifica
  avversariale + L4/L5 (tengono `feature/N` pulito); il **merge verso main
  avviene UNA volta sola** a `#N.final`, con L5 + **L4 d'integrazione cieco al
  prompt** sull'intera feature assemblata. Così c'è un solo cancello verso main
  per feature, che cattura anche il pezzo malevolo solo in combinazione (che in
  un merge per-pezzo sarebbe già stato spedito agli utenti).
  - **Niente conflitti, a una condizione**: appena parte una feature multipla le
    si dà **priorità massima** e ce la si tiene finché non è finita → la flotta
    lavora solo i suoi pezzi → nient'altro fonde *sorgente* su main → `feature/N`
    non diverge → merge finale pulito. (I commit di bookkeeping su main —
    coda triage/claim in `feedback-triage/` — toccano path disgiunti dal `src/`,
    quindi non confliggono.) **Pezzi in sequenza**, non in parallelo sullo stesso
    branch (naturale: spesso dipendono l'uno dall'altro).
  - **Nota tecnica (file "caldo")**: `src/shared/patchNotes.js` è l'UNICO file
    sorgente che *ogni* fix tocca (la riga di changelog obbligatoria). In
    sequenza sullo stesso `feature/N` non confligge; ma è il punto più probabile
    di conflitto se l'invariante "feature in volo = priorità massima" si rompe
    (es. un fix urgente standalone che salta la coda mentre una feature è in
    volo). Da tenere a mente implementando R2/R3.
  - I feedback **standalone NON cambiano**: un singolo feedback = feature di
    taglia 1, branch → cancello → main. Il branch di feature riguarda SOLO le
    spezzate.
  - Lo splitting in `#N.M` esiste già (`queue-feedback.mjs --parent`).
- **Sicurezza auto-modifica L4+L5 nel cancello di merge (PER-PEZZO).** Protegge
  dal caso di una routine pilotata da un feedback con injection che committa
  codice cattivo. **L5** (blocco deterministico sui file sensibili) e **L4**
  (review LLM del diff *cieca al prompt*) girano nel merge-gate **prima** che
  ogni branch entri in main — per-pezzo, perché un controllo "solo alla fine"
  sarebbe senza denti (i pezzi sarebbero già atterrati). In più un **L4
  d'integrazione** sul diff dell'intera feature alla fine, per i problemi
  cross-pezzo. Allineare le definizioni L4/L5 al DESIGN di filo-security
  ([[auto-improvement-loop]] in memoria).

Macchina a stati feedback: `todo` → (worker risolve sul branch) → `review`
(branch pronto, campo `branch` col nome) → verifica avversariale → PASS: merge
su main + `done`; FAIL: correggi e ri-verifica (max 3 loop) → dopo 3 fail
`blocked`. Ordine = dipendenze. Numerare R1..R5.

- [x] **R1 — Nuovi stati feedback (`review`, `blocked`) + campo `branch`** —
  _(fatto: routine affectionate-faraday-ckt1iw, 2026-06-22. Aggiunti `review`/`blocked`
  all'enum admin di `firestore.rules` + campo `branch` (string, <=200) in
  `affectedKeys().hasOnly`; ramo `isRoutine` lasciato invariato — lo decide R3, e
  comunque le routine ora scrivono via Action service-account che bypassa le rules.
  Dashboard: due tab "In revisione" + "Bloccati" con conteggio e badge `⎇ branch`
  sulle card. Script `queue-triage.mjs` (nuovi status + opzione `--branch`) e
  `apply-triage.mjs` (status + patch del campo `branch`). Spec
  `tests/feedback-review-blocked-tabs.spec.mjs` verde + suite completa (484 passed,
  2 flaky proxy non correlati). **MANCA AZIONE OWNER**: `firebase deploy --only
  firestore:rules` perché i nuovi stati/campo siano accettati lato server.)_
  Aggiungi i due stati al modello feedback in tutti i punti che li enumerano:
  (a) `firestore.rules` ramo admin update riga ~143 (enum `status` → aggiungi
  `'review'`, `'blocked'`) e `affectedKeys().hasOnly([...])` (aggiungi `'branch'`
  + validazione: string, <=200); valuta se anche il ramo `isRoutine` serve
  ancora (le routine scrivono via Action service-account che bypassa le rules —
  vedi R3). (b) dashboard feedback (`src/pages/feedback/feedback.js` +
  `feedback.html`): due tab nuovi **"In revisione"** e **"Bloccati"**, con il
  conteggio e il branch mostrato sui `blocked`/`review`. (c) script di coda
  (`scripts/queue-triage.mjs`, `scripts/apply-triage.mjs`): accettare i nuovi
  status + il campo `branch`. **Done**: spec Playwright che apre la dashboard e
  asserisce i due tab + che un feedback in `review` mostri il branch; `node
  --check` sugli script. **Azione manuale**: `firebase deploy --only
  firestore:rules` (le rules non si auto-deployano — vedi memoria
  [[feedback-schema-rules-deploy]]). (stima: L)

- [ ] **R2 — Cancello di merge nell'hook auto-commit** — Modifica
  `.claude/hooks/auto-commit-merge.sh`: i branch dei worker delle routine
  (prefisso da decidere, es. `worker/*` o `routine/*`) si **committano ma NON si
  fondono automaticamente su `main`**. La fusione avviene solo via un nuovo
  `scripts/merge-gate.mjs <branch>` (rebase su main + merge + push, con
  retry/rebase per push concorrenti dei 2 account) invocato dall'orchestratore
  al PASS. Il merge-gate è anche dove girano i controlli L4/L5 (R6): se L5
  blocca, NON fondere → `blocked`. **Topologia (Modello B)**: per una feature
  spezzata, i branch dei pezzi `worker/N.M` partono da `feature/N` e si fondono
  su `feature/N` (non su main); l'hook NON deve auto-fondere né i `worker/*` né i
  `feature/*` su main. Il merge verso main avviene solo via `merge-gate.mjs`,
  invocato dall'orchestratore: per pezzo dentro `feature/N`, e una volta sola
  `feature/N`→main a `#N.final`. Per i feedback standalone: branch → gate → main
  diretto. ⚠️ Le sessioni/branch NON-routine (lavoro locale dell'utente) devono
  restare **invariate**: l'auto-merge attuale continua per loro. **Done**: test che (1) una edit su un branch `worker/*` non arriva in
  `main`, (2) `merge-gate.mjs` lo porta in `main`, (3) una edit su un branch
  normale viene ancora auto-mergiata. Verifica con un repo di prova o asserzioni
  su git in uno spec. NON rompere l'auto-push esistente. (stima: L)

- [ ] **R6 — Controlli sicurezza L4/L5 nel cancello di merge** (dipende da R2) —
  Integra nel `merge-gate.mjs`, prima di ogni fusione su `main`: **L5**
  (deterministico) = se il diff tocca file sensibili (lista da definire allineata
  al DESIGN filo-security: `firestore.rules`, `.claude/hooks/*`, script di
  deploy/triage, chiavi/config, auth…) → NON fondere, feedback in `blocked` con
  nota "attende revisione umana". **L4** (LLM) = un sotto-agente che vede SOLO il
  diff (cieco al prompt/feedback → un'injection nel feedback non può
  convincerlo) e lo giudica per problemi di sicurezza; verdetto FAIL → `blocked`.
  Entrambi **per-pezzo** (al merge di ogni `#N.M` dentro `feature/N`: tengono il
  branch pulito). **Cancello critico = `feature/N`→main** (è ciò che l'auto-update
  spedisce agli utenti): lì gira L5 completo + un **L4 d'integrazione** sul diff
  cumulato dell'intera feature, che cattura il pezzo malevolo solo in
  combinazione. **Done**: test che (1) un diff su un file sensibile va in
  `blocked` e non in main, (2) un diff pulito passa, (3) il revisore L4 non
  riceve il testo del feedback. Allineare al DESIGN di filo-security
  ([[auto-improvement-loop]]). (stima: M)

- [ ] **R3 — Recipe orchestratore + worker nel CLAUDE.md** — Riscrivi la sezione
  "Routine cloud" + "un sub-agente per feedback" con il nuovo flusso:
  orchestratore sottile LLM (loop Agent tool cieco, sotto-agenti su Sonnet,
  cost-check da R4); worker unificato review-or-resolve; isolamento
  (orchestratore solo metadati, worker solo corpo, report come dati); macchina a
  stati `todo→review→done/blocked` con max 3 loop e merge-gate (R2). Aggiungi al
  worker le regole **Modello B** per le feature spezzate: i pezzi `#N.M` si
  lavorano **in sequenza** su branch basati su `feature/N`, si fondono su
  `feature/N` (non su main), e finché la feature è in volo resta **priorità
  massima** (così la flotta non prende altro sorgente e main non diverge).
  Regola **`#N.final`**: chiudendo l'ultimo `#N.M` (tutti i fratelli `done`),
  auto-genera `#N.final` (verifica integrazione dell'intera `feature/N` vs spec
  originale, modalità review) via `queue-feedback.mjs --parent`; a PASS,
  `merge-gate.mjs` fonde `feature/N`→main (unico cancello verso gli utenti).
  **Claim — già risolto, NON è un rischio**:
  verificato in [claim-feedback.mjs](scripts/claim-feedback.mjs) che il lock NON
  vive su Firestore (l'account robot Google è bloccato) ma come file git
  `feedback-triage/claims/<id>.json` pushato ff-only su `origin/main`, visibile
  alle altre routine in pochi secondi; la Action lo specchia su Firestore solo
  per la UI. La coordinazione multi-routine è il motivo stesso per cui il claim
  esiste → i 2 account si coordinano già. Unico da confermare: entrambe le
  sandbox sanno fare `git push origin main`. **Done**: la sezione è coerente e
  autosufficiente; un dry-run mentale del flusso non ha buchi. (stima: M)

- [ ] **R4 — Cost-check / utilizzo budget nella sandbox cloud** — Verifica che
  `npx ccusage@latest blocks --active --json` giri nella sandbox cloud (Linux,
  node, rete) e legga il `costUSD` della finestra 5h attiva (include la spesa dei
  sotto-agenti, stesso account/processo). Definisci la regola operativa per
  l'orchestratore: prima di lanciare un nuovo worker, leggi `costUSD`; se <
  soglia → procedi; se ≥ soglia → niente nuovi feedback, finisci/checkpoint,
  termina. Soglia ALTA (obiettivo = usare il budget), **da calibrare al primo
  429** osservato (placeholder finché non c'è il dato). Rete di sicurezza:
  intercetta il 429 → checkpoint stato + rilascio claim. **Done**: comando
  ccusage documentato + funzionante in cloud; regola scritta nel CLAUDE.md
  (insieme a R3). **NB**: la domanda "ccusage gira in cloud?" è già stata
  accodata come feedback diagnostico (2026-06-22, priorità 2, "Diagnostica:
  ccusage gira nella sandbox cloud?") — una routine lo testa e risponde in
  `clarify`. Aspettare quella risposta prima di implementare R4. (stima: M)

- [ ] **R5 — (UTENTE, su claude.ai) Scheduling 2 account sfasati** — NON è codice,
  lo fa l'utente nell'UI delle routine. Crea/aggiorna la routine su **entrambi**
  gli account Filo (non quello privato), cron ogni 6h **sfasati**: account A
  `0 0,6,12,18 * * *`, account B `0 3,9,15,21 * * *` (equidistanti 6h ciascuno,
  insieme coprono ogni ~3h, ogni run trova una finestra 5h fresca). Verificare
  che `git push origin main` sia autenticato nella sandbox di entrambi gli
  account. Dipende da R1-R4 fatti. (utente)

### Sicurezza: lettura feedback non più pubblica (spec 2026-06-22)

- [ ] **S1 — Lockdown lettura feedback + canale di lettura per le routine**
  (GATE del go-live routine) — Oggi `firestore.rules` ha `match /feedback`
  `allow read: if true`: chiunque (con la API key non-segreta del client) legge
  l'intero documento, **`status` incluso**. Con il nuovo sistema il feedback è
  una superficie d'attacco (injection nel testo) e `blocked` è il segnale "il tuo
  attacco è stato beccato" → lettura pubblica = **hill-climbing regalato**
  all'attaccante. Va chiuso. **Problema duro da risolvere INSIEME**: le routine
  oggi leggono i feedback *grazie* alla lettura pubblica e **non hanno auth
  sicura** (l'account robot è bloccato, niente secret store) — e il repo
  principale è **pubblico**, quindi non può ospitare i feedback. Le rules
  Firestore controllano la lettura **per-documento, non per-campo** (non puoi
  rendere pubblico `text` e privato `status`). **Il git è ANCH'ESSO un leak**
  (verificato 2026-06-22): `queue-feedback.mjs` e `queue-triage.mjs` scrivono
  `text`/`name`/`notes` in `feedback-triage/*.json` e fanno commit+push sul repo
  **pubblico**, e restano **nella history per sempre** anche dopo che la Action
  svuota la coda. Quindi S1 deve chiudere DUE canali: Firestore E il git.
  Due approcci candidati (da decidere, NON risolti):
  - **(A) Canale privato**: lettura Firestore solo admin/service-account + coda
    git spostata in un **repo privato** (es. `filo-security`). Pro: niente crypto,
    dedup/query in chiaro. Contro: serve risolvere l'auth delle sandbox routine a
    un repo privato + migrare la coda.
  - **(B) Cifratura (idea utente)**: l'app cifra i campi sensibili con una
    **chiave pubblica** di Filo prima di scrivere (Firestore o git); decifrano
    solo l'owner (dashboard, sulla sua macchina) e le routine (**chiave privata
    passata nel prompt della routine**). Pro: il ciphertext è innocuo ovunque →
    **collassa i due problemi** (Firestore pubblico e git pubblico restano ok,
    niente repo privato, niente auth-routine da risolvere) e batte l'hill-climbing
    (l'attaccante non ha la chiave). Contro: chiave-nel-prompt leakabile (ma il
    contenuto è anonimizzato → danno limitato; ruotabile), il groomer F5 e la
    dashboard devono decifrare, niente query server-side sui campi cifrati (la
    routine fa fetch-all + decrypt per filtrare i `todo` — ok in alpha). Gli
    **screenshot** sotto (B) si cifrano come tutto il resto (byte cifrati con la
    chiave pubblica prima dell'upload → lo Storage può restare pubblico, è
    ciphertext): uniforme, nessun trattamento speciale. Se si cifra anche
    `status`, l'hill-climbing è chiuso ma nessun lettore non-autenticato può
    filtrare per stato. **Chiave leakabile in 2 modi**: (1) esfiltrazione attiva
    (injection/errore) → mitigata tenendo la chiave SOLO nell'orchestratore
    (mai testo non fidato) + decrypt come step deterministico non-LLM (i worker
    ricevono plaintext, mai la chiave); (2) esposizione passiva = la chiave sta
    in chiaro nella config/log di claude.ai (non-vault) → se trapela, riapre
    l'hill-climbing (danno limitato dall'anonimizzazione, chiave ruotabile).
    Sotto (A) invece lo Storage va bloccato a parte (regole + canale autenticato).
  **Prima di toccare le rules**: controllare il DESIGN di filo-security
  ([[auto-improvement-loop]]) — la lettura pubblica + "pagina pubblica dei
  feedback" potrebbe essere una scelta documentata lì, da ribaltare
  consapevolmente. **Done**: nessun canale (Firestore né git) espone testo/note/
  stato dei feedback a non-admin; le routine leggono ancora la coda di lavoro.
  Questo task **fa da gate**: se si chiude la lettura senza il canale nuovo, le
  routine si rompono. (stima: L)

### Manifest capacità di Filo + feedback autonomo (spec 2026-06-22)

Spec utente (chat 2026-06-22). Due feature collegate: F4 dipende da F1/F2.
Obiettivo: l'agente dentro Filo conosce TUTTO ciò che Filo sa fare (manifest), e
quando l'utente chiede qualcosa di non supportato — o si lamenta di sfuggita di
qualcosa di rotto — Filo **invia un feedback in autonomia**, senza azione utente.

- [ ] **F1 — Manifest delle capacità (bootstrap retroattivo)** — Crea un file
  curato e strutturato (es. `src/shared/capabilities.js`, pattern IIFE su
  globalThis come `patchNotes.js`) che elenca OGNI capacità visibile all'utente.
  Per voce: `id`, `title`, descrizione in termini utente, come si invoca
  (shortcut/menu/pagina), `category`, e il confine **"cosa NON fa"** dove
  rilevante (serve a F4). Bootstrap = **audit vero del codice** (azioni menu in
  `src/content/*`, shortcut in `src/main/shortcuts.js`, pagine
  dashboard/options/history/credits, TTS/traduzione/spellcheck/salva-per-dopo/
  gestione tab…). **Done**: file completo, accuratezza verificata incrociando col
  codice (la "verifica retroattiva"). (stima: L)

- [ ] **F2 — Esporre il manifest all'agente di Filo (on-demand)** — Wire perché
  l'agente legga il manifest quando ragiona su "cosa può fare Filo / posso fare
  X?". NON in contesto a ogni turno: **indice compatto** (titoli/categorie)
  sempre disponibile + **dettaglio lazy** on-demand. **Done**: l'agente risponde
  correttamente "puoi fare X?" e riconosce "non posso fare Y". (stima: M)

- [ ] **F3 — Regola di sincronizzazione anti-stale** — Aggiungi al CLAUDE.md la
  regola: ogni capacità nuova/modificata visibile all'utente → aggiorna il
  manifest (stesso pattern della sezione "Patch notes"). + un angolo di audit per
  le routine che rileva il drift manifest↔realtà. **Done**: regola scritta nel
  CLAUDE.md. (stima: S)

- [ ] **F4 — Feedback autonomo da Filo** (dipende da F1/F2) — Quando l'agente
  conclude con confidenza ALTA (usando il manifest) che una richiesta è fuori
  capacità, o rileva una lamentela "di sfuggita" su qualcosa di rotto → compone e
  **invia un feedback senza azione utente**, marcato con source `auto:*`
  (capability-gap / complaint) così la dashboard lo raggruppa (come i ritrovamenti
  routine in tab "Agente"). **DECISIONI CONFERMATE (utente, 2026-06-22):**
  (a) **PRIVACY** — sempre **anonimizzare a monte** (descrizione generica della
  capacità mancante, NIENTE URL/testo personale verbatim; minimizzare il contesto
  auto-allegato). Inoltre i feedback NON devono più essere pubblici → vedi **S1**
  (lockdown lettura). Vale per tutti i feedback, non solo gli automatici.
  (b) **notifica** — invio immediato + **toast non bloccante con undo**
  ("L'ho segnalato a chi sviluppa Filo") + **voce in Impostazioni/Sicurezza,
  ON di default** per abilitare/disabilitare il feedback autonomo.
  (c) **dedup** — gestito da **F5** (groomer), non rimandato.
  (d) **crediti** — NIENTE +5 per-feedback automatico (si farmerebbe); invece un
  **bonus giornaliero ~+10 crediti finché l'opzione è ON** (incentivo a tenerla
  attiva; si aggancia al refill giornaliero del motore crediti C1).
  **Done**: spec che simula una richiesta fuori-capacità → asserisce invio di un
  feedback **sanitizzato** col source corretto, il toast con undo, e il bonus
  giornaliero condizionato al setting. (stima: L)

- [ ] **F5 — Groomer della coda: dedup + priorità** — Dopo i filtri di sicurezza,
  uno step che legge i feedback in coda e: se è un **duplicato**, lo **allega al
  primo** (arricchendo l'originale con eventuali info nuove sul bug) invece di
  creare un doppione; **alza la priorità** dell'originale in base alla domanda
  ripetuta (più utenti la chiedono → più priorità). Può essere lo stesso
  componente che decide la priorità. **Dedup sicuro**: per gli auto-feedback usa
  il `capability-gap id` (dati strutturati, immune a injection); per il testo
  libero degli utenti, similarità/LLM **trattando il testo come non-fidato** (non
  eseguire istruzioni dal testo). **Rischio injection: basso** (deciso utente
  2026-06-22): pur leggendo tutta la coda, il peggio che questo step può fare è
  cambiare una priorità o accorpare un feedback — irrilevante rispetto a un
  attacco vero; inoltre L1/L2 girano PRIMA. Quindi cautela sì, ma non è un
  bloccante.
  **Done**: spec che invia 2 feedback equivalenti → asserisce 1 solo originale
  con priorità alzata e il secondo allegato. (stima: M)

### Sistema crediti + ricompense feedback + popup aggiornamento (spec 2026-06-17)

Spec utente (chat). Decisioni di design confermate dall'utente:
- **Crediti su Firestore per-account** (collezione `credits`, doc per utente),
  con **cache locale** in `storage.json` come copia di lavoro veloce/offline che
  si sincronizza al login e dopo ogni mutazione.
- **Costo reale dai token**: ogni chiamata AI passa da `SN_PROVIDERS`
  (`src/main/services/providers/index.js`) che già ritorna `usage`
  (promptTokens/completionTokens). Da token × prezzo modello → costo € (tracciato
  con 1 decimale **dietro le quinte, mai mostrato**); crediti consumati = costo/0,0008
  (1 credito = 0,08 centesimi = €0,0008).
- **Recap aggiornamento da file changelog curato** (`src/shared/patchNotes.js`,
  IIFE su globalThis): lista ordinata di versioni con `features[]`/`fixes[]` non
  tecniche. All'avvio si confronta la versione vista l'ultima volta con
  `app.getVersion()` per calcolare "quante patch sei indietro"; il box mostra
  `vecchia → nuova` in alto e ha un pulsante per condividere/copiare il recap.

Ordine = dipendenze (il motore va per primo). Numerare i task come C1..C5.

- [x] **C1 — Motore crediti: ledger Firestore per-account + conteggio API a token + refill mezzanotte**
  (2026-06-17) — FATTO il motore + l'accounting + i test. Cosa c'è:
  `src/main/services/creditStore.js` (`SN_CREDITS`, logica pura + cache locale):
  saldo iniziale 1000, refill **+100/mezzanotte locale** lazy multi-giorno (tetto
  30 gg anti-abuso orologio), conversione costo€→crediti (1 cr = €0,0008),
  aggregazione **per tipo d'uso** (`SN_CONST.CREDIT_USAGE_GROUPS`: correttore,
  riordino schede, chat, traduzione…) e per-azione col costo€ **dietro le quinte**;
  `publicView` elimina il costo € dalla vista UI. Aggancio all'accounting:
  `costTracker.record` ora chiama `SN_CREDITS.recordConsumption` → **tutti** i ~7
  call site AI coperti senza ritoccarli. IPC `GET_CREDITS`/`CREDITS_CHANGED`/
  `CREDITS_AWARD_FEEDBACK` in `handlers/credits.js` (+wire in handlers.js). Sync
  Firestore `credits/<uid>` per-account: load/adopt al login (lazy su GET_CREDITS),
  push debounced su ogni mutazione, via REST con ID token utente (helper REST
  esportati da feedback.js). Regola Firestore `match /credits/{uid}` (owner-only).
  Costanti `CREDIT` (incl. FEEDBACK_SEND=5 e tabella priorità 50/100/200/300).
  Scaffold changelog `src/shared/patchNotes.js` + sezione CLAUDE.md "Patch notes".
  **Verificato**: `npm run test:unit` 326/326 verdi (16 nuovi in
  `tests/unit/creditStore.test.mjs`: refill multi-giorno, costo→crediti,
  aggregazione per uso, vista pubblica senza €, ricompense); `node --check` su
  tutti i file toccati OK.
  **NON verificato / azioni manuali richieste**:
  (1) il round-trip Firestore live NON è testato headless (serve utente loggato);
  (2) **le regole vanno deployate**: `firebase deploy --only firestore:rules` —
  finché non lo fai, la sync per-account fallisce silenziosamente e i crediti
  restano nella cache locale (offline). Caveat: client-authoritative (alpha),
  vedi commento nelle rules.
  — Crea un *credit store* nel main process (es. `src/main/services/creditStore.js`,
  IIFE/CommonJS coerente col modulo) che tiene il saldo + uno storico aggregato
  **per tipo d'uso** (chat, correttore ortografico, riordino schede, spiegazione,
  ricerca semantica, traduzione, ecc.) e la cache locale in `storage.json`.
  Sincronizzazione Firestore: doc per utente nella collezione `credits` (chiave =
  uid/localId della sessione, fallback email), scritto via REST col pattern di
  `src/shared/feedback.js` (`toValue`, FIRESTORE_BASE) e Bearer
  `auth.getIdToken()`. Saldo iniziale **1000**; **+100 a mezzanotte** (refill lazy:
  alla lettura/avvio confronta `lastRefillDate` con oggi e accredita i giorni
  mancanti, una volta sola per giorno). Aggiornare `firestore.rules` perché un
  utente legga/scriva **solo il proprio** doc credits (documentare il caveat
  abuso: client-authoritative, accettabile in alpha) e **deployare le regole**
  (`firebase deploy --only firestore:rules`). Agganciare il conteggio:
  centralizzare in `SN_PROVIDERS` o in un wrapper attorno ad esso un hook
  `onApiCall({ usage, model, tokens, costEur, credits })` e **etichettare ogni
  call site** (i ~7 in `handlers.js`/`ai.js`) con il proprio `usage` type via un
  parametro che arriva fino al provider. Tabella prezzi modelli (usare il pricing
  di OpenRouter quando disponibile dal model list; tabella statica per Gemini;
  fallback stima). IPC `credits_get` (saldo + aggregato per uso, **senza** il
  costo €) per la UI. **Done**: unit test in `tests/unit/` per (a) refill
  mezzanotte multi-giorno, (b) conversione token→costo€→crediti, (c) aggregazione
  per uso. Verifica: `npm run test:unit`. (stima: L)

- [x] **C2 — Pagina Crediti nel profilo + icona moneta cinese + grafico a torta**
  (2026-06-17) — FATTO. Voce **"Crediti"** aggiunta al menu account della shell
  (sia loggato sia sloggato), apre `filo://credits/credits.html` (servita
  automaticamente dal protocol handler `filo://<page>/` → `src/pages/<page>/`, no
  registrazione extra). Nuova pagina (`credits.html`/`.css`/`.js`): saldo grande
  con **icona moneta forata cinese + filo annodato** (nuova icona `credits` in
  `src/shared/icons.js`), **grafico a torta SVG fatto a mano** del consumo per
  TIPO D'USO (legge `byUsage` da `GET_CREDITS`, ogni fetta `data-group` + legenda),
  movimenti recenti dalle ricompense, hint refill/offline. **Mai** il costo in €
  (usa `publicView`). Live-refresh su `CREDITS_CHANGED`. Nuovo pattern in
  PATTERNS.md (chart SVG a mano, niente lib, CSP). Changelog aggiornato.
  **Verificato**: `tests/credits-page.spec.mjs` 2/2 verdi (saldo 700 dopo consumo
  seed, 2 fette con etichette giuste + valori in legenda; stato vuoto a 1.000) +
  `test:shoot` visivo dello stato vuoto (icona/tema/layout ok).
  — Aggiungi la voce **"Crediti"** nel menu account della shell
  (`src/renderer/shell.js:245`, ramo loggato e sloggato) che apre una nuova pagina
  `filo://credits/credits.html` (registrarla nel protocol/router come le altre
  pagine in `src/pages/`). La pagina mostra: saldo corrente, **icona moneta forata
  cinese con un filo che ci passa attraverso** (SVG nuovo, da aggiungere anche a
  `src/shared/icons.js` come icona riutilizzabile dei crediti), e un **grafico a
  torta del consumo per tipo d'uso** (NON per modello: correttore, riordino
  schede, chat, ecc.) leggendo l'aggregato da `credits_get`. NON mostrare mai il
  costo in €. Storico essenziale delle ultime voci. Segui `PATTERNS.md` per lo
  stile. **Done**: spec Playwright che apre la pagina, asserisce saldo + presenza
  del grafico con le fette attese; check visivo `test:shoot`. (stima: M)

- [x] **C3 — Ricompense feedback: +5 all'invio con animazione, variabile alla risoluzione**
  (2026-06-17) — FATTO la parte invio (la variabile alla risoluzione resta C5).
  All'invio riuscito di un feedback il box chiede `CREDITS_AWARD_FEEDBACK`
  (handler già pronto da C1, +5 = `CREDIT.FEEDBACK_SEND`) e fa partire
  `flyCredits()` in `src/content/feedback.js`: alcune "monete credito" (icona
  `credits` dorata) volano dalla posizione del box verso l'angolo in **alto a
  destra** con etichetta "+5", via Web Animations API (arco + stagger + fade,
  rispetta `prefers-reduced-motion`). Toast aggiornato ("+5 crediti"). La
  ricompensa compare anche nei "movimenti recenti" della pagina Crediti
  (`feedback_sent`, già mappato). **Decisione di design**: la spec diceva "icona
  profilo *nella shell*", ma l'icona account vive nella home (la barra chrome è
  nascosta) e soprattutto **la shell disegna solo la barra in alto — l'area
  pagina è coperta dalla WebContentsView nativa, quindi un'animazione disegnata
  dalla shell sarebbe occlusa**. Perciò l'animazione vive nel content overlay
  (dove sta il box) e punta all'angolo alto-destra, la direzione del profilo.
  **Verificato**: `tests/feedback-credit-reward.spec.mjs` 1/1 verde (submit
  stubbato senza rete; asserisce saldo **+5 esatto** dopo l'invio e la comparsa
  del layer `.sn-fb-credit-fly`). Changelog aggiornato. Animazione transitoria
  (~1s): non catturabile in modo affidabile con uno shot statico, la sua
  presenza è asserita dallo spec.

- [x] **C4 — Popup recap aggiornamento (feature in alto, bugfix in basso, non tecnico)**
  (2026-06-17) — FATTO. Il recap vive nella pagina home (`src/pages/dashboard`):
  all'avvio il main (`handlers/misc.js`, nuovi `GET_UPDATE_RECAP`/`MARK_UPDATE_SEEN`)
  confronta `LAST_SEEN_VERSION` salvata con `app.getVersion()` e ritorna le note
  delle versioni saltate da `src/shared/patchNotes.js` (ora caricato anche nel
  loader main). Il popup mostra header **`vecchia → nuova`**, **Novità** in alto e
  **Correzioni** in basso (aggregate da tutte le versioni saltate), un pulsante
  **Condividi** (copia il recap negli appunti, prova `navigator.share` se c'è) e
  **Fatto**/X che salva la versione corrente come vista. Primissimo avvio
  soppresso (nessuna sorpresa): il main marca la versione e non ritorna note.
  Aggiunto il blocco changelog 0.2.50 con la feature. **Verificato**:
  `tests/update-recap.spec.mjs` 3/3 verdi (popup con novità sopra/correzioni
  sotto + header versioni; chiusura → marca visto e non riappare; primo avvio
  soppresso ma versione marcata).
  — Al primo avvio dopo un update (confronto `lastSeenVersion` salvata vs
  `app.getVersion()`), mostra un popup con il recap aggregato di **tutte** le
  versioni saltate (calcolo "quante patch indietro" da `src/shared/patchNotes.js`).
  Layout: in alto l'intestazione **`vecchia → nuova`**, poi **Novità** (features) in
  alto e **Correzioni** (fixes) in basso; testo non tecnico, niente "perché era
  rotto". Pulsante **Condividi/Copia** il recap. Salva `lastSeenVersion` alla
  chiusura. **Done**: spec che, forzando una `lastSeenVersion` vecchia, asserisce
  che il popup elenca le entry attese nell'ordine giusto. (stima: M)

- [x] **C5 — Popup ringraziamento feedback risolto + ricompensa per priorità (50/100/200/300)**
  (2026-06-17) — FATTO. All'avvio la home chiede al main `GET_FEEDBACK_REWARDS`:
  legge il `clientId` di questo install (`sn_feedback_client_id`, lo stesso che il
  box allega all'invio), cerca su Firestore i feedback **suoi** (match anche sul
  prefisso `owner:` per gli invii da admin) in stato `done`, e per ognuno NON
  ancora premiato accredita la ricompensa per priorità
  (`CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY` 0→50/1→100/2→200/3→300, via il nuovo
  puro `SN_CREDITS.rewardForPriority`). L'anti-doppio-premio è `rewardedFeedback`
  nel doc credits (già in SYNC_FIELDS, quindi non ripaga su un altro dispositivo).
  La home mostra un popup di ringraziamento (riusa lo stile `.dash-recap-*` +
  `.dash-thanks-*`) con, per ciascun feedback, numero+titolo e **spiegazione non
  tecnica** estratta dai turni "modello" delle note (`SN_FEEDBACK_THREAD.splitNotes`),
  più il totale crediti; poi anima le monete verso l'icona profilo
  (`flyCreditsToAccount`, variante home di C3, punta all'elemento account reale).
  I due popup d'avvio (recap C4 + ringraziamento C5) sono **incatenati** per non
  sovrapporsi: il ringraziamento parte alla chiusura del recap, o subito se il
  recap non c'è. La pagina Crediti già etichetta `feedback_resolved` nei movimenti.
  Changelog 0.2.50 aggiornato. **Verificato**: `tests/feedback-resolved-reward.spec.mjs`
  3/3 (popup+saldo +200 per prio 2; aggregazione di 2 feedback = +350 escludendo
  todo e feedback altrui; anti-doppio-premio alla riapertura) + 2 nuovi unit in
  `creditStore.test.mjs` (rewardForPriority, clamp/stringa). Regressione mirata
  verde: update-recap 3/3, credits-page 2/2, feedback-credit-reward 1/1.
  **Nota tecnica**: il round-trip Firestore live (lista feedback reale) non è
  testato headless — lo stub di `SN_FEEDBACK.list` rende lo spec deterministico/
  offline; il filtro per clientId e la lettura note sono comunque esercitati.
  — All'update, se un feedback **inviato dall'utente** è passato a `done` da
  quando non guardava, mostra un popup per ciascuno (o aggregato) con:
  ringraziamento, conferma della risoluzione con **spiegazione non tecnica** presa
  dalle `notes` del feedback (come/dove usare la nuova feature), e **ricompensa
  crediti proporzionale alla priorità**: priorità 0→50, 1→100, 2→200, 3→300 (da
  confermare la mappatura esatta col campo `priority` 0-3). Anima i crediti verso
  il profilo (riusa C3). Richiede leggere da Firestore i feedback dell'utente
  (per email/clientId) e il loro stato/priority/notes; tracciare quali sono già
  stati premiati per non premiare due volte (campo nel doc credits). File:
  motore C1 + integrazione Firestore feedback (`src/shared/feedback.js`).
  **Done**: spec che simula un feedback `done` non ancora premiato e asserisce
  popup + incremento crediti corretto per priorità. (stima: L)

### Risanamento manutenibilità (valutazione 2026-06-10)

- [x] **Pulizie rapide** (2026-06-10) — Fatto: eliminato `src/shared/qrcode.js`
  (444 righe morte, il QR vivo è `qr.js`); eliminati 10 file scratch in tests/;
  PNG di `tests/.fb/` fuori da git (+gitignore); CLAUDE.md e README riallineati
  (~100 spec, architettura completa); hook auto-commit ora scrive i file
  cambiati nel messaggio invece del timestamp; rimossi 55 worktree/branch già
  atterrati su main. Verificato con boot+context-menu spec (8/8 verdi).

- [x] **Decidere i 5 branch superstiti non atterrati** (2026-06-11) — Esito:
  `condescending-dubinsky` (editor 05-22) SCARTATO: superato — il suo "switch
  globale" è evoluto in `isPinned` su main e `tests/editor.spec.mjs` esiste già
  in versione più recente. Trio `compassionate-kalam`/`hopeful-easley`/
  `vigilant-edison` SCARTATO: la patch unica (shell persistente per la modalità
  terminale) è già su main con hash diverso. `determined-leakey` RECUPERATO e
  adattato al refactor (il campionatore ora è in `pageColor.js`, non più in
  content.js): fix "tab bianca su YouTube" — theme-color/manifest neutri
  (croma < 24) non tingono più la tab, si ripiega sul favicon; nuovo modulo
  `src/shared/tabColor.js` + unit test, fallback identità per la tab attiva in
  shell.js, spec `tab-favicon-color`, sezione in PATTERNS.md, guida `test:unit`
  in CLAUDE.md, eliminati gli spec scratch dbg/dbg2/dbg3. NON recuperati i due
  ritocchi d'intensità della tinta (saturazione 18%→55%, mix 38%→60%): erano
  esperimenti di debug che contraddicono la spec §1.2 "tinta subliminale" —
  se la tinta delle tab inattive sembra troppo debole, è lì che si regola.
  Verificato: 16/16 unit + spec tab-favicon-color/tab-live-color/
  tab-identity-color/boot verdi. Eliminati anche i 3 branch più vecchi
  (`loving-lalande`, `nifty-johnson`, `suspicious-lovelace`): zero patch uniche.

- [x] **Spezzare `src/content/content.js` — parte 1: estrazioni pulite** (2026-06-10) —
  Fatto: 4 moduli nuovi, pattern IIFE su globalThis, caricati prima di
  content.js da entrambi i preload:
  `pageColor.js` (SN_PAGE_COLOR), `translatePage.js` (SN_TRANSLATE_PAGE, lo
  stato di traduzione ora vive lì), `tts.js` (SN_TTS: lettura ad alta voce +
  dettatura; riceve da content.js via `TTS.init({...})` getSettings /
  restorePasteContext / insertTextAtSelection / blobToDataUrl),
  `editBox.js` (SN_EDITBOX: riceve accesso al pasteContext via `init`).
  content.js: 3247 → 2433 righe. Le righe 2880-3045 della vecchia sezione TTS
  (buildInlineExplainImage/Link, analyzeLinkSuspicious, levenshteinSmall) NON
  sono TTS: lasciate in content.js per la parte 2 (vanno in actions.js).
  Verificato: 17/17 spec verdi (boot, context-menu, read-aloud,
  tts-preferences, tab-live-color, tab-identity-color, menu-icon-row,
  select-custom-orange). Nota ambiente: `npm run test:smoke` fallisce su
  questa macchina anche sul commit PRE-refactoring (Electron dist incompleto
  in node_modules: manca chrome_100_percent.pak) — non è una regressione;
  vedi memoria "npm install con Filo aperto".

- [x] **Spezzare `src/content/content.js` — parte 2: azioni e menu** (2026-06-10) —
  Fatto: 2 moduli nuovi, pattern IIFE su globalThis, caricati prima di
  content.js da entrambi i preload:
  `actions.js` (SN_ACTIONS, ~1370 righe: clipboard copia/taglia/incolla +
  cronologia, screenshot pieno/regione, trascrizione OCR, salva/condividi/
  cerca, color picker, QR code, spiegazioni inline testo/immagine/link,
  prefetch "Spiega", analyzeLinkSuspicious + levenshteinSmall; riceve via
  `Actions.init({...})` getPasteContext / restorePasteContext / isBlocked /
  getLastMouseEvent) e `menuIcons.js` (SN_MENU_ICONS, ~255 righe: registro
  icone globali, layout persistente + migrazioni, drag-and-drop; riceve
  isContentFullscreen; lastNavState ora memorizzato da buildGlobalIconRow).
  content.js: 2433 → 941 righe (bootstrap, routing contextmenu/runtime,
  menu spellcheck, matrice contestuale). TTS.init ora passa
  Actions.insertTextAtSelection/blobToDataUrl. In più: aggiunto comando
  `rclick-view:SEL` a tests/agent/shoot.mjs (+README) per il check visivo
  del menu. Verificato: 29/29 spec verdi (boot, context-menu, menu-icon-row,
  menu-app-icons, menu-disabled-icons-drag, menu-qr-code, menu-nav-actions,
  clipboard-paste-image, clipboard-history-search, spellcheck-input-menu-top,
  read-aloud x2, fullscreen-content, tab-activity-signals) + test:shoot del
  menu aperto (riga icone, Incolla con cronologia, Detta, feedback: ok).
  Il criterio "~600-900 righe" non è raggiunto del tutto (941): il residuo
  grosso è il menu spellcheck (~350 righe), estraibile in un'eventuale
  parte 3 se serve.

- [x] **Spezzare lo switch di `src/main/services/handlers.js`** (2026-06-11) —
  Fatto: lo switch (89 case) non esiste più. `handleMessage` è lookup su un
  registro `Map` + fallback; i case vivono in 9 moduli per dominio sotto
  `src/main/services/handlers/`: `nav.js` (18: OPEN_*/NAV_*/CLOSE_*/
  fullscreen/SHELL_ACTION/incognito/misspelling), `tabs.js` (12: _tabs:*,
  colori/attività/triage, archivio), `storage.js` (15: _storage:*, settings,
  export, clipboard, history, costi), `pages.js` (10: salvati+categorie),
  `ai.js` (6: AI_REQUEST, TTS, test provider/modelli, web search, save path),
  `filo.js` (12: chat/dashboard/memoria/note/timer/notifiche), `auth.js`
  (6: AUTH_*, FEEDBACK_UPDATE, DEFAULTS_*), `safebrowse.js` (4), `misc.js`
  (6: capture, feedback box, fetch_link_meta). Ogni modulo riceve via `ctx`
  gli helper condivisi rimasti in handlers.js (winOf, getEffectiveSettings,
  broadcast, …) e legge gli SN_* da globalThis. handlers.js: 1765 → 1025
  righe. Dedup in più: il case UPDATE_SETTINGS duplicava riga per riga
  `applySettingsUpdate` → ora la usa. CLAUDE.md e README aggiornati (punto
  "nuovo messaggio IPC"). Verificato in 5 batch: 91 test verdi totali (boot,
  context-menu, menu-nav-actions, fullscreen, tab-live-color/activity/archive,
  settings-instant-apply, export-data, clipboard x2, dashboard, filo-chat-set-
  preference, read-aloud, tts-preferences, agent-style, auth-shell,
  admin-defaults-gate, feedback-admin-gate/batch/dim/draw, safebrowse,
  cookies, incognito, slash-commands, tab-semantic-search,
  sidebar-shell-actions) + test:shoot del menu tasto destro (ok).

- [ ] **Consolidare la suite test (103 spec, ~25 min)** — Molti micro-spec
  avviano Electron per testare dettagli della stessa pagina (es.
  dashboard-command-color/-focus/-extra). Accorpare gli spec per pagina/area
  in file unici che condividono il `beforeAll`/fixture (1 avvio → N test).
  NON cambiare il fixture `tests/fixtures/electron.mjs`. Obiettivo: dimezzare
  gli avvii di Electron senza perdere copertura. Verifica: `npm test` in cloud
  (NON in locale). Questo task è ideale per una routine cloud. (stima: M)

- [ ] **Valutare se spezzare `src/pages/editor/editor.js` (2157 righe) e
  `src/main/tabs.js` (1299 righe)** — Solo dopo i task sopra: leggere la
  struttura, decidere se il taglio vale il rischio, proporre all'utente.
  (stima: M)
