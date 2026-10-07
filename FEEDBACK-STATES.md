# FEEDBACK-STATES — Macchina a stati dei feedback

**Origine:** sessione di progettazione owner + Claude, 2026-07-02. Le decisioni della spec
sono già prese dall'owner. Questo file è il riferimento della macchina a stati: il racconto
e il perché. Le tabelle stanno nel codice e vincono su questo testo: stati e transizioni in
`src/shared/feedbackTransitions.js`, presentazione in `src/shared/feedbackStatus.js`, azioni
dell'owner in `src/shared/manageReview.js` (`ownerActions`). Il piano a fasi in fondo è
tutto spuntato: è la storia dell'implementazione, non lavoro da riprendere.

---

## 1. Problema

Lo *stato* di un feedback oggi è spalmato su più campi ricalcolati a display-time:
`status` (povero), `pipeline.*` (verdetti giudici), `reviewDecision`, `blockReason`, più
la modalità automatica letta al volo. Conseguenza dimostrata: la dashboard
(`manageReview.js → manageTabFor/isApproved`) mostrava 20 feedback "In coda" (autoMode ON
+ aligned), ma `next-feedback.mjs` (oggi ritirato) selezionava solo `status === 'todo'` →
coda vuota per le routine. Due criteri diversi per "questo è lavorabile?" = bug strutturale.

**Obiettivo:** un unico campo `status` persistito su Firestore è la SOLA fonte di verità.
Ogni evento SCRIVE lo status; dashboard, routine e agente leggono SOLO lo status. Nessun
consumer ricalcola lo stato dai campi grezzi.

## 2. Gli stati (lista chiusa)

| status | colore | tab | significato |
|---|---|---|---|
| `unlabeled` | bianco | Ricevuti | ricevuto, panel giudici non completo |
| `suspicious_file` | **nero** | Ricevuti | gate deterministico file ha flaggato PRIMA dei giudici |
| `attack` | rosso | Ricevuti | un livello di sicurezza ha flaggato come attacco |
| `spam` | giallo | Ricevuti | flaggato come spam |
| `design` | verde | Ricevuti | serve decisione owner (3 origini distinte via chat: verdetto design; domande routine ex-`clarify`; fix fallito 3× ex-`blocked/loop`) |
| `aligned` | blu | Ricevuti | sicuro e sensato ma automatica OFF: aspetta approvazione manuale |
| `todo` | — | In coda | approvato (a mano o auto): aspetta di essere lavorato |
| `working` | — | In coda | un'istanza lo sta lavorando ORA (lock, §6) |
| `revision_capability` | — | In coda | fix su branch, aspetta verifica comportamentale (verifier avversariale) |
| `revision_security` | — | In coda | verifica passata, aspetta audit L4 (secaudit) + merge-gate |
| `done` | — | In coda*/Risolti | fuso su main e deployato; aspetta verifica umana owner |
| `archived` | — | Archiviati | verificato dall'owner; log |
| `attack_confirmed` | rosso | Archiviati (filtro "Bloccati confermati") | attacco confermato: terminale |
| `spam_confirmed` | giallo | Archiviati (filtro "Bloccati confermati") | spam confermato: terminale |

\* `done` resta "In coda" finché `resolvedInVersion ≤ releasedVersion` non è vero (gate
DB3 esistente), poi "Risolti".

**Campi ortogonali (NON stati):** `starred` (bool), `priority` (0–3), `statusReason`
(string breve opzionale per il sottotesto in dashboard, MAI per la logica: `clarify`,
`loop`, `decisione`, `secaudit`, `l5`, `arenato`, `locale` (§5, §4b), `attesa_origine`,
`origine_bloccata`, `origine_chiusa`, `origine_mancante` (§4c), `legacy-ignored` (§8);
il giudizio dei giudici non ne scrive: `judges` lo ricava solo la normalizzazione dello
storico, e la frase «Panel incompleto…» la dashboard dai verdetti, `judgesNote`), `workingSince`
(ISO, solo con `working`), `branch` (da `revision_*` in poi), `beatAt` (ISO:
l'ultimo battito arrivato al server per quel lavoro, che lo specchia qui perché
la dashboard i semafori non li vede — è l'unica cosa che le permette di dire il
vero su "qualcuno ci sta lavorando ORA"), `livelli` (dal 2026-09-13: mappa con al
più `l3` e `l4`, ognuna `{ esito, at, ruolo?, by?, testo }`; la scrive SOLO il
server; `l3` è la segnalazione di chi ha risolto o verificato (`esito:
segnalato`, `ruolo`), un trade-off vero che decide l'owner, arrivata con
`--segnala`; `l4` è l'esito del controllo di sicurezza, `pass|fail|saltato`,
scritto sempre, anche su pass, col testo di cosa è stato controllato; `saltato`
lo mette l'owner (`by: owner`) quando, letto il fail, decide di andare avanti,
e conserva il testo del fail; `testo` è cifrato come `notes`; in dashboard sono
il rombo e il pentagono della fila delle forme).

**Stati legacy da RITIRARE:** `new`, `review`, `blocked`, `clarify`, `verified`,
`ignored` (mappatura in §8).

## 3. Transizioni legali (chi scrive cosa)

La tabella è codice: `TRANSITIONS` in `src/shared/feedbackTransitions.js`, da → a con gli
attori (`owner`, `pipeline`, `routine`). Una coppia che non c'è è illegale e il writer la
rifiuta. Il server la incorpora al deploy: una riga cambiata vale per lui dal rideploy delle
functions. Qui sotto il perché dei passaggi, per attore.

**Pipeline** (filo-security):
- ingresso → gate file (prima dei giudici): flag → `suspicious_file`; pulito → `unlabeled`.
- `unlabeled` —panel completo→ `attack` | `spam` | `design` | (sicuro: automatica ON **e
  mittente ammesso** → `todo`, altrimenti → `aligned`).
