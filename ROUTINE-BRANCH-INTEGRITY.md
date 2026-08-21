# Integrità del ramo nelle routine — spec di implementazione

Deciso con l'owner il 2026-08-07, dopo la ricostruzione del feedback #378
(`1PtwpQDlRSG2BuoG70lR`). Questo file è la spec: implementala, poi lascialo in
repo come documentazione della decisione.

## L'incidente che ha originato la spec

24 luglio 2026, feedback #378 (aggiungere la ricerca a senso nella dashboard di
gestione). Ricostruzione dai commit:

1. **17:28–17:45** — Un worker implementa la feature per intero sul branch
   `worker/1PtwpQDlRSG2BuoG70lR` (14 file, ~610 righe, test inclusi), scrive il
   report e accoda `revision_capability`. Il branch **non viene mai fuso**.
2. **17:48–17:49** — Il verifier boccia in **un minuto**: *"la funzione richiesta
   non è presente"*. Non aveva fatto `git checkout <branch>`: stava guardando
   `main`. La bocciatura è tecnicamente vera su ciò che vedeva e completamente
   falsa sul lavoro.
3. **17:50–18:03** — Un fixer prende la bocciatura per buona e **reimplementa
   tutto da zero**, committando **direttamente su `main`** (l'hook di
   auto-commit, in modalità single-worktree, pusha `HEAD:main` per ogni branch
   che non sia `worker/*` o `feature/*`). Questa seconda versione è quella oggi
   in produzione.
4. **20:07–20:11** — Il verifier passa (il codice ora è dove lui guarda).
5. **20:14** — Il gate di sicurezza **blocca il primo branch** perché tocca
   `src/main/services/handlers/auth.js` (lista dei file sensibili in
   `scripts/merge-gate.mjs`). Il feedback va in `design`, in attesa di una
   decisione dell'owner su un branch reso inutile 4 ore prima.
6. **29 luglio** — Un worker capisce la situazione, verifica che la feature è
   già viva e chiude come `done`.

**Costo**: un'implementazione doppia, un branch bloccato 5 giorni in attesa di una
decisione inutile, e — il punto più grave — **il codice andato in produzione non è
mai passato dal gate di sicurezza**, che nel frattempo esaminava il gemello
abbandonato.

**Causa radice**: il branch su cui un'istanza deve lavorare è solo una **frase**
nel file-ruolo. Niente lo impone, niente lo verifica. Un giudizio emesso
dall'albero sbagliato entra nella macchina a stati come fatto e si propaga.

## Principio

**Lavorare sul branch sbagliato mentre si PRODUCE è spreco. Mentre si GIUDICA è
danno**, perché il verdetto viene creduto e agito. Le difese vanno messe in
codice, non in prosa, e almeno una deve stare **fuori dalla sessione
dell'istanza** — perché una difesa che vive dentro la sessione può sparire senza
che nessuno se ne accorga.

---

## A — Il dispatcher decide il branch e ci si posiziona lui

`scripts/dispatch.mjs` non si limita più a **dire** all'istanza su quale branch
lavorare: ce la mette.

- Prima di emettere il JSON, per ogni bucket legato a un branch (`verifier`,
  `fixer`, `secaudit`) fa fetch e **checkout** del branch assegnato nella
  directory in cui l'istanza lavorerà.
- Per `new-work` **crea** il branch e ci si posiziona.
- **Fail closed**: se il checkout/creazione non riesce, non consegna il lavoro
  (vedi E per l'esito). Meglio un giro a vuoto che un giro sull'albero sbagliato.
- Registra nello stato del branch l'**identità attesa del contenuto** (il commit
  SHA risultante). È il valore che C e D confronteranno.

### Nomi di branch unici per tentativo

Oggi il branch è `worker/<id feedback>`: **stabile fra tentativi diversi sullo
stesso feedback**. Due tentativi si contendono lo stesso nome, ed è da lì che
nasce il caso "nome giusto, contenuto vecchio" (una copia locale stantia dello
stesso nome).

→ Il nome diventa **unico per tentativo** (es. `worker/<id>-<timestamp>`). Un
nome viene creato una volta sola e mai riusato: la classe di guasto sparisce
invece di essere gestita. Il nome vero vive già nello stato e nel campo `branch`
del feedback, quindi non serve poterlo ricalcolare.

### Niente worktree separati nelle routine

`routines/roles/new-work.md` istruisce oggi `git worktree add … -b worker/<id>`:
crea una **directory diversa** da quella dove il dispatcher si è posizionato, cioè
la divergenza per progetto. Serviva al lavoro locale parallelo dell'owner; in
cloud le routine lavorano **una alla volta**, quindi lì non serve. Togli
l'istruzione dai file-ruolo delle routine (il workflow worktree locale in
`CLAUDE.md` resta invariato).

