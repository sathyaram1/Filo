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
| `design` | verde | Ricevuti, o In coda con `domandaId` (§5) | serve decisione owner (3 origini distinte via chat: verdetto design; domande routine ex-`clarify`; fix fallito 3× ex-`blocked/loop`) |
| `aligned` | blu | Ricevuti, o In coda con `domandaId` (§5) | sicuro e sensato ma automatica OFF: aspetta approvazione manuale |
| `todo` | — | In coda | approvato (a mano o auto): aspetta di essere lavorato |
| `working` | — | In coda | un'istanza lo sta lavorando ORA (lock, §6) |
| `revision_capability` | — | In coda | fix su branch, aspetta verifica comportamentale (verifier avversariale) |
| `revision_security` | — | In coda | verifica passata, aspetta audit L4 (secaudit), poi gli unit sulla fusione da GitHub e il cancello del server |
| `done` | — | In coda*/Risolti | fuso su main e deployato; aspetta verifica umana owner |
| `archived` | — | Archiviati | verificato dall'owner; log |
| `attack_confirmed` | rosso | Archiviati (filtro "Bloccati confermati") | attacco confermato: terminale |
| `spam_confirmed` | giallo | Archiviati (filtro "Bloccati confermati") | spam confermato: terminale |

\* `done` resta "In coda" finché `resolvedInVersion ≤ releasedVersion` non è vero (gate
DB3 esistente), poi "Risolti".

**Campi ortogonali (NON stati):** `starred` (bool), `priority` (0–3), `statusReason`
(string breve opzionale per il sottotesto in dashboard, MAI per la logica: `clarify`,
`loop`, `decisione`, `secaudit`, `l5`, `arenato`, `attesa_chiusa`, `guasto`, `locale`,
`fidato` (§5, §4b), `worker` (attacco o spam giudicato da chi lavorava, §3),
`attesa_origine`, `origine_bloccata`, `origine_chiusa`, `origine_mancante` (§4c),
`legacy-ignored` (§8);
il giudizio dei giudici non ne scrive: `judges` lo ricava solo la normalizzazione dello
storico, e la frase «Panel incompleto…» la dashboard dai verdetti, `judgesNote`), `workingSince`
(ISO, solo con `working`), `branch` (da `revision_*` in poi), `beatAt` (ISO:
l'ultimo battito arrivato al server per quel lavoro, che lo specchia qui perché
la dashboard i semafori non li vede — è l'unica cosa che le permette di dire il
vero su "qualcuno ci sta lavorando ORA"), `livelli` (dal 2026-09-13: mappa con al
più `l3` e `l4`, ognuna `{ esito, at, ruolo?, by?, testo }`; la scrive SOLO il
server; `l3` è la segnalazione di chi ha risolto o verificato (`esito:
segnalato`, `ruolo`), un trade-off vero che decide l'owner, arrivata con
`--segnala` fino al #1790 (da lì la scelta per l'owner è solo una domanda); `l4` è l'esito del controllo di sicurezza, `pass|fail|saltato`,
scritto sempre, anche su pass, col testo di cosa è stato controllato; `saltato`
lo mette l'owner (`by: owner`) quando, letto il fail, decide di andare avanti,
e conserva il testo del fail; `testo` è cifrato come `notes`; in dashboard sono
il rombo e il pentagono della fila delle forme; un attacco o spam segnato dal worker
scrive `l3` con `esito: attacco|spam`), `domandaId` (dal #1358: `D-<n>`, la domanda
dell'owner che sblocca un'attesa, SPEC-DOMANDE §3.8; la scrive SOLO il server, nella
stessa transazione dello stato, e nessuna regola la lascia scrivere a un client).

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
  la sua fiducia ammessa** → `todo`, altrimenti → `aligned`; un ritrovamento del server senza
  origine → `todo` comunque, §4c).
- `attack`/`spam` → `unlabeled`: un feedback fidato segnalato per errore torna al ri-giudizio
  (sotto, «Feedback fidati»). `design` → `unlabeled` | `todo` | `aligned` e `aligned` →
  `unlabeled` | `todo`: solo i derivati che seguono la loro origine (§4c).