- `attack`/`spam` → `unlabeled`: un mittente fidato segnalato per errore torna al ri-giudizio
  (sotto, «Mittenti fidati»). `design` → `unlabeled` | `todo` | `aligned` e `aligned` →
  `unlabeled` | `todo`: solo i derivati che seguono la loro origine (§4c).

**Owner**: le sue righe sono le azioni di §4a, una per azione e nessuna in più (sentinella
`tests/unit/ownerActionsTransizioni.test.mjs`). La tabella ammette all'owner gli stessi
passaggi che Gestione e la pagina dei feedback offrono con un clic; `npm run feedback`
(`scripts/owner-feedback.mjs`) la applica un passo alla volta, senza catene (una catena
«archivia, poi ripristina» rimetterebbe in coda un lavoro in corso, che nessuna pagina
offre; le catene valgono solo con `--come-routine`), e per regola non parte dai Ricevuti né
dalle conferme (§4b). Resta fuori un caso: una richiesta di fusione in attesa porta nei Ricevuti
anche un lavoro dell'iter (`manageTabFor` con `opts.fusioni`), e lì «→ In coda» da
`working` o `revision_*` non ha una riga owner.
- dai Ricevuti (`unlabeled`, `suspicious_file`, `attack`, `spam`, `design`, `aligned`) →
  `todo` (approvazione; su `attack`/`spam` è il falso positivo, su `design` la risposta in
  chat) | `archived` (doppione, o non si fa); da `attack` e `suspicious_file` →
  `attack_confirmed`, da `spam` e `suspicious_file` → `spam_confirmed`. Il verdetto
  (`attack`, `spam`, `design`, `aligned`) su un `unlabeled` resta dei giudici.
- dall'iter (`todo`, `working`, `revision_capability`, `revision_security`) → `archived`, e
  basta. «✓ Risolto» non è una riga owner → `done`: è la catena dell'iter delle routine, e da
  riga di comando si scrive con `--come-routine` (aggiornamento 2026-08-19, sotto).
- `done` → `archived` (verifica umana ok) | `todo` (riapertura: «manca qualcosa»).
- `archived` → `todo` (ripristino); `attack_confirmed`/`spam_confirmed` → `todo` («era
  legittimo»).

**Routine** (canale autenticato: il server valida ogni mossa con la tabella incorporata):
- `todo` —claim (§6)→ `working`.
- `working` —routine→ `revision_capability`; —arenato (ramo fermo da un'ora)→ `todo`;
  —arenato per la 3ª volta consecutiva→ `design` (`statusReason: arenato`, nota
  in chat: istanza che muore sempre, es. crediti esauriti — vedi §6a).
- `revision_capability` —routine, critica del verificatore senza rilievi INTERNI da
  correggere→ `revision_security` (dal 2026-09-23 ogni rilievo porta livello e sede,
  `[2i]`/`[2e]`: contano gli interni; dal 2026-09-27 anche `[1v]`, il vicino, un
  difetto di un altro lavoro in un file che il ramo modifica già, che conta come
  livello 0. Ciò che il lavoro non corregge diventa SUBITO un feedback derivato,
  figlio `#N.k`, con `priorityManual` perché il giudice non la riabbassi, aperto dal
  server in ogni esito: un feedback per ogni esterno e per ogni rilievo col `?`, a
  priorità uguale al livello; UNO solo per tutti gli altri (interni messi da parte
  dal bilancio, vicini non corretti), a priorità = il livello scritto più alto
  fra loro); —critica con rilievi
  interni da correggere→ resta
  `revision_capability`: chi corregge consegna `fixed`
  (`revision_capability → revision_capability`), poi un altro verificatore riprova
  (feedback #561, dal 2026-09-05); —rilievo di livello 3 non correggibile (bilancio
  dei 3 esaurito)→ `design` (`statusReason: loop`); un 2 a bilancio dei 2 esaurito NON
  ferma: entra nel feedback derivato dei rimasti e il lavoro passa se non c'è altro
  (dal 2026-09-23, bilanci separati per livello); —rilievo di livello 3/2 che chiede una
  decisione→ `design` (`statusReason: decisione`); —QUALUNQUE consegna con una
  segnalazione per l'owner (`--segnala`: di chi risolve, di chi corregge, e la critica
  di chi verifica in ogni esito)→ `design` (`statusReason: decisione`), senza bisogno
  di `--ferma`: un feedback che aspetta una scelta dell'owner non gira altri giri. Le
  consegne che non possono fermare (nota, controllo di sicurezza, apertura di un
  feedback) la RESPINGONO, mai ignorata in silenzio. Il segnalibro di ripresa porta,
  con quello che ha fermato, anche gli altri rilievi interni della stessa critica
  (`sospesi`): chi riprende li chiude, il giro dopo non li riscopre.
- `revision_security` —routine PASS secaudit+merge→ `done`; —FAIL fixer-loop→ `design`
  (`statusReason: loop`); —conflitto di fusione→ `revision_capability`
  (riallineamento: main è avanzato e il merge non passa più da solo — non è una
  bocciatura di qualità, il contatore M non si muove; il ramo viene ribasato e
  ripassa verifica e sicurezza sul contenuto nuovo).
- `design` —fusione bloccata da L5, approvata dall'owner e finita in conflitto→
  `revision_capability` in DUE passi: la riapertura `design → todo` a nome
  dell'owner (il click di approvazione è la sua decisione) e il rientro
  `todo → revision_capability` della routine (#523: senza il primo passo il
  rientro veniva rifiutato e la pratica restava ferma nei Ricevuti).
- da todo/working/revision_* la routine con domande → `design` (+ domande nella chat,
  `statusReason: clarify`).