---

## B — Guardia sulla divergenza (hook)

Un hook che **dopo ogni comando** confronta l'identità effettiva della directory
con quella attesa e ferma l'istanza alla prima divergenza, con un messaggio
esplicito.

**Controlla il risultato, non i comandi.** Enumerare i modi per cambiare branch è
una battaglia persa (git ha troppe strade equivalenti: `-C`, script, alias,
worktree, reset, rebase). Confrontando l'identità non importa *come* è cambiata.

Un piccolo elenco dei comandi ovvi può restare come avviso preventivo — è
comodità (errore chiaro *prima* della deriva), non garanzia.

Gli hook stanno in `.claude/hooks/` e la config in `.claude/settings.local.json`
(**è versionata**, quindi arriva alle routine cloud). Nota che oggi la lista dei
permessi consente esplicitamente `Bash(git checkout:*)` e `Bash(git worktree:*)`.

---

## C — Ogni scrittura nella macchina a stati verifica l'identità

Non solo i verdetti: **ogni transizione**. Consegna di lavoro nuovo, consegna di
una correzione, verdetto del verifier, verdetto del secaudit.

- Il punto di scrittura **ricalcola** l'identità del contenuto e **rifiuta** la
  transizione se non corrisponde al branch assegnato. Non chiede all'istanza dove
  si trova.
- Punti da coprire: `dispatch.mjs --record-verifier`, `--record-fixed`,
  `--record-secaudit`, e le consegne di stato al canale del server
  (`routine-channel.mjs`).
- Ogni transizione **accettata** lascia un **punto fermo**: l'identità del
  contenuto in quel momento, salvata nello stato del branch.

**Perché su tutte e non solo sui verdetti**: se una consegna può essere registrata
con l'albero sbagliato, il punto fermo che registra è fasullo — e D tornerebbe a
un punto fermo che contiene lavoro di un altro compito. C è il prerequisito di D,
non un extra.

**Anti-loop**: un rifiuto lascia il feedback dov'era e lo fa ripescare. Estendi ai
rifiuti lo stesso contatore che già esiste per i reset `working`→`todo`
(`workingResets`, escalation a `design` alla terza volta), così un ambiente che
produce disallineamenti a ripetizione non gira a vuoto all'infinito.

---

## D — L'interruzione torna all'ultimo punto fermo

Un'interruzione **non** azzera il lavoro della catena: scarta solo quello
dell'istanza interrotta.

Esempio richiesto dall'owner: A lavora → B verifica e trova un problema → C
inizia a correggere e viene interrotto → **D riparte dal branch come l'aveva
lasciato A, più la critica di B**, non da zero.

- Il ripristino riporta il branch all'**ultimo punto fermo registrato** (C).
- Il caso "lavoro nuovo interrotto subito" non è un'eccezione: è quello senza
  punti fermi, quindi si torna alla linea principale = da zero. **Una regola
  sola.**
- Ripulisci **storia e directory**: rimettere indietro solo i commit lascerebbe
  nella directory i file cambiati e mai salvati (l'auto-commit scatta sugli
  Edit/Write, non sui comandi: uno script, una build, un test lanciato come
  ultima azione lasciano residui). Al checkout successivo verrebbero
  **trasportati sul branch del compito dopo**, dove diventerebbero modifiche di
  *quel* lavoro e finirebbero nel diff che va al gate di sicurezza.
- **Non distruggere**: i commit scartati vanno spostati di lato e restare
  raggiungibili (ref/tag di servizio). Stessa regola per i branch orfani: non si
  cancellano, sono la traccia con cui si ricostruisce cosa è successo — questa
  spec esiste perché quel branch del 24 luglio era ancora lì.

---

## E — Esito dei guasti del dispatcher