- **Un feedback che aspetta una scelta dell'owner non gira** (regola dell'owner del 22/09,
  #775). Il derivato nato da un rilievo col `?` porta il segno `chiedeDecisione` (in chiaro,
  lo scrive solo il server alla nascita) e la domanda come turno di Filo nella conversazione.
  Ogni esito che lo metterebbe in coda o ad aspettare l'origine (sicuro dei giudici, salto dei
  fidati, origine fusa, chiusa, sparita o non ancora fusa), e anche il verdetto `design` dei
  giudici, diventa `design` (`statusReason: decisione`) con la sua domanda (`domandaId`): In coda col segno «aspetta D-n», e si risponde nella sezione Domande (§5). Attacco, spam, origine bloccata e
  giudizio incompleto vincono come per gli altri; con l'origine si blocca e si sblocca, ma la
  sua fusione non lo mette in coda. Dopo la risposta va in coda come un feedback normale (non
  ha un ramo da riprendere) e chi lo prende trova domanda e risposta (`decisioni`). Un
  `design` che aspetta la risposta (`decisione`, `clarify`) la pipeline non lo sovrascrive:
  una ri-valutazione non lo rimette in coda.

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
- `todo` —claim (§6)→ `working`; —riordino o unione→ `archived` (#1153: solo un biglietto con
  l'ambito `coda` o `unisci`, su un lavoro non ancora iniziato; l'unione scrive sul genitore il
  rimando `unitoIn` al figlio).
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
  priorità uguale al livello (quello col `?` aspetta la risposta alla sua domanda: sopra,
  Pipeline); UNO solo per tutti gli altri (interni messi da parte
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
  domanda che blocca (`--domanda`: di chi risolve, di chi corregge, e la domanda di un
  rilievo interno di livello 3 o 2 col `?` di chi verifica, in ogni esito)→ `design`
  (`statusReason: decisione`), senza bisogno di `--ferma`: un feedback che aspetta una scelta dell'owner non gira altri giri. Le
  consegne che non possono fermare (nota, controllo di sicurezza, apertura di un
  feedback) la RESPINGONO, mai ignorata in silenzio. Il segnalibro di ripresa porta,
  con quello che ha fermato, anche gli altri rilievi interni della stessa critica
  (`sospesi`): chi riprende li chiude, il giro dopo non li riscopre.
- `revision_security` —routine PASS secaudit+merge→ `done`; —FAIL fixer-loop→ `design`
  (`statusReason: loop`); —conflitto di fusione, o unit rossi sul risultato
  della fusione→ `revision_capability` (riallineamento: main è avanzato e il
  merge non passa più da solo — non è una bocciatura di qualità, il contatore M
  non si muove; il ramo viene ribasato e ripassa verifica e sicurezza sul
  contenuto nuovo). Chi ribasa non corregge gli unit rossi: li elenca, e chi
  verifica ne fa rilievi interni (#1204).
- `design` —fusione bloccata da L5, approvata dall'owner e finita in conflitto→
  `revision_capability` in DUE passi: la riapertura `design → todo` a nome
  dell'owner (il click di approvazione è la sua decisione) e il rientro
  `todo → revision_capability` della routine (#523: senza il primo passo il
  rientro veniva rifiutato e la pratica restava ferma nei Ricevuti).
- da todo/working/revision_* la routine con domande → `design` (+ domande nella chat,
  `statusReason: clarify`).
- da todo/working/revision_* il worker che giudica il feedback un attacco o uno spam →
  `attack` | `spam` (`statusReason: worker`, il perché cifrato in `livelli.l3` con `esito:
  attacco|spam` e `ruolo`): Ricevuti, L3 (#1358, SPEC-DOMANDE §2.2). Lo consegnano chi
  risolve, chi corregge e chi verifica, mai il controllo di sicurezza; da lì decide l'owner
  come per i giudici (conferma, falso positivo → `todo`, archivia).
- ogni fermata per l'owner (`clarify`, `decisione`, `loop`, `arenato`, `attesa_chiusa`, e
  `locale` con la domanda di chi si ferma) apre una domanda nella stessa transazione dello
  stato, e il feedback prende `domandaId` (§5, #1358). `design` + `locale` senza domanda
  non torna più al PC: un feedback fidato prende il segno dei lavori server (`localOnly`)
  e torna `todo` col segnalibro sul ramo; uno non fidato resta `design` col motivo
  `fidato`, nei Ricevuti L3 come richiesta di renderlo fidato, e «Segna fidato» lo
  rimette `todo` come lavoro server nello stesso gesto.

**Regole dure:** da `unlabeled` il verdetto lo scrive solo la pipeline; l'owner lo mette in
coda o lo archivia. Da `suspicious_file`, `done`, `archived` e `*_confirmed` esce solo
l'owner; da `attack`, `spam`, `design`, `aligned` l'owner, e la pipeline nei soli casi dei
mittenti fidati e dei derivati. L'iter `todo→working→revision_*→done` e `revision_*→design`
lo muovono solo le routine, che dall'iter possono anche segnare `attack`/`spam`; l'owner
dall'iter può solo archiviare. Nessuna riga owner → `done`. Transizioni non elencate =
illegali: il writer le rifiuta.

**La fiducia** (#1148, SPEC-DOMANDE.md §1): `fiducia` (`fidato`|`non_fidato`, in chiaro) la
scrive solo il server, le regole la vietano a ogni client. Alla nascita: fidato l'owner
dall'app (`owner:` con la prova dell'admin), una sessione col biglietto pulito
(`bigliettoLocale`), un biglietto pulito delle routine, il server (allarmi); tutto il resto
non fidato. Dopo, solo «🤝 Segna fidato» in Gestione (callable `ownerFiducia`; da riga di
comando no); lo stesso tasto, premuto, la toglie: biglietti e derivati nuovi nascono non fidati, e L5 torna a valere. La
toglie da sé anche una nota nuova scritta dagli strumenti delle sessioni (`npm run feedback`, le note dei giri) senza un
biglietto pulito (#1428): prima la fiducia, poi la nota; se la prima non va, la nota non parte. Da chiusa la
fiducia non si toglie: chi riapre con la nota riapre prima, e una nota che lascia la pratica chiusa non parte. Decide i giudici alla nascita (solo i non fidati), lo spareggio della coda
(fidati prima) e L5 (§4b, e ROUTINE-AUTH-SPEC.md).

**La prova del mittente** (#595, #912, #1037): un nome riservato vale solo con `senderProof`, che
scrivono alla nascita l'admin (owner, sessioni, esploratore) e il server (routine). Dopo, nessun
client la aggiunge né la cambia, nemmeno l'admin: le regole non la ammettono in un update. Senza, è un utente
ovunque, e alla nascita il server lo rifiuta: sul documento resta `non-provato:<nome>`.
Dalla copia dell'owner (#953) firmano tutte le strade: riquadro, chat, riapertura dalla bacheca
(`owner:uid:<uid>`). La segnalazione che Filo scrive in chat e l'owner conferma è sua (`owner:filo:chat`, fidata) solo
se il compito non ha letto testo di altri (lo stato dei livelli di autonomia, mai oltre la classe 2); altrimenti, e
sempre dall'Aiuto di un sito, resta `filo:chat` con la sua prova: «Filo per conto dell'owner», non fidata, giudicata.
La segnalazione automatica resta `auto:` (non l'ha letta né confermata) con la sua prova, come quella. Chi decide il mittente: `src/main/services/feedbackMittente.js`.
Dal §10 (#1162) il mittente è solo statistica: il server stampa `mittenteClasse` (`owner`,
`utente`, `filo_per_utente`, `sessione_locale`, `routine` con `mittenteRuolo`, `server`, `test`) alla
nascita e con `npm run mittenti:migra` sui documenti di prima; la mappatura delle etichette sta in
un posto solo, `src/shared/mittenti.js` (il server la incorpora). Il mittente decide solo la chiave
di raffiche e segno: un processo dell'owner con la prova non è una persona e conta nel solo tetto
globale. Ogni permesso segue `fiducia`; l'unico mittente che diventa fiducia è l'owner dall'app,
alla nascita.

**Feedback fidati** (`fiducia: fidato`, mai il mittente): mai `attack`/`spam`, mai contati come
raffica né segnati; se un livello li flagga è un errore → `unlabeled` per ri-giudizio. Caso limite: se il
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
possibilità di crearne di nuovi. Dal ridisegno del lavoro (§3a) ci sono due porte
dirette verso `done`, strette: `todo → done` della pipeline per una segnalazione unita a
un pacchetto fuso, e `working → done` della routine per un feedback già risolto su main.
Questa la tabella la permette a ogni routine, ma il server la accetta solo dal primo
lavoro, con `--reason gia_risolto` e la fusione che controlla da sé (§3a); qualunque
altra consegna `done` da `working` la respinge. Per una routine `todo → done` resta
illegale.

### 3a. Il ridisegno del lavoro (SPEC-RIDISEGNO-LAVORO.md, #1680)

I numeri che motivano ogni regola stanno nella spec, § 1. Qui le regole come le
applicano strumenti e server.

**Una sessione per feedback.** Il manutentore scrive sul server l'ordine dei feedback da
accendere (`npm run manutentore -- accendi N,M,…`, documento `config/manutentore`, solo
admin; `accendi --niente` lo svuota). Con un ordine un primo lavoro parte solo per i
feedback dell'ordine e per le priorità 3; verifica, correzione, controllo di sicurezza,
riallineamento e risposte dell'owner li assegna il server come sempre, anche per i feedback
fuori dall'ordine. A ogni giro le due voci del pacemaker (la normale e quella dei lavori
server) prendono i lavori ammessi dalla scelta di sempre (fiducia, pause, crediti, attese,
semafori) senza un'accensione già in viaggio, in quest'ordine: una priorità 3 fuori
dall'ordine (regola 7), i feedback dell'ordine, il resto nell'ordine della coda; e
accendono una sessione per ciascuno fino ai posti liberi. Legano ogni sessione al suo
numero con l'id che la risposta di accensione restituisce (`routine-accensioni/<sessione>`);
per un primo lavoro la voce normale fa prima la ricerca «già risolto su main» e la lega
anche quella. La sessione di un compito senza feedback resta libera, e una sessione libera
con un ordine riceve la stessa scelta: niente primo lavoro fuori dall'ordine, né un
feedback legato a un'altra sessione accesa che non ha ancora preso il suo biglietto (entro
la finestra d'avvio del pacemaker; dopo è nata morta e il feedback torna libero). Quando
una sessione conta i lavori dell'altra voce per lasciarle il posto, l'ordine vale anche
lì: un primo lavoro che il pacemaker non accenderà non chiede un posto. Un numero
dell'ordine chiuso o inesistente non conta, e un ordine senza feedback aperti vale come
nessun ordine. Senza ordine vale la coda per priorità, come ripiego (SPEC § 4). Le unite di
un pacchetto nato prima del 30/10 si chiudono solo sulle strade della fusione: un «fatto»
consegnato da un ruolo non è una fusione. La sessione accesa così è l'orchestratore, cieco, col prompt salvato di
sempre: il comando `ticket` manda l'id della sessione (`sessione`), e il server, dopo la
parola d'ordine, le dà il biglietto del suo feedback anche senza numero; dopo quel
biglietto ogni altra richiesta della stessa sessione è «niente»
(`sessione_finita: …`), e un numero diverso dal suo è un rifiuto. Un feedback, una
sessione: verifica, controllo di sicurezza e correzione li accende il pacemaker in
sessioni nuove. Una sessione si può ancora accendere a mano per un feedback: il preflight
con `--feedback <N>` consegna `routines/roles/sessione.md`, cieca come l'orchestratore
(chi tiene la parola d'ordine non legge mai il testo di un feedback), che chiede il
biglietto di QUEL feedback (`ticket <parola> --feedback <N>`) e lancia un worker. Un
biglietto di un altro feedback lo strumento lo restituisce subito ed esce come guasto. Il
server fa passare la scelta di sempre ristretta a quel numero e dà il ruolo che serve
adesso; se non c'è risponde «niente» col motivo: `non_in_coda: #N <perché>`, i posti
pieni con il codice di sempre, `feedback_inesistente`. Un numero malformato è un rifiuto
(`bad_feedback`). Un feedback già risolto su main il biglietto lo prende: lo chiude il
primo lavoro.

**Già risolto su main.** Prima dell'accensione (pacemaker) o al primo ritiro del primo lavoro il server cerca, con l'API di
GitHub, le fusioni sulla linea principale di main che portano un commit che cita `#N`
(la fusione stessa o un commit del ramo fuso) dopo la nascita del feedback e la sua
ultima riapertura (`riapertoAt`, che il server segna quando un feedback chiuso torna
aperto), e le passa in `payload.suMain`, anche vuoto; il biglietto se le tiene. Se
GitHub non risponde o la finestra supera i tetti, `suMain` manca e dispatch fa la
stessa ricerca da sé (`scripts/lib/su-main.mjs`). Dispatch segna `propria` la fusione
del lavoro stesso del feedback (vuol dire riaperto dall'owner, non risolto). La sessione
la ricontrolla come primo passo e, se è chiuso davvero, consegna senza ramo `deliver
status --status done --reason gia_risolto --fusione <sha>` con report e frase: `working
→ done` (routine, `statusReason: gia_risolto`). Lo strumento rifiuta uno sha che non
sta sulla linea principale di `origin/main`; il server lo riprova da sé e lo accetta
solo dal primo lavoro, da `working`, se la fusione sta sulla linea principale (una
fusione più vecchia di quanto il server rilegge di main, ~12.000 commit, basta che sia
arrivata su main), porta una citazione del feedback, è più recente della nascita e dell'ultima riapertura e non è
la propria. Chiude come il cancello (stato del giro azzerato) con la frase, il report
preceduto dalla riga della fusione e la versione di `package.json` sulla fusione. Un
rifiuto dice il motivo, e la sessione lavora il feedback come sempre.

**Pacchetti.** Un pacchetto P è un feedback il cui testo è la spec che unisce più
segnalazioni della stessa area: per ognuna cosa cambia e come si verifica. Nasce da
`npm run feedback:apri -- … --pacchetto N,M` col campo `unisce: [{ id, num }]` (in
chiaro, da 1 a 20, solo alla nascita e solo admin: `unisceValido` nelle regole). Lo
strumento controlla tutte le segnalazioni prima di aprire e dice tutti i motivi insieme:
fuori chi non è `todo` (già in lavorazione o ferma), chi ha già un ramo (tornata in coda
dopo una risposta o una riapertura), chi aspetta già un altro pacchetto aperto, chi è a
priorità 3, un lavoro locale, chi ha già 20 attese, chi P stesso aspetta. Area, tetto e
urgenti li controlla il manutentore. Senza `--priorita` P nasce con la
priorità più alta fra le unite. Un pezzo che si blocca in verifica non si stacca: P passa
o non passa intero.

*Gli allegati viaggiano con P*: chi lavora un biglietto apre solo quelli del suo feedback.
Prima di aprire lo strumento legge e decifra immagini, documenti e allegati della
conversazione di ogni unita e li carica in P: i documenti col nome «#N — nome», le
immagini (che un nome non l'hanno) nel campo delle immagini, con da dove viene ognuna in
un blocco in coda alla spec. Il tetto è quello di un feedback, 5 immagini e 5 documenti
compresi quelli di `--allega`: oltre, o con un allegato che non si apre o che un feedback
non ammette, non apre niente e lo dice; un caricamento che non riesce ferma la nascita
(`submit` con `interi`): niente pacchetto monco. Con allegati di una unita non fidata, o
della conversazione di una scritta anche da routine o sessioni, P nasce non fidato anche
da una sessione pulita (lo strumento non manda il biglietto), come un figlio di genitori
non fidati (SPEC-DOMANDE.md § 1.3).

*Le unite si archiviano alla nascita* (decisione dell'owner del 30/10). Chi aspettava una
unita passa ad aspettare P (le sue attese sulle unite diventano una su P, le altre
restano); poi ogni unita va `todo → archived` (owner) con la nota «Unito nel pacchetto
#P: il lavoro continua lì», senza frase per chi l'ha segnalata. Prima le attese: un
aspettato archiviato senza fusione manda chi lo aspetta all'owner (`attesa_chiusa`), così
una unita con un'attesa che non si è spostata resta aperta, e lo strumento stampa le righe
per rimediare, come per ogni passo che non riesce. Chi aspetta una unita ed è aspettato da
P si rifiuta prima di aprire (si aspetterebbero a vicenda); P nato senza numero non
archivia niente, perché nota e attese lo nominano. Il rimando `unitoIn` (l'id di P, come
nell'unione) su ogni unita il cui numero corrisponde lo scrive il server alla nascita di P,
dal trigger di creazione e prima dei giudici: ai client le regole lo vietano, come la fiducia.
Le unite archiviate restano leggibili a chi gestisce il lavoro: `feedback:leggi` non filtra
per stato, e dal cloud `routineFeedback` (#1785) coi numeri espliciti non esclude gli
archiviati e ne dà gli allegati testuali; delle immagini dà il conteggio, e le porta P.

Alla fusione di P (`done`) il server non ha più unite da chiudere. Resta, per i pacchetti
nati prima (le unite `todo` che aspettano P), la chiusura di prima: `todo → done`
(pipeline, `statusReason: pacchetto`) con la frase di P come `userNote` (senza, una frase
di ripiego, e le note di P lo dicono) e la versione di P se ne ha una, PRIMA di scrivere P
in `done`, così l'attesa sciolta non le rimette in coda, con un gancio solo per ogni
strada che porta P a `done` dopo una fusione; un'unita che è a sua volta un pacchetto
chiude prima le sue. Una unita archiviata col rimando a P non è un'eccezione da scrivere
nelle note di P; una in un altro stato, o che non aspetta più P, resta dove sta e le note
lo dicono. Il messaggio della fusione di P cita le unite (`merge-gate: #P via server
(unisce #N, #M)`), così la ricerca «già risolto su main» le trova. P archiviato senza
fusione: le unite restano archiviate; se il lavoro serve ancora le rimette in coda l'owner,
da Gestione (`archived → todo`).

**Il piano.** Un lavoro grosso (una spec in più fasi, un pacchetto) consegna il piano
prima di toccare codice e a ogni parte chiusa (`deliver piano --piano <file.md>`, al più
64 KB, oltre è un rifiuto col numero): il server lo scrive nelle note per l'owner, lo
tiene cifrato nel feedback (l'ultimo sostituisce il precedente) e lo rimanda a chi
riprende, nel primo lavoro e nella ripresa (`payload.piano`). Lo consegnano solo il
primo lavoro e il correttore di una ripresa. Alla chiusura il piano si toglie: un
feedback riaperto riparte senza il piano di un lavoro già fuso. Figli (#N.M) per spezzare un lavoro non se ne
aprono più: il contenitore è il pacchetto.

**Il motivo del correttore.** Chi corregge (fixer, nel riallineamento e nella ripresa)
consegna `dispatch.mjs --record-fixed … --motivo "<tipo>: <dettaglio>"`: conflitto coi
file (o «nessuno»), prove rosse con le prove, ripresa, altro col testo. Forme e parser in
`SN_VERIFIER_ROUND.leggiMotivoCorrettore`. Senza motivo lo strumento non consegna, e il
server rifiuta la consegna `fixed` di un correttore senza un motivo che il parser rilegga
identico; quello valido lo scrive nel biglietto (`motivo`, più `riallineamento` del
client) e nelle note per l'owner. Una fermata nella stessa consegna (segnalazione o
domanda, che va in `design`) vale come motivo. Il rilascio non si blocca: terrebbe il
semaforo a un worker morto.

**La verifica dopo un riallineamento.** Dispatch scrive nel marcatore del ruolo la base
del confronto (`dal`: lo sha verificato se il server lo manda come `shaVerificato`, sennò
la punta che il correttore riceve). Alla consegna lo strumento guarda due cose: i file in
cui la modifica del ramo è cambiata, senza i numeri di riga (`fileRiscritti`), e i file
in cui la punta verificata va in conflitto con main (`git merge-tree`, `fileInConflitto`),
più quelli che il motivo dichiara. Manda `riallineamento: { fileRiscritti,
fileInConflitto, giro }`. Se tutti stanno fra i file di servizio (`FILE_DI_SERVIZIO`:
`src/shared/patchNotes.js`, `src/shared/capabilities.js`, `tests/rossi-noti.json`,
`PATTERNS.md`), o non ce n'è nessuno, niente giro nuovo di verifica: bastano le prove del
server sulla fusione, e il controllo di sicurezza resta. Un file di codice in conflitto o
riscritto chiede la verifica intera, perché è logica che nessuno ha guardato (anche un
conflitto risolto tenendo le due parti, che lascia la modifica del ramo uguale). La
regola è `giroDopoRiallineamento` in `verifierRound.js`; il server rifà il confronto da
sé con l'API di GitHub e non si fida di quello del client: per i conflitti approssima
`merge-tree` (zone sovrapposte o a contatto nei file toccati da tutte e due le parti;
nel dubbio, conflitto). Per questo dispatch spinge il ramo prima di consegnare. Ogni
guasto (GitHub giù, sha sconosciuto, main cambiato in troppi file) vale `pieno`. Un
lavoro che tocca anche il server confronta allo stesso modo la sua parte del server,
dalla punta verificata a quella registrata dell'ultima spinta (`realign.shaVerificatoServer`):
lì nessun file è di servizio, quindi la parte del server deve restare identica o portare
la stessa modifica; senza una delle due punte vale `pieno`. Con `nessuno` il server
scrive «verifica passata» sulle punte nuove (app e server) e il lavoro va al controllo
di sicurezza; la decisione, coi file, va nel biglietto
(`giroDopoRiallineamento`) e nelle note.

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
- Il segno `localOnly` (#908) non sposta di scheda (#1575): la pratica sta nella scheda del suo stato con l'etichetta «server».
- Aspettano (#903): `waitsFor: [{ id, num }]` (in chiaro, da 1 a 20, scrive l'admin da Gestione, `npm run feedback -- <n> --aspetta 676,663.2` / `--aspetta-niente` e `feedback:apri --aspetta`; inesistenti, sé stesso e giri si rifiutano; un'attesa già scritta non si rifiuta perché il suo aspettato è sparito, e da riga di comando la risposta dice quelle che sostituisce): finché un aspettato non è fuso (`done`, o `archived` con `resolvedInVersion`) né biglietti né accensioni per un `todo` o un ramo in revisione, poi entra in coda da solo; se uno si chiude senza fusione o sparisce, il pacemaker lo porta in `design` (`statusReason: attesa_chiusa`) con la domanda e toglie quell'attesa.
  - **La priorità risale le attese** (#1630, decisione dell'owner del 23/10): se B aspetta A, `priority` di A
    vale almeno quella di B, lungo tutta la catena (C aspetta B che aspetta A → A ≥ B ≥ C), e **solo verso
    l'alto**: un'attesa tolta o B riabbassato non riabbassano niente. Scatta quando la priorità di un feedback
    sale o gli si aggiunge o cambia un'attesa (anche alla nascita); salgono al suo valore gli aspettati aperti
    (non fusi, non chiusi, non archiviati, non cancellati), e da loro i loro aspettati. Uno con stato o priorità
    illeggibili si salta, mai riscritto più basso. La scrive il server, in un punto solo (trigger sul documento
    feedback, qualunque scrittore), cifrata e col segno `priorityInherited: true` (in chiaro): il giudice di
    priorità può alzarla ma non abbassarla; su un `priorityManual` il segno manuale resta e il giudice continua a
    non toccarla. Con la nota «priorità 3: la eredita da #B, che lo aspetta»; l'alzato entra in coda con la
    priorità nuova. L'owner resta libero di abbassare a mano un aspettato sotto chi lo aspetta; un aspettato fuso
    e poi riaperto eredita alla prossima salita di priorità o cambio d'attesa di chi lo aspetta.
    Logica pura: `ereditaPriorita`, `scattaEredita`, `notaEredita` in `src/shared/feedbackAttese.js`,
    sentinella in `tests/unit/feedbackAttese.test.mjs`.
- Risolti: `done(rilasciato)` — Archiviati: `archived` (+ filtro ⭐; + filtro "Bloccati
  confermati" per `*_confirmed`, decisione presa: restano ispezionabili come log lì).

### 4b. I lavori delle sessioni locali (#908)

`localOnly: { by, at }` (in chiaro, `at` in millisecondi, scrive solo l'admin) dice
che la pratica la lavora solo una sessione locale: la coda delle routine, il recupero
degli arenati e il pacemaker la saltano. In Gestione resta nella scheda del suo stato (In
coda, Aspettano, Ricevuti…) con l'etichetta «server» (#1575): la scheda «Lavori server» non
c'è più.

- Il segno si mette solo su un feedback **fidato** (#1148; lo fa l'owner con «🤝 Segna fidato»
  in Gestione, da riga di comando no), a pratica aperta, non segnalata come
  attacco/spam e non in mano a una routine (`localSignCheck`). Su un utente o una routine
  solo col sì dell'owner: da una sessione dell'owner un feedback torna nei Ricevuti (`design`,
  motivo `locale` senza `domandaId`, nota «Richiede lavoro locale») con `owner-feedback.mjs
  --serve-locale`, e lì l'owner lo approva (#913, sotto). Dalle routine `design`+`locale` senza
  domanda non nasce più: il lavoro server va ai lavori server o chiede la fiducia (§3), e il
  motivo `locale` con `domandaId` è un passo che solo l'owner può fare, chiesto con la domanda.
- **L'approvazione dell'owner (#913)**: `localApproval: { by, at }` (stessa forma di
  `localOnly`, scrive solo l'admin, `localApprovalValido` nelle regole). La scrive
  «💻 Lavoro server» nei Ricevuti (dettaglio, tasto destro sulla scheda, pagina dei
  feedback), insieme a `todo`, `reviewDecision: accepted` e `localOnly`: il feedback torna
  In coda col segno. Dal #1575 il tasto c'è solo sui rombi azzurri nati prima del #1358
  (`design`+`locale` senza `domandaId`), dove è l'unica uscita; su un fidato scrive il solo
  segno. Solo da lì (#957): nessuno strumento delle sessioni lo scrive, perché
  hanno le credenziali dell'owner e un testo d'utente potrebbe convincerle a darselo. Le regole non distinguono la
  pagina da uno script con lo stesso token: il limite sta negli strumenti (sentinella in
  `tests/unit/lavoroLocaleApprovato.test.mjs`). Lo stesso clic segna anche fidato il
  feedback (#1148, callable `ownerFiducia`): è la fiducia, non il segno, a far registrare L5
  senza fermare (§4b); la sessione lo lega a `start`/`finish --feedback`. Non cambia chi l'ha scritto: il lettore lo dice ancora utente, e il testo resta
  un dato. Il sì si scrive solo su chi non è fidato né già approvato; su un
  segnalato l'hover lo dice e serve guardarlo prima.
  Togliere il segno locale lascia l'approvazione. Risolto, il feedback di un
  utente approvato tiene la scheda pubblica (`isPrivateLocalWork`): è da lì che chi l'ha
  mandato vede la risoluzione; senza scheda resta solo il lavoro dell'owner e delle sessioni.
- In Gestione non si mette né si toglie più a mano (#1575): lo mette il server quando chi
  lavora lo chiede (#1358). Da riga di comando `owner-feedback.mjs --solo-locale | --non-locale`, e nasce già messo sui
  feedback aperti da `claude-feedback.mjs --locale` (`--non-locale` per le routine: la
  scelta è obbligatoria, perché una segnalazione per le routine nata locale non la prende nessuno).
- Le sessioni locali hanno le credenziali dell'owner. Per REGOLA (non per un blocco
  tecnico) non spostano feedback dai Ricevuti né dalle conferme `*_confirmed`, non
  lavorano feedback di utenti senza il sì dell'owner e non stampano testo di attacchi: `owner-feedback.mjs`
  rifiuta prima di scrivere.
  La priorità invece la cambiano su ogni stato, Ricevuti compresi, perché non sposta la pratica:
  `owner-feedback.mjs <n> --priorita 0..3`, scritta come il pallino di Gestione (cifrata, `priorityManual`).
- Alla nascita un lavoro locale fidato salta i giudici (`pipeline.skipped:
  'local_proven'`, status `todo`). Alla fusione `npm run finish` manda `feedbackId`
  (da `--feedback <N>` o da `verify-local.mjs start --feedback <N>`): se la pratica è
  fidata e il ramo ha nel registro (`routine-branches`) solo sessioni col biglietto pulito,
  con la punta che si fonde come ultima voce, il server esegue L5 solo per registrare i
  blocchi (`skippedL5: true`, motivo `fiducia`), fonde senza chiedere e chiude la pratica.
  `verify-local start` e `finish` scrivono la voce col biglietto della sessione
  (`scripts/biglietto.mjs`). Manca una condizione → la richiesta aspetta il sì dell'owner in
  Gestione, col motivo. I rami nati prima del registro, di pratiche migrate, seguono la
  regola di prima (prova del mittente o `localApproval`) finché non si chiudono.

### 4c. Chi nasce senza giudici (#914)

Alla nascita (solo il trigger di creazione) L1 e L2 non girano se e solo se il feedback è
**fidato** (#1148, `functions/src/nascita.js`); il mittente decide solo dove va:

- lavoro locale fidato (§4b): `todo` col segno, senza nemmeno il cancello degli allegati;
- owner, sessione col biglietto pulito (`claude-feedback.mjs --non-locale`): il cancello degli allegati, poi `todo` In
  coda (`pipeline.skipped: 'fidato'`); la priorità scelta con `--priorita` nasce col documento
  (`priorityManual`), senza scelta la decide il giudice;
- ritrovamento fidato del server (`routine:`/`agent:` + `senderProof: 'server'`: ritrovamenti,
  derivati, allarmi della costruzione): il cancello degli allegati, poi dove dice l'**origine** (`pipeline.skipped:
  'routine_proven'`, decisione dell'owner del 04/10). Un ritrovamento NON fidato passa dai
  giudici; se lo manderebbero in coda, aspetta comunque l'origine come sotto. L'origine è il lavoro del biglietto (`origineId`, lo scrive il server,
  mai la routine; `parentId` resta un collegamento) e conta il genitore diretto:
  - origine fidata (anche un derivato fidato già in coda) → `todo`;
  - origine d'utente non ancora fusa → resta `unlabeled` (`statusReason: attesa_origine`); quando
    l'origine arriva a `done` → `todo`; se si blocca (`attack`, `spam`, `suspicious_file`, i
    confermati, `design` per `secaudit` o `l5`) → `design` (`statusReason: origine_bloccata`,
    rosso, L1 pericoloso sul triangolo, mittente non segnato); se si chiude senza fusione
    (`archived`) → `aligned` (`statusReason: origine_chiusa`). Lo fa il trigger
    `onFeedbackOrigineCambiata` (functions/src/origine.js), e alla nascita si rilegge l'origine
    dopo la scrittura perché un passo appena avvenuto non vada perso;
  - origine sparita → `aligned` (`statusReason: origine_mancante`);
  - senza origine (gli allarmi della costruzione) → `todo`, a interruttori spenti o accesi
    (decisione dell'owner del 05/10, #1035): le routine lo prendono quando l'automatica è accesa,
    come ogni altro lavoro in coda. Vale anche per il NON fidato: passa
    dai giudici, e se lo dicono allineato entra in coda senza guardare gli interruttori; se lo
    fermano resta nei Ricevuti. La prova è `senderProof: 'server'` col prefisso, mai il solo nome:
    un anonimo che si firma `agent:costruzione` è un utente. L'allarme porta la sua priorità
    (`priorityManual`, 3): il giudice di priorità non la riscrive.
  - un derivato col `?` fa eccezione: dove gli altri andrebbero in coda o ad aspettare, lui va nei
    fermo sulla sua domanda (`design`, `decisione`, `domandaId`: §3, Pipeline; In coda col segno).

  Chi è fermo con l'origine (`design`, `origine_bloccata`) la segue anche quando l'owner la libera:
  torna ad aspettarla (`design → unlabeled`) se il lavoro riparte, entra in coda (`design → todo`) se
  si fonde, va in `aligned` se si chiude senza fusione. Allo stesso modo chi aspetta la sua domanda
  con l'origine chiusa (`aligned`, `origine_chiusa`) la aspetta di nuovo (`aligned → unlabeled`)
  se l'owner la ripristina, ed entra in coda (`aligned → todo`) quando si fonde. Sono le sole uscite
  della pipeline da `design` e da `aligned`, e solo per quei motivi; un derivato che l'owner ha già
  spostato non si tocca. Chi entra in
  coda dopo l'attesa passa dal giudice di priorità come alla nascita.

Il prompt dei giudici dice che a loro arriva solo un utente: un linguaggio da sviluppatore o
da agente è un segnale sospetto. Non a un mittente provato (l'owner dall'app, la ri-valutazione
di una routine o di una sessione): lì il tono tecnico è normale. Una ri-valutazione passa
sempre dai giudici.

Le routine non aprono lavoro locale: dentro una routine `claude-feedback.mjs` e
`owner-feedback.mjs --solo-locale` si rifiutano. Dal #1358 nessun lavoro torna al PC
dell'owner: `deliver status --status design --reason locale` vuol dire «serve il codice del
server», e il server dà a un feedback fidato il segno dei lavori server (`localOnly`, `by:
routine`) rimettendolo `todo`, mentre uno non fidato resta `design` col motivo `fidato`
(Ricevuti L3, richiesta di renderlo fidato). Un passo che solo l'owner può fare (un segreto,
un'automazione GitHub) arriva con la sua domanda (`--domanda`), e il feedback resta
`design`/`locale` col `domandaId`, In coda (§5).

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

**Per fiducia (#446, §10).** "ON" non è un sì/no per tutti: l'interruttore master
(`config/automation.enabled`) abilita l'auto-approvazione, e la mappa
`config/automation.autoApprove` dice QUALE fiducia ne beneficia: `fidato` e `non_fidato`, mai
un mittente. Master spento ⇒ nessuno, qualunque cosa dica la mappa. Mappa assente ⇒ tutti.
La logica è pura e vive in due copie da tenere allineate, con la stessa tabella di casi nei due
test: `src/shared/feedbackThread.js` (dashboard) e `filo-security/functions/src/autoApprove.js`
(chi decide davvero). All'automatica i fidati arrivano di rado: owner e sessioni pulite entrano
in coda senza giudici (§4c); restano i ritrovamenti delle routine senza origine e gli allarmi.

**Compatibilità:** una mappa salvata prima del §10 ha un interruttore per categoria d'autore
(`owner`, `user`, `local`, `worker`, `verifier`, `residuo`, `prober`, `claude`, `filo`). Finché
l'owner non sceglie i due nuovi, uno spento chiude: `fidato` si chiude se è spenta una delle
istanze delle routine (`worker`, `verifier`, `residuo`, `prober`, `claude`), `non_fidato` se è
spento uno qualunque (`resolveAutoApprove`, in entrambe le copie).

## 5. La dashboard distingue i sotto-casi di `design`

Un solo stato `design`, più origini, distinte da `statusReason`: (1) verdetto
giudici (nessun reason o `judges`); (2) domande della routine (appende le domande
alla chat + `statusReason: clarify`); (2b) un derivato nato da un rilievo col `?`
(`statusReason: decisione`, domanda in chat dalla nascita, #775): alla risposta torna
`todo` e lo prende un risolutore da capo, con domanda e risposta nelle `decisioni`; (3) la verifica ha trovato un difetto di livello
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
arenata ripetutamente (`statusReason: arenato`); (6, #1241) chi risolve o
corregge è caduto su un guasto dell'ambiente (`statusReason: guasto`). Dal #1790
un guasto non ferma più e non apre una domanda: si dichiara nel rilascio
(`--guasto "<gruppo>: <messaggio>"`), il feedback torna `todo` sul suo ramo con
la nota del guasto, e una consegna `design` + `guasto` si rifiuta; al terzo guasto
uguale di seguito il server apre una domanda col conteggio, che smista il compito
«Gestisci la domanda» (SPEC-DOMANDE §3.5, §3.8). Non è lavoro per regola: quello è
`locale`, e la sua nota dice quale regola lo tiene fuori dalla cloud. La risposta dell'owner appende
alla chat e (se decide) muove a `todo`. Sul caso `secaudit` l'owner ha anche
«Salta il controllo»: il server scrive `livelli.l4 = { esito: saltato, by:
owner }`, tratta il verdetto come un pass e lancia subito il cancello L5 sul
ramo; l'esito è quello di un'approvazione (fuso → `done`; bloccato → richiesta
di fusione in attesa; conflitto → riallineamento). Non serve una transizione
nuova: è `design` → `todo` con attore owner, e da lì il cancello. Il salto vale
solo per la versione letta da verifica e audit (#1040.1): se la punta del ramo
non è più quella, o il giro non dice quale fosse, il server non salta, non fonde
e non apre richieste (esiti `mosso`, `senza_controllo`), la pratica resta dov'è
e il pentagono propone di rimandarla in lavorazione.

**Le attese con la loro domanda (#1358, SPEC-DOMANDE §3.8).** Ogni fermata dei casi (2),
(2b), (3), (5), (6), `attesa_chiusa`, `locale` con la domanda, e `aligned` con `origine_chiusa`
o `origine_mancante` apre una domanda per l'owner e il feedback prende `domandaId`,
restando nello stato e col motivo di prima: la macchina a stati non cambia. Dal canale la
domanda nasce nella stessa transazione dello stato, ed è sempre quella scritta da chi si
ferma con `--domanda`: il server non ne compone più, e una fermata senza domanda si
rifiuta (tranne `locale`, #1790). Un derivato nato da un rilievo col `?` prende la domanda
del rilievo, e il suo titolo. Le fermate del server (`loop`, `arenato`, `attesa_chiusa`,
`origine_chiusa`, `origine_mancante`) ricevono la domanda di servizio, coi fatti e le due
strade, che il compito riscrive: rimesse in coda girerebbero senza fine. Una fermata di chi
lavora che entra in `design` senza una domanda viva (la pipeline, una migrazione) torna
invece in coda con una nota che dice perché. Ogni domanda nasce `in_smistamento` e
arriva all'owner dopo il compito «Gestisci la domanda» (SPEC-DOMANDE §3.5). Una domanda aperta di un'attesa lasciata per un'altra strada diventa
`superata`. In dashboard un `design`/`aligned` con `domandaId` e uno di quei motivi sta
**In coda**, col segno «aspetta D-n» che apre la domanda nella sezione Domande; nel
dettaglio la casella di risposta lascia il posto al tasto «Rispondi alla domanda»: si
risponde in un posto solo. La risposta con l'opzione `riprendi` lo riporta `todo` con la
decisione in `payload.decisioni`, `notePerAgenti` comprese, e scrive la ripresa sul ramo
del lavoro; il solo testo resta parole da ogni strada e va al compito «Gestisci la
risposta» (SPEC-DOMANDE §3.4, #1598). Un `riprendi` su un feedback che non è fermo non ne
cambia lo stato: la decisione si accoda; una
domanda archiviata o superata non sblocca niente. Restano nei Ricevuti, anche con un
`domandaId`: `secaudit`, `l5`, `fidato`, attacchi, spam e file sospetti. Le
attese aperte prima si migrano con `ownerDomande { op: 'migra' }`, a lotti
(`npm run domande:migra`, a secco; `-- --dal-vero` per creare); un guasto di prima, che
nominava la domanda solo nella nota, la adotta.

**Le domande che fermano un lavoro in coda (#1577, SPEC-DOMANDE §3.1 `blocca`).** Fuori
dalle fermate lo stato non cambia: un `todo` o un ramo in revisione con una domanda
bloccante aperta tiene il suo id in `domandeBloccanti` (lo scrive solo il server, nella
transazione che cambia la domanda), nessuna routine lo prende, e in dashboard sta in
**Aspettano** col segno «aspetta D-n». Alla risposta l'id esce dall'elenco e il lavoro
riparte con la decisione. La ripresa non sposta un `todo`, un `working` né un
`revision_capability` (la decisione si accoda per il giro dopo); un `revision_security`
torna `revision_capability` coi verdetti azzerati, perché sicurezza e fusione non leggono
le decisioni; un `done` torna `todo`. Fanno eccezione gli ultimi due quando la scelta è la
provvisoria di una domanda non bloccante, senza parole in più: il `revision_security` resta
dov'è con la decisione accodata, e sul `done` la risposta dice «non serviva». Finché una bloccante è aperta né il recupero delle fusioni né la richiesta del
server fondono il ramo.

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
  ora si mangia le accensioni e i crediti dell'account entro sera.

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
  *(Dal 2026-10-15, #795: alla chiusura di un lavoro, per qualunque strada, i suoi giri
  — data, livelli trovati, esterni, corretti, bilancio pagato, esito; mai il testo dei
  rilievi — passano nella collezione `routine-giri`, chiusa alle app; lo stato del giro
  si azzera come prima. Li stampa `node scripts/storico-giri.mjs --da … --a …`.)*
- **`firestore.rules`**: enum `status` esteso ai nuovi valori (in create anonimo resta
  bloccato: solo `new`→ ora `unlabeled`), `hasOnly` esteso con `statusReason`,
  `workingSince`. Deploy manuale (`npm run regole:pubblica`).

### 8. Migrazione legacy → nuovi stati (confermata dall'owner ed eseguita il 2026-07-03, F5)
Script una tantum, più la normalizzazione in lettura per lo storico (che resta). Lo
script è stato tolto il 2026-10-15 (#1134), con quello dell'imbottitura dello `status`
cifrato: una prova a vuoto su tutte le segnalazioni in produzione non trovava più
niente da cambiare. La storia di git li conserva.
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
      lo script una tantum (tolto con #1134, §8) con token admin in tests/agent/.env
      (gitignorato). 101 migrati / 226 già canonici / 0 errori: 40→aligned,
      2→attack, 1→spam, 3→design(judges), 4 clarify→design(clarify),
      21→unlabeled, 30 ignored→archived. Rilanciata a vuoto: 0 da migrare
      (idempotente). Nota: lo script decifra TUTTO il doc (soprattutto
      `pipeline`) con decrypt-feedback-fields, altrimenti classifica tutto
      unlabeled.
- [x] **F6 — filo-security** (fatto 2026-07-03, commit bd93b47, DEPLOYATO):
      `src/statusMap.js` (decisione→status canonico; fidati mai attack/spam →
      unlabeled; canWriteStatus = la pipeline non regredisce feedback oltre il
      giudizio — vale anche per le ri-valutazioni); `src/cancelloAllegati.js` (cancello
      deterministico allowlist su `files[]`, PRIMA dei giudici → suspicious_file,
      niente panel); `feedbackState.recordDecision` scrive `status` CIFRATO (come
      il pipeline: anti hill-climbing, la dashboard lo decifra già — status è nei
      TEXT_FIELDS) + `statusPublic` in chiaro; runner: cancello degli allegati, owner-accepted →
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