**Regole dure:** da `unlabeled` il verdetto lo scrive solo la pipeline; l'owner lo mette in
coda o lo archivia. Da `suspicious_file`, `done`, `archived` e `*_confirmed` esce solo
l'owner; da `attack`, `spam`, `design`, `aligned` l'owner, e la pipeline nei soli casi dei
mittenti fidati e dei derivati. L'iter `todo→working→revision_*→done` e `revision_*→design`
lo muovono solo le routine; l'owner dall'iter può solo archiviare. Nessuna riga owner →
`done`. Transizioni non elencate = illegali: il writer le rifiuta.

**La prova del mittente** (#595, #912): un nome riservato vale solo con `senderProof`, che
scrivono l'admin (owner, sessioni, esploratore) e il server (routine). Senza, è un utente
ovunque, e alla nascita il server lo rifiuta: sul documento resta `non-provato:<nome>`.
Il ripasso non dà più la prova al solo nome; sui feedback nati prima, col nome ancora
intero, l'owner può dire che è suo con «🙋 È mio» in Gestione (da riga di comando no, #957).

**Mittenti fidati** (`owner:`/`routine:`/`agent:`/`local:` con la prova): mai `attack`/`spam`; se un
livello identità li flagga è un errore → `unlabeled` per ri-giudizio. Caso limite: se il
PANEL COMPLETO segnala un fidato (L2 dice attack/spam a verdetti pieni), lo status resta
`unlabeled` ma non c'è niente da ri-giudicare — la dashboard lo mostra con la categoria
segnalata (rosso/arancio, frase "decidi tu") invece del bianco "non filtrato", e il
bottone «Ri-valuta» lo salta (scelta owner 2026-08-29: la segnalazione resta visibile,
utile come dato sui falsi positivi; sbloccarlo è un gesto suo). `local:` è la
**sessione locale**: Claude che lavora sulla macchina dell'owner, in chat con lui (lo
strumento che apre un feedback da lì è `npm run feedback:apri`). In dashboard è una
categoria d'autore PROPRIA — né agente esploratore né automazione cloud: il contesto in
cui nasce un ritrovamento è diverso da entrambi, ed è l'unica cosa che il mittente serve
a dire.