Oggi il vocabolario della riga di ritorno al worker (`ROUTINES.md`) ha solo
`fatto <X>` (→ l'orchestratore **ripete**), `niente da fare` e `budget pieno`
(→ stop). **Non esiste una parola per "non posso lavorare in sicurezza"**, quindi
un guasto va schiacciato su una delle tre e sbagliano entrambe le plausibili:
`fatto` fa ripartire il giro subito (guasto deterministico → lavoratori a
~$2–3 l'uno finché il budget non finisce, la stessa forma dell'ondata già vista);
`niente da fare` traveste il guasto da giornata tranquilla.

**Serve una terza parola** che significhi "fermati, e non è normale".

### Passeggero vs permanente

- **Passeggero** (rete, quota, deposito irraggiungibile): la sessione **si
  chiude senza altri tentativi**. Ci riprova l'orchestratore successivo fra 6h.
  Nessuna logica di retry da scrivere = nessuna logica di retry da sbagliare.
- **Permanente** (il branch nello stato non esiste più): riprovare ogni 6h
  all'infinito è inutile. Il feedback **esce dal giro automatico** e va in
  `design` (lo stato che significa "serve una decisione dell'owner"), così compare
  in dashboard invece di consumare un avvio ogni sei ore in silenzio.

Cause note di "branch inesistente": la push del branch è fallita al momento
della consegna (è best-effort e non riprova, vedi `.claude/hooks/auto-commit-merge.sh`),
qualcuno l'ha cancellato, o l'omonimia (risolta da A).

### Coda vuota ≠ coda illeggibile

`scripts/next-feedback.mjs` oggi, se gli status non si decifrano, emette un
**avviso** su stderr e prosegue: la coda **sembra vuota**. Nessun errore, nessun
allarme — è già costato un'ondata di lavoro fantasma. Deve diventare un **guasto
dichiarato** (passeggero: la chiave può tornare), non un risultato.

*(Aggiornamento 2026-08-19: `next-feedback.mjs` è stato ritirato — la coda si
legge SOLO sul server, `filo-security/functions/src/routine/queue.js`, dove vive
anche questa distinzione. In locale resta il principio: senza biglietto dispatch
dichiara un guasto, non "niente da fare".)*

### Il controllo di prontezza gira per primo

L'orchestratore (`ROUTINES.md` § Avvio) spende parecchio in preparazione
dell'ambiente (`npm install`, binario Electron ~102MB, `scrot`) **prima** di
chiedere se c'è lavoro. Se deve fermarsi, deve scoprirlo prima di aver pagato il
setup: sposta la verifica di prontezza in cima.

---

## Verifica

Tutto testabile **senza Electron**, con unit test (`npm run test:unit`,
`tests/unit/`), su un repo di prova con un finto `origin`:

- A: con un branch assegnato, la directory finisce su quel branch; se il checkout
  fallisce **non viene emesso nessun lavoro**; due tentativi sullo stesso feedback
  producono **nomi diversi**.
- B: dopo un cambio di branch fuori protocollo la guardia ferma l'istanza,
  qualunque sia il comando che l'ha causato.
- C: una transizione con identità non corrispondente viene **rifiutata**; una
  corretta viene accettata e **lascia il punto fermo**.
- D: dato un branch con punto fermo di A e commit sparsi di C, il ripristino
  riporta esattamente al punto fermo, la directory resta pulita, e i commit di C
  **restano raggiungibili**.
- E: coda illeggibile → guasto, non "niente da fare"; branch inesistente → il
  feedback finisce in `design`.

**I test devono fallire prima del fix** (vedi `CLAUDE.md` § "Test che servono
davvero"): se non sai quale assert diventa rosso togliendo la modifica, riscrivi
gli assert.

## Vincoli

- **Non fondere su `main`.** Il branch `feature/routine-branch-integrity` è gated
  dall'hook apposta: le routine cloud sono **attive** e girano su questa
  macchina; una modifica parziale al dispatcher romperebbe il ciclo in volo. Il
  merge lo decide l'owner, a lavoro completo.
- Niente voce nei patch notes: è infrastruttura interna, invisibile all'utente
  (vedi `CLAUDE.md` § Patch notes).
- Il report finale lo scrivi tu, minimo, secondo `CLAUDE.md` § "Tono dei report".

---

# Parte 2 — le vie d'accesso al ramo principale (2026-08-07)

La Parte 1 impedisce a un'istanza di *lavorare* sul ramo sbagliato. Questa
impedisce al lavoro non esaminato di *uscire*. Sono due binari diversi: le
protezioni della Parte 1 vivono sul percorso "consegna e verdetto", mentre la
pubblicazione automatica scattava a ogni modifica di file, indipendentemente da
tutto il resto.

## Via 1 — la sessione si dichiara, non si indovina dal nome del ramo

**Prima**: l'hook di salvataggio decideva chi trattenere e chi pubblicare
guardando il **nome del ramo** (un elenco di prefissi vietati: `worker/*`,
`feature/*`; tutto il resto veniva pubblicato). Il nome è un indizio, non un
fatto — ed è così che il 24 luglio un'istanza di routine mai passata su un ramo
di lavoro ha pubblicato il proprio codice direttamente.

**Ora**: `FILO_ROUTINE=1`, esportata dall'orchestratore ed ereditata dai worker.
Una sessione marcata non pubblica **mai**, qualunque sia il nome del ramo.

**E anche**: nessun ramo di lavoro raggiunge più il ramo principale da solo,
neanche in locale (vedi §Sessioni locali). L'elenco dei prefissi resta come rete.

**Tracciabilità**: i commit portano un autore diverso a seconda della
provenienza. Prima erano indistinguibili, e alla domanda "questo codice da dove
è arrivato?" non c'era risposta nemmeno a posteriori — il che ha reso impossibile
misurare quante volte la Via 2 fosse scattata davvero.

## Via 2 — la spedizione della decisione portava con sé tutto il ramo

All'epoca le routine depositavano la decisione in un file su git e la spedivano
al ramo principale. Il comando usato diceva «prendi il punto in cui mi trovo e
mettilo sul ramo principale» — ma "il punto in cui mi trovo" non è il file: è
**tutta la storia accumulata sul ramo**. Se il ramo principale non si era mosso,
quella spedizione era un avanzamento regolare e veniva accettata in blocco,
codice compreso. Nella storia non si distingueva da una fusione legittima.

Non scattava sempre: serviva che nessun altro avesse pubblicato nel frattempo.
Ma un cancello che si può saltare a seconda del tempismo non è un cancello —
non puoi guardare il risultato e dire "questo è stato esaminato".

**Il rimedio dell'epoca** (`isolated-push`): il commit veniva **costruito sopra
lo stato remoto attuale**, in un indice temporaneo che conteneva solo quel file,
e si spediva l'oggetto commit — nessuna storia locale attaccata, garanzia per
costruzione. **Oggi questa via non esiste più in nessuna forma**: le decisioni
viaggiano sul canale autenticato verso il server (spec `ROUTINE-AUTH-SPEC.md`)
e su git salgono solo i rami di lavoro, che passano dal cancello.

## Via 3 — rete di sicurezza (non una via)

Un'istanza di routine che si ritrova sul ramo principale viene avvisata e il suo
lavoro non esce. Non è un terzo modo indipendente per arrivare al ramo
principale: è il paracadute per i casi che le prime due non prevedono.

## Cancello prima della pubblicazione agli utenti

**Prima**: ogni 6 ore un automatismo prendeva il ramo principale **così com'è**,
costruiva e distribuiva agli utenti, **senza eseguire un solo test**. Qualunque
errore — di una routine o di una sessione locale — arrivava a tutti senza
incontrare nessun controllo lungo la strada.

**Ora**: i controlli automatici girano **prima del bump di versione** (se sono
rossi non si consuma nemmeno un numero di versione). Rosso ⇒ nessuna
pubblicazione **e** un feedback in coda con la coda dell'esecuzione: al giro
successivo una routine lo prende in carico come qualsiasi altro lavoro. Senza
quel feedback, un fallimento si limiterebbe a bloccare le pubblicazioni in
silenzio.

## Sessioni locali: salvataggio continuo, pubblicazione una volta

Le sessioni locali pubblicavano a ogni modifica. Tre conseguenze: la fotografia
delle 6 ore poteva cogliere un lavoro **a metà** e mandarlo agli utenti; ogni
pubblicazione spostava il ramo principale sotto i piedi delle routine in corso,
facendo sì che il cancello di sicurezza **giudicasse una versione diversa da
quella poi fusa**; e il ramo principale conteneva stati mai pensati come finiti.

L'hook faceva **due cose** che vanno separate: salvare e spedire il proprio ramo
(prezioso — è ciò che ha salvato questo stesso lavoro dopo due interruzioni), e
fondere sul ramo principale (il problema). Solo la seconda è cambiata.

`npm run finish` esegue i controlli e **solo se sono verdi** chiede la fusione.
`npm run finish:check` esegue i soli controlli.

**Dal 2026-08-20 non fonde più lui**: spedisce il ramo e chiede al server, che
è l'unico a poter scrivere sul ramo principale (`ROUTINE-AUTH-SPEC.md` §11).
Restava infatti la porta accanto — una credenziale capace di pubblicare, viva
sulla macchina dove gira un'istanza — e finché c'era, tutto il resto di questa
spec era aggirabile senza convincere nessuno.

**Dove sta il muro, per esattezza**: su GitHub. La credenziale locale non è
stata tolta e non si può togliere (serve a spedire i rami); a respingere il push
è la **regola di protezione del repo**, che lascia scrivere sul ramo principale
la sola identità del server. Verificato sul campo il 2026-08-21: un push diretto
su `main` da questa macchina viene rifiutato (`push declined due to repository
rule violations`). Le guardie locali — negli script e negli hook — restano, e
non come ridondanza inutile: un automatismo che tenta e viene respinto **in
silenzio** è un guasto invisibile, ed è già costato un ramo che non si salvava
più da giorni senza che nessuno lo sapesse.

La regola "non lanciare mai la suite completa in locale" è stata **rimossa** da
`CLAUDE.md`: nasceva da quando il grosso del lavoro si faceva in locale. Oggi in
locale si fanno poche cose critiche, quindi il tempo in più è accettabile — al
peggio un controllo in più fa risparmiare tempo, al meglio trova ciò che
sarebbe sfuggito.