**Aggiornamento 2026-08-19 (smontaggio sotto-feedback, SPEC-RIDISEGNO-MAX.md §1).**
L'estensione `todo→done` / `working→done` (attore routine), introdotta in F3 per il
pianificatore che spezzava le spec in sub-feedback, è RITIRATA dalla macchina a stati: il
pianificatore non esiste più. Le chiusure manuali senza
branch (`npm run feedback -- <id> done "…" --come-routine`) restano legali come
CATENA di passi (`canReach` attraversa l'iter todo→working→revision_*→done). I
sub-feedback storici (#N.x) restano visibili e lavorabili; è sparita solo la
possibilità di crearne di nuovi.

## 4. Tab dashboard (deriva SOLO da `status`)

Le tab sono CINQUE e valgono per OGNI superficie che elenca feedback — la
dashboard di gestione (`filo://manage`) e la pagina dei feedback
(`filo://feedback`), che fino al #509 aveva una tassonomia sua (la vecchia
new/draft/todo/review/blocked/clarify/done/verified) e faceva cadere in
"Ricevuti" tutto ciò che non riconosceva: stessa coda, "Ricevuti (3)" di là e
"Ricevuti (9)" di qua. Una superficie nuova non inventa sezioni: chiama
`manageTabFor` / `listForManageTab` / `manageTabCounts`.

`tabFor(status)` = lookup pura, senza `pipeline`, senza `isApproved`, senza `autoMode`:
- Ricevuti: `unlabeled | suspicious_file | attack | spam | design | aligned`
- In coda: `todo | working | revision_capability | revision_security | done(non rilasciato)`
- Lavori locali (#908): quello che starebbe «In coda» ma porta il segno `localOnly`.
- Risolti: `done(rilasciato)` — Archiviati: `archived` (+ filtro ⭐; + filtro "Bloccati
  confermati" per `*_confirmed`, decisione presa: restano ispezionabili come log lì).

### 4b. I lavori delle sessioni locali (#908)

`localOnly: { by, at }` (in chiaro, `at` in millisecondi, scrive solo l'admin) dice
che la pratica la lavora solo una sessione locale: la coda delle routine, il recupero
degli arenati e il pacemaker la saltano, e le superfici la mostrano nei Lavori locali
invece che «In coda». Negli stati dei Ricevuti resta nei Ricevuti (aspetta comunque
l'owner), con l'approvazione che dice `→ Lavori locali`.

- Il segno si mette solo su feedback dell'owner o di una sessione (`owner:`/`local:`)
  **con la prova** `senderProof: 'admin'` (la dà il ripasso dai segni che un falso non ha, o
  l'owner con «🙋 È mio» in Gestione; da riga di comando no, #957: salterebbe L5 come il sì
  qui sotto), a pratica aperta, non segnalata come
  attacco/spam e non in mano a una routine (`localSignCheck`). Su un utente o una routine
  solo col sì dell'owner: un feedback che richiederebbe lavoro locale torna nei Ricevuti
  (`design`, motivo `locale`, nota «Richiede lavoro locale») con `owner-feedback.mjs
  --serve-locale`, e lì l'owner lo approva come lavoro locale (#913, sotto).
- **L'approvazione dell'owner (#913)**: `localApproval: { by, at }` (stessa forma di
  `localOnly`, scrive solo l'admin, `localApprovalValido` nelle regole). La scrive
  «💻 Lavoro locale» nei Ricevuti (dettaglio, tasto destro sulla scheda, pagina dei
  feedback), insieme a `todo`, `reviewDecision: accepted` e `localOnly`: il feedback va
  nei Lavori locali. Solo da lì (#957): nessuno strumento delle sessioni lo scrive, perché
  hanno le credenziali dell'owner e un testo d'utente potrebbe convincerle a darselo. Le regole non distinguono la
  pagina da uno script con lo stesso token: il limite sta negli strumenti (sentinella in
  `tests/unit/lavoroLocaleApprovato.test.mjs`). Vale quanto la prova del
  mittente (`isProvenLocalWork` nell'app, `localMergeEligibility` sul server), quindi la
  sessione lo lega a `start`/`finish --feedback` e alla fusione L5 registra senza
  fermare. Non cambia chi l'ha scritto: il lettore lo dice ancora utente, e il testo resta
  un dato. Si offre solo nei Ricevuti, su chi non è owner o sessione con la prova; su un
  segnalato l'hover lo dice e serve guardarlo prima.
  Togliere il segno locale lascia l'approvazione, così il segno si rimette con un clic
  (il sì si dà solo dai Ricevuti, dove la pratica non torna). Risolto, il feedback di un
  utente approvato tiene la scheda pubblica (`isPrivateLocalWork`): è da lì che chi l'ha
  mandato vede la risoluzione; senza scheda resta solo il lavoro dell'owner e delle sessioni.
- Si mette e si toglie in Gestione (tasto «Locale» nel dettaglio, tasto destro sulla
  scheda), con `owner-feedback.mjs --solo-locale | --non-locale`, e nasce già messo sui
  feedback aperti da `claude-feedback.mjs --locale` (`--non-locale` per le routine: la
  scelta è obbligatoria, perché una segnalazione per le routine nata locale non la prende nessuno).
- Le sessioni locali hanno le credenziali dell'owner. Per REGOLA (non per un blocco
  tecnico) non spostano feedback dai Ricevuti né dalle conferme `*_confirmed`, non
  lavorano feedback di utenti senza il sì dell'owner e non stampano testo di attacchi: `owner-feedback.mjs`
  rifiuta prima di scrivere.
- Alla nascita un lavoro locale provato salta i giudici (`pipeline.skipped:
  'local_proven'`, status `todo`). Alla fusione `npm run finish` manda `feedbackId`
  (da `--feedback <N>` o da `verify-local.mjs start --feedback <N>`): se il documento
  è un lavoro locale provato il server esegue L5 solo per registrare i blocchi
  (`skippedL5: true`), fonde senza chiedere e chiude la pratica. Manca una condizione →
  la richiesta aspetta il sì dell'owner in Gestione, col motivo.

### 4c. Chi nasce senza giudici (#914)

Alla nascita (solo il trigger di creazione) L1 e L2 non girano per chi porta la prova
scritta dal server o dall'admin, mai per il solo nome (`functions/src/nascita.js`):

- lavoro locale (§4b): `todo` nei Lavori locali, senza nemmeno L0;
- sessione per le routine (`local:` + `senderProof: 'admin'`, senza segno: `claude-feedback.mjs
  --non-locale`): L0, poi `todo` In coda (`pipeline.skipped: 'session_proven'`); la priorità
  scelta con `--priorita` nasce col documento (`priorityManual`), senza scelta la decide il giudice;
- routine (`routine:`/`agent:` + `senderProof: 'server'`: ritrovamenti, derivati, allarmi della
  costruzione): L0, poi dove dice l'**origine** (`pipeline.skipped: 'routine_proven'`, decisione
  dell'owner del 04/10). L'origine è il lavoro del biglietto (`origineId`, lo scrive il server,
  mai la routine; `parentId` resta un collegamento) e conta il genitore diretto:
  - origine dell'owner, di una sessione o del server (mittente provato, anche un derivato già in
    coda) → `todo`;
  - origine d'utente non ancora fusa → resta `unlabeled` (`statusReason: attesa_origine`); quando
    l'origine arriva a `done` → `todo`; se si blocca (`attack`, `spam`, `suspicious_file`, i
    confermati, `design` per `secaudit` o `l5`) → `design` (`statusReason: origine_bloccata`,
    rosso, L1 pericoloso sul triangolo, mittente non segnato); se si chiude senza fusione
    (`archived`) → `aligned` (`statusReason: origine_chiusa`). Lo fa il trigger
    `onFeedbackOrigineCambiata` (functions/src/origine.js), e alla nascita si rilegge l'origine
    dopo la scrittura perché un passo appena avvenuto non vada perso;
  - origine sparita → `aligned` (`statusReason: origine_mancante`);
  - senza origine (allarmi della costruzione, esplorazioni) → come un allineato dei giudici: `todo`
    se l'automatica e l'interruttore del gruppo lo ammettono, altrimenti `aligned`.

  Chi è fermo con l'origine (`design`, `origine_bloccata`) la segue anche quando l'owner la libera:
  torna ad aspettarla (`design → unlabeled`) se il lavoro riparte, entra in coda (`design → todo`) se
  si fonde, va in `aligned` se si chiude senza fusione. Allo stesso modo chi è tornato nei Ricevuti
  con l'origine chiusa (`aligned`, `origine_chiusa`) la aspetta di nuovo (`aligned → unlabeled`)
  se l'owner la ripristina, ed entra in coda (`aligned → todo`) quando si fonde. Sono le sole uscite
  della pipeline da `design` e da `aligned`, e solo per quei motivi; un derivato che l'owner ha già
  spostato non si tocca. Chi entra in
  coda dopo l'attesa passa dal giudice di priorità come alla nascita.

Il prompt dei giudici dice che a loro arriva solo un utente: un linguaggio da sviluppatore o
da agente è un segnale sospetto. Non a un mittente provato (l'owner dall'app, la ri-valutazione
di una routine o di una sessione): lì il tono tecnico è normale. Una ri-valutazione passa
sempre dai giudici.

Le routine non aprono lavoro locale: il canale non scrive il segno, e dentro una routine
`claude-feedback.mjs` e `owner-feedback.mjs --solo-locale` si rifiutano. Un
lavoro che si fa solo in locale torna nei Ricevuti dal canale (`deliver status --status design
--reason locale`, nota «Richiede lavoro locale»): lo stesso motivo di `--serve-locale`, e lì
l'owner lo approva come lavoro locale (§4b, #913).

### 4a. Le AZIONI dell'owner per sezione (`ownerActions`)

Stessa regola delle tab, un gradino più in dentro: la sezione dice quali azioni
esistono, e la tabella sta in `src/shared/manageReview.js` (`ownerActions`), non
nelle pagine. Fino al #509 le due superfici se la costruivano ognuna a mano e
divergevano sulla STESSA segnalazione.

L'elenco per sezione sta lì (e nei suoi test in `tests/unit/manageReview.test.mjs`); ogni
azione è una riga owner della tabella di §3, tranne «✓ Risolto», che è la catena
dell'iter delle routine (`tests/unit/ownerActionsTransizioni.test.mjs`). Le regole che
la tabella incarna:

- Negli Archiviati c'è solo `↩ Ripristina`. **Nessun cammino riscrive uno stato
  terminale**: su `attack_confirmed`/`spam_confirmed` un `Archivia` cancellerebbe la
  conferma, e la segnalazione sparirebbe dal filtro "Bloccati confermati".
- Stato illeggibile (nessuna chiave privata): nessuna azione, su nessuna superficie.

Il writer di ogni pagina passa da `ownerActionAllowsStatus(fb, to)`: si scrive solo
uno stato che la segnalazione offre in quel momento, così un pannello rimasto aperto
mentre lo stato cambiava non deposita una decisione che la pagina non offre più.

La modalità automatica agisce UNA volta, al giudizio (sicuro + ON → `todo`; sicuro + OFF
→ `aligned`). Attivarla dopo NON ri-tocca i vecchi `aligned`: l'owner li approva in blocco
dai Ricevuti con «Approva tutti gli allineati» (`aligned→todo`).

**Per mittente (#446).** "ON" non è più un sì/no per tutti: l'interruttore master
(`config/automation.enabled`) abilita l'auto-approvazione, e la mappa
`config/automation.autoApprove` dice QUALI categorie di mittente ne beneficiano
(una per categoria d'autore, dal prefisso e dal ruolo nel `clientId`). Master spento ⇒
nessuno, qualunque cosa dica la mappa. Mappa assente ⇒ tutti, come prima che esistesse.
La logica è pura e vive in due copie da tenere allineate: `src/shared/feedbackThread.js`
(dashboard) e `filo-security/functions/src/autoApprove.js` (chi decide davvero).

C'È UN GRUPPO PER OGNI CATEGORIA D'AUTORE, quelle che la coda mostra con un'icona:
`owner`, `user`, `local` (la sessione locale), `worker`, `verifier`, `residuo`, `prober`,
`claude` (automazioni che non dichiarano il ruolo) e `filo`. Fino al 2026-08-22 le cinque
istanze di Claude stavano dietro un interruttore solo: la coda le distingueva ma la
fiducia era una sola, quindi per fermare l'esploratore si fermava anche la sessione
locale. Adesso i due assi coincidono — chi si vede separato si regola separato.

**Compatibilità:** un documento salvato prima, che ha il solo `claude`, fa ereditare quel
valore a tutte le sue istanze (`resolveAutoApprove`, in entrambe le copie). Senza,
sdoppiare l'interruttore riaprirebbe da solo cinque porte che l'owner aveva chiuso.

## 5. La dashboard distingue i sotto-casi di `design`

Un solo stato `design`, più origini, distinte da `statusReason`: (1) verdetto
giudici (nessun reason o `judges`); (2) domande della routine (appende le domande
alla chat + `statusReason: clarify`); (3) la verifica ha trovato un difetto di livello
3 che non si può più correggere da soli — bilancio delle correzioni dei 3 esaurito
(`statusReason: loop`, con la critica coi livelli in chat) — oppure un 3/2 che chiede una
decisione dell'owner (`statusReason: decisione`), oppure chi risolve o chi corregge ha
consegnato con una segnalazione per l'owner (stesso `statusReason: decisione`); in
tutti questi casi bilanci e verdetti del giro si azzerano — la storia delle critiche
resta — e il server lascia un **segnalibro di ripresa** nello stato del giro (chi si
è fermato, perché, i rilievi rimasti aperti). Nei casi `clarify` e `decisione` la
dashboard offre la casella di risposta (su `loop` si rimette in coda e basta): la
risposta dell'owner va nella conversazione, il feedback torna `todo`, e la coda —
vedendo ramo e segnalibro — manda
un **correttore sul ramo** (ruolo `fixer`, testo `resolver-ripresa.md`) con domanda,
risposta e rilievi fermi nel payload (`ripresa`), non un risolutore da capo; dopo la
sua consegna riprova un verificatore. Se la domanda era arrivata prima di avere un
ramo, riprende un risolutore con la stessa `ripresa` nel payload. Un `→ In coda`
senza testo vale «va bene quello che è stato fatto nel frattempo»; un commento
scritto approvando conta come risposta solo se è arrivato dopo lo stop; (4) fix bocciato
dal **controllo di sicurezza** (`statusReason: secaudit`, con `livelli.l4.esito:
fail`); (4b, dal 2026-09-13) fix fermato dal **cancello di fusione** L5 sul
server (`statusReason: l5`): il controllo di sicurezza è passato, a fermare è
stato il cancello, e c'è una richiesta di fusione in attesa; (5) lavorazione
arenata ripetutamente (`statusReason: arenato`). La risposta dell'owner appende
alla chat e (se decide) muove a `todo`. Sul caso `secaudit` l'owner ha anche
«Salta il controllo»: il server scrive `livelli.l4 = { esito: saltato, by:
owner }`, tratta il verdetto come un pass e lancia subito il cancello L5 sul
ramo; l'esito è quello di un'approvazione (fuso → `done`; bloccato → richiesta
di fusione in attesa; conflitto → riallineamento). Non serve una transizione
nuova: è `design` → `todo` con attore owner, e da lì il cancello.

Presentazione (scelta owner 2026-08-29): i casi `secaudit` e `l5` sono **ROSSI** in
dashboard (un blocco di sicurezza, non una questione di gusto); gli altri restano verdi. Nel
dettaglio, accanto ai pallini dei giudici, una frase spiega il PERCHÉ dello stato
(`judgesNote` in `manageReview.js`): i pallini raccontano il voto dei giudici, che
può essere tutto allineato anche su un feedback tornato indietro dopo.

## 6. Lock di lavorazione (`working`)

- Presa in carico: `todo → working` + `workingSince: <now ISO>`.
- **TTL 60 minuti**: `working` con `workingSince` più vecchio = istanza morta → chiunque
  (dispatch al giro dopo, o l'Action in riconciliazione) lo riporta a `todo`.
- ⚠️ **Superato dal 2026-08-17** (spec `ROUTINE-AUTH-SPEC.md`): il lock non è più
  un file su git. Lo prende il **server** rilasciando il biglietto, dura quanto
  il semaforo e si tiene vivo col battito. `working` resta il riflesso persistito
  che la dashboard mostra. Tutto ciò che qui sotto parla di file di claim, di
  coda e dell'automatismo che la applicava descrive un meccanismo **smontato**:
  resta come storia di come ci si è arrivati, non come istruzione.
- Se un'istanza trova `working` fresco: NON aspetta, passa al prossimo `todo`; se non
  c'è altro, termina con "niente da fare".

### 6a. Il recupero degli arenati (dal 2026-08-22)

Col ridisegno il reset `working`→`todo` era rimasto **scritto nella tabella ma
senza nessuno che lo eseguisse**: lo faceva l'Action qui sotto, smontata, e il
server non l'ha mai ripreso. Siccome `working` non è né fra i `todo` né fra gli
stati di revisione da cui il server sceglie il lavoro, un feedback fermo lì non
lo raccoglieva più nessuno — due sono rimasti fermi per giorni mentre la
dashboard scriveva "in attesa di ripresa". Adesso:

- lo fa il **pacemaker**, ogni 20 minuti, sui soli feedback in `working`
  (`functions/src/routine/stall.js`), e gira anche mentre un altro giro sta
  lavorando a qualcos'altro: dipende solo dall'interruttore;
- **chi ha il semaforo VIVO non si sfratta, mai.** Un semaforo vivo vuol dire
  che qualcuno sta battendo, cioè che la sessione è viva e collegata:
  toglierglielo di sotto le fa rifiutare la consegna e le butta via il giro, che
  è esattamente il guasto da cui nasce questo lavoro, rifatto un'ora dopo invece
  che mezz'ora. Una sessione viva ma davvero impantanata resta comunque limitata
  dal **tetto duro del semaforo (8 ore)**, scaduto il quale ricade nel caso qui
  sotto. Meglio aspettare quel tetto che ammazzare un lavoratore onesto;
- **senza semaforo vivo**, "da quando è fermo" è il più recente fra due limiti:
  l'ingresso in lavorazione (`workingSince`, o `createdAt` per i documenti che
  non ce l'hanno) e **la data dell'ultimo commit sul ramo**, che il server chiede
  a GitHub e la sessione non dichiara. Soglia: **un'ora**. Un commit recente
  salva chi stava ancora combinando qualcosa anche senza semaforo; l'ingresso in
  lavorazione impedisce che un ramo nato da un commit vecchio condanni un lavoro
  appena cominciato. Una data di commit nel futuro si BUTTA (orologio che mente)
  invece di tagliarla ad adesso, o regalerebbe un'ora di vita a ogni giro;
- ⚠️ la data è assoluta di proposito. Le prime due versioni la ricostruivano
  ricordandosi fra un giro e l'altro dove stava il ramo, e **tutte e due le
  volte quel ricordo non veniva mai scritto**: la misura sembrava esserci e non
  entrava mai in funzione. Una domanda a cui GitHub risponde da sé non si tiene
  a memoria;
- GitHub irraggiungibile, o semafori illeggibili → **non si recupera niente**:
  "non lo so" non è "è morto", e recuperare alla cieca butta via giri interi;
- il recupero libera il semaforo, riporta a `todo` e incrementa `workingResets`
  (che `applyStatus` azzera da sé alla prima consegna vera).
  Alla **3ª volta** il feedback esce dal giro automatico → `design`
  (`statusReason: arenato`) con nota per l'owner, o un guasto che si ripete ogni
  ora si mangia il tetto giornaliero di accensioni entro sera.

### 6b. Storia: la riconciliazione dell'Action (smontata)

- L'Action apply-triage **riconciliava**: rilasciava claim orfani e resettava i `working`
  scaduti. Estensioni 2026-07-14 (recupero istanze morte, es. crediti esauriti):
  - il claim **sopravvive** all'applicazione dell'entry `working` (è la presa in
    carico: l'istanza sta ancora lavorando) e viene rilasciato solo alle consegne;
  - ogni reset `working`→`todo` incrementa il contatore `workingResets`; alla **3ª
    interruzione consecutiva** il feedback va in `design` (`statusReason: loop`) con
    nota in chat, invece di fare ping-pong todo↔working all'infinito. Una consegna
    reale (revision_*/done/design) azzera il contatore;
  - la riconciliazione gira anche **a orologio** (cron ogni 30 min del workflow),
    non solo ai push: un'istanza morta non pusha niente, senza cron nessun trigger
    resetterebbe mai il suo `working`.

## 7. Dove si implementa

### 7a. filo-security (repo `C:/Users/agenti AI/Desktop/Filo/filo-security`)
1. La pipeline dei giudici scrive lo status nativamente: al completamento del panel UNO
   di `attack|spam|design|todo|aligned` (per todo/aligned legge la modalità automatica in
   quel momento). Panel incompleto/degradato → resta `unlabeled`, senza `statusReason`:
   la frase «Panel incompleto…» la ricava la dashboard dai verdetti (`judgesNote`). I
   `pipeline.*` grezzi restano per audit, pallini e frase, ma nessun consumer li legge per lo
   stato.
2. Mittenti fidati: mai attack/spam (come oggi in classifyBlock); flag identità su fidato
   → `unlabeled` per ri-giudizio.
2b. **`updatedAt` su OGNI scrittura di un feedback** (#676), timestamp e mai testo,
   anche `createdAt` (i sotto-feedback creati dal server lo avevano testo). La Gestione
   legge tutto all'apertura e poi chiede «chi è stato scritto dopo questo istante?»:
   app, script e server lo firmano. Finché il server non lo firma ovunque, il giro
   guarda tre segni senza orologio (ora di Firestore dei feedback in mano alle
   routine, contatore degli invii, registro dei worker col numero del feedback
   preso). Le regole ammettono il campo nei tre rami (create, update admin, update
   routine) e pretendono una data. Racconto:
   patterns/chi-guarda-in-continuo-chiede-cosa-e-cambiato.md.
3. Gate deterministico file sospetti (vive QUI, decisione owner): gira PRIMA dei giudici
   su ogni feedback con allegati; flag → `suspicious_file` e NON va al panel finché
   l'owner non decide. Contesto noto: il widget accetta via drag&drop tipi non ammessi
   (es. `.html` con script); da stringere anche `storage.rules` (content-type).
   ⚠️ *La spec originale si troncava qui: i dettagli sotto (7b, 8) sono ricostruiti in
   questa sessione dai principi §1–§6 e dal codice esistente; decisioni marcate.*

### 7b. Repo Filo (consumer)
- **`src/shared/feedbackTransitions.js`** (IIFE `SN_FB_TRANSITIONS`): le tabelle come
  DATI (`STATUSES`, `TRANSITIONS`, `PUBLIC_MAP`). Fonte unica: la dashboard le legge, il
  server le incorpora al deploy (`filo-security/functions/tools/bake-shared.js`), quindi
  una riga cambiata vale per il server solo dopo il rideploy delle functions.
- **`src/shared/feedbackStatus.js`** (IIFE `SN_FB_STATUS`): presentazione (colori,
  etichette, `tabFor(status)`) e API sopra i dati (`canTransition`, `canReach`,
  `transitionsFrom`), legacy semplice (§8). `normalizeStatus(fb)` sta in manageReview.js.
- **`src/shared/manageReview.js`**: `manageTabFor` → lookup pura su status normalizzato;
  `classifyBlock`/`isAligned`/`isApproved` restano solo per (a) colore/label da status,
  (b) normalizzazione dello storico. Nessuna lettura di `pipeline` per decidere la tab.
- **`src/shared/feedback.js`**: `statusToPublic` legge `PUBLIC_MAP` di
  feedbackTransitions.js per i canonici; la sua `STATUS_PUBLIC_MAP` resta solo per i
  legacy. Nota sicurezza: i "beccati" collassano su valori dei feedback normali, mai uno
  distinto, e i confermati su `open`, non su `closed` (#476): `closed` fa scattare premio e
  annuncio «risolto» a chi ha mandato l'attacco.
- **`src/pages/manage/*`**: colori per status, azione bulk `aligned→todo`, filtro
  "Bloccati confermati" in Archiviati, sottotesto da `statusReason`.
- **Le mosse delle routine**: le valida il server, con le tabelle di
  feedbackTransitions.js incorporate al deploy (`stateMachine.js`); la scelta del lavoro
  vive in `filo-security/functions/src/routine/select.js`. La coda su git
  (`queue-triage.mjs`, `apply-triage.mjs`) e `next-feedback.mjs` non esistono più (§6b).
- **`scripts/dispatch.mjs` + ruoli**: il fixer muove `todo→working→revision_*`;
  loop 3× → `design`+`statusReason: loop`. *(Dal 2026-09-05, feedback #561: la
  critica si registra coi livelli e l'esito lo calcola il server; le regole
  stanno in `src/shared/verifierRound.js`, incorporato dal server; i quattro
  bilanci `cap3/cap2/cap1/cap0`, uno per livello, li scrive SOLO l'owner in `config/routines`
  (Gestione → Automazioni) — dal 2026-09-16 nel codice non c'è un default: la
  verifica locale li legge dal server e senza si ferma.)*
- **`firestore.rules`**: enum `status` esteso ai nuovi valori (in create anonimo resta
  bloccato: solo `new`→ ora `unlabeled`), `hasOnly` esteso con `statusReason`,
  `workingSince`. Deploy manuale (`npm run regole:pubblica`).

### 8. Migrazione legacy → nuovi stati (confermata dall'owner ed eseguita il 2026-07-03, F5)
Script one-shot, più la normalizzazione in lettura per lo storico:
- `new` → derivare dal pipeline con la STESSA logica di oggi (classifyBlock/isAligned):
  nessun pipeline o parziale → `unlabeled`; attacco → `attack`; spam → `spam`; design →
  `design`; aligned+`candidate_change` → `todo`; aligned senza → `aligned`.
  `reviewDecision==='accepted'` → `todo` (vince su tutto, come oggi).
- `clarify` → `design` + `statusReason: clarify`.
- `blocked` + `blockReason: 'loop'` → `design` + `statusReason: loop`; altri `blocked` →
  derivare dal pipeline come per `new`.
- `review` → `revision_capability` (era "fix pronto in attesa di review").
- `verified` → `archived` (era "verificato dall'owner").
- `ignored` → `archived` + `statusReason: legacy-ignored`.
- `done`, `todo`, `archived` → invariati.

---

## PIANO A FASI (storia)

Tutte le fasi sono fatte; i dettagli sono quelli del giorno in cui si sono chiuse, e dove
oggi il codice dice altro vale il codice (le sezioni sopra).

- [x] **F1 — Vocabolario condiviso** (fatto 2026-07-02): `src/shared/feedbackStatus.js`
      (SN_FB_STATUS: stati, colori, tabFor, transizioni+canTransition, LEGACY_SIMPLE,
      isWorkingExpired, PUBLIC_MAP) + `tests/unit/feedbackStatus.test.mjs` (13 test
      verdi). Caricato in `loader.js` e `manage.html` prima di manageReview.
      NB: `normalizeStatus(fb)` (scioglimento di new/blocked dal pipeline) va in
      manageReview.js (F2), perché riusa classifyBlock/isAligned.
- [x] **F2a — Logica dashboard su status** (fatto 2026-07-03): `manageReview.js`
      riscritto — `normalizeStatus(fb)` (canonico→invariato; legacy semplice→mappa;
      new/blocked→scioglimento dai grezzi con classifyLegacyBlock/isAlignedLegacy,
      interni non esportati); `manageTabFor` = lookup pura; `classifyBlock` deriva da
      status (loop=design verde, nero riservato a suspicious_file); `isAligned` = solo
      chi ASPETTA approvazione; `isApproved` = status nell'iter (autoMode IGNORATO —
      era il bug strutturale); board: guard red-team resta sui grezzi APPOSTA.
      `feedback.js`: statusToPublic con lookup pigra su SN_FB_STATUS.PUBLIC_MAP.
      Unit test aggiornati al nuovo contratto: 808/808 verdi.
      ⚠️ Conseguenze semantiche da dire all'owner: (1) legacy `verified`/`ignored` →
      Archiviati (verified esce dalla board utenti); (2) status `todo` = SEMPRE in
      coda (prima un todo "non approvato" stava nei Ricevuti); (3) pipeline "in
      corso" ora bianco `unlabeled` (prima nessun colore).
- [x] **F2b — UI dashboard** (fatto 2026-07-03): `manage.html`+`manage.js` — barra
      "Approva tutti gli allineati (N) → In coda" nei Ricevuti (bulk aligned→todo);
      filtro "Bloccati confermati" negli Archiviati; bottone "Conferma attacco/spam"
      nel dettaglio (attack/spam/suspicious_file → *_confirmed, con
      reviewDecision: rejected); tooltip card con statusReason; il box risposta
      chiarimenti ora scatta su design+statusReason clarify (oltre al legacy).
      Spec manage-page.spec.mjs aggiornato (fixture allineato → status new;
      test automatica riscritto: il toggle NON sposta più le liste).
- [x] **F3 — Routine/scripts** (fatto 2026-07-03): queue-triage e apply-triage con
      ALLOWED canonici + remap legacy in ingresso (clarify→design/clarify,
      review→revision_capability, blocked→design/loop); apply-triage valida le
      transizioni con canReach (catene, perché la coda tiene UN file per feedback
      e i passi collassano) e SCARTA le illegali (log + file rimosso); scrive
      statusReason (+ blockReason specchiato per lo storico) e workingSince
      (set su working, azzerato altrimenti); nota vuota NON cancella più le note;
      riconciliazione: working scaduti (TTL 60min) → todo. dispatch: seleziona
      revision_*/review con branch, accoda working al claim di new-work, i
      --record-* riflettono lo status (pass→revision_security, fix→revision_
      capability), loop 3× → design/loop. Ruoli + ROUTINES.md aggiornati.
      Estensione documentata: todo/working→done (routine) per lavori senza branch
      (es. pianificatore), ritirata il 2026-08-19 (§3). Attore owner delegato:
      routine:auto-archive.
- [x] **F4 — firestore.rules** (editate 2026-07-03): enum esteso ai canonici (legacy
      mantenuti per lo storico), statusReason/workingSince in hasOnly (admin e ramo
      routine, con size check); ramo routine: iter completo todo/working/revision_*/
      done/design (+clarify transizione). DEPLOYATE il 2026-07-03 (deploy ok su
      progetto filo-8b9cb).
- [x] **F5 — Migrazione** (ESEGUITA 2026-07-03, owner ha confermato le scelte):
      `scripts/migrate-status.mjs --apply` con token admin in tests/agent/.env
      (gitignorato). 101 migrati / 226 già canonici / 0 errori: 40→aligned,
      2→attack, 1→spam, 3→design(judges), 4 clarify→design(clarify),
      21→unlabeled, 30 ignored→archived. Rilanciata a vuoto: 0 da migrare
      (idempotente). Nota: lo script decifra TUTTO il doc (soprattutto
      `pipeline`) con decrypt-feedback-fields, altrimenti classifica tutto
      unlabeled.
- [x] **F6 — filo-security** (fatto 2026-07-03, commit bd93b47, DEPLOYATO):
      `src/statusMap.js` (decisione→status canonico; fidati mai attack/spam →
      unlabeled; canWriteStatus = la pipeline non regredisce feedback oltre il
      giudizio — vale anche per le ri-valutazioni); `src/l0/fileGate.js` (gate
      deterministico allowlist su `files[]`, PRIMA dei giudici → suspicious_file,
      niente panel); `feedbackState.recordDecision` scrive `status` CIFRATO (come
      il pipeline: anti hill-climbing, la dashboard lo decifra già — status è nei
      TEXT_FIELDS) + `statusPublic` in chiaro; runner: gate L0, owner-accepted →
      todo, trusted, reeval aggiorna lo status. Test 279 verdi. `storage.rules`
      (repo Filo): via i wildcard `text/.*`/`image/.*` (passava text/html!),
      allowlist esplicita — DEPLOYATE.
- [x] **F7 — Rifiniture** (fatto 2026-07-03): patch notes v0.2.104 (bulk approva,
      filtro confermati, coda coerente); CLAUDE.md aggiornato (workflow → macchina
      a stati, punta a questo file); ruoli/ROUTINES.md già in F3. Capabilities:
      nessuna capacità utente cambiata (il gate file è moderazione, non un confine
      promesso) → non toccato.

**Punti confermati dall'owner il 2026-07-03 (F5):**
1. Mappatura `ignored` → `archived` (con statusReason), non `spam_confirmed`.
2. Mappatura `review` → `revision_capability`.
3. `*_confirmed` in Archiviati sotto filtro.
