# Ridisegno delle routine per il piano Max — decisioni prese (2026-08-18)

Decisioni concordate owner + Claude nella sessione del 2026-08-18. Questa spec
è la fonte per l'implementazione. **Cantiere aperto il 2026-08-18** (questa
copia è entrata nel repo con il trasloco documenti, passo 2 del §14).

## 0. Contesto

Passaggio dal piano Pro al piano Max (20× l'uso). I vincoli che avevano
modellato il sistema — finestra 5h stretta, budget stimato a spanne, feedback
spezzati per farci stare i pezzi — decadono. Il ridisegno toglie i meccanismi
nati da quei vincoli invece di adattarli.

## 1. Sotto-feedback: aboliti

- Un feedback non si spezza più: il worker lo lavora INTERO e, se serve, usa
  sotto-agenti propri (SEMPRE sequenziali, mai in parallelo: l'hook di
  salvataggio si pesta sui lock, e il ritmo di consumo resta contenuto).
- Verifica, secaudit e cancello di merge operano sull'INTERO feedback. La
  verifica avversariale torna a confrontarsi con le parole originali
  dell'owner, non con spec di seconda mano scritte da chi spezzava.
- Muore il "Modello B": niente più branch di feature intermedi, niente
  feedback finale d'integrazione auto-generato, niente "priorità massima
  finché la feature non è chiusa".
- I sotto-feedback storici (#146.x, #379.x, #477.x…) restano VISIBILI in
  dashboard; sparisce solo la possibilità di crearne di nuovi.
- La macchina a stati vive in due copie (dashboard + server filo-security):
  lo smontaggio va fatto su entrambe, con rideploy (v. §7 per la soluzione
  definitiva alle due copie).
- L'owner può sempre "spezzare" da sé aprendo più feedback distinti: non serve
  nessun meccanismo.

## 2. Niente ripresa del lavoro interrotto

Il lavoro di una sessione morta a metà SI BUTTA: claim rilasciato, ramo
abbandonato, si riparte da capo al giro dopo. Riprendere il codice senza il
ragionamento che l'ha prodotto è peggio che rifare. La politica è sostenibile
perché col nuovo impianto i tagli a metà diventano rari per costruzione
(niente finestre, il giro in corso finisce sempre).

## 3. Budget: solo rete reattiva

- Abolite la stima del tetto 5h (CAP_5H), la soglia di spawn al 70% e tutta la
  contabilità ccusage: col piano Max un giro sequenziale non esaurisce la
  finestra.
- Il costo resta SOLO come rete di sicurezza reattiva: a un segnale di limite
  (429 / session limit) → bonifica e chiusura. MAI rilanciare dopo un taglio.
- Prima settimana sul piano nuovo: osservare i consumi reali, nessuna taratura
  a tavolino.

## 4. Niente finestre d'ore

Un giro finisce quando: il server dice basta, la coda è vuota, o il contesto
dell'orchestratore è quasi pieno. Nessun tetto d'orologio, nessuna stima di
durata, nessun "margine per l'ultimo worker".

## 5. Il pacemaker (Firebase, progetto filo-security)

- La routine su claude.ai NON ha più la schedulazione fitta: parte quasi solo
  su chiamata (trigger API, endpoint di accensione con token al portatore).
- Una funzione schedulata nel progetto filo-security ("pacemaker"), ogni
  10-15 minuti: interruttore acceso? lavoro in coda? nessun battito fresco?
  run giornalieri rimasti? → una POST accende un giro. Altrimenti niente.
- Il token vive nei Secret delle functions. MAI negli ambienti delle sessioni.
- L'orchestratore NON accende il successivo: chiude e basta (per qualunque
  motivo, anche crash). Il pacemaker se ne accorge dai battiti e riaccende.
- Anti-loop guasti: se l'ultimo giro è morto subito (< X minuti), periodo di
  rispetto (≥ 1h) prima di riaccendere. Nessun ritentativo cieco.
- ÀNCORA: resta UNA schedulazione Anthropic al giorno come paracadute — se il
  pacemaker muore, il sistema resta vivo e l'anomalia si vede nei log.
- Avvertenze: l'endpoint di accensione è in beta (può cambiare forma, con
  preavviso); i run via API contano nel tetto giornaliero (Max ≈ 15/giorno —
  verificare su claude.ai/code/routines); i run one-off schedulati NON
  contano; lo sforamento a consumo (usage credits) resta SPENTO.

## 6. Controllo dalla dashboard

- Lo stesso interruttore di oggi (config/routines): spento → il server smette
  di dare lavoro nuovo E il pacemaker non accende più. Il feedback in corso
  finisce e viene consegnato. Nessun lavoro troncato.
- Politiche di ricambio (contesto, "basta per oggi", fasce orarie) = risposte
  del server alla richiesta di lavoro ("chiudi"), non logica nelle sessioni.
- I battiti (heartbeat del canale autenticato, già in costruzione con #477)
  sono l'UNICA definizione di "qualcuno sta lavorando". Niente flag che una
  sessione morta lascia in giro.

## 7. Fonti di verità singole (fine delle copie a mano)

- Filosofia per i giudici L2: incorporata nel prompt AL DEPLOY delle functions,
  leggendo filo_filosofia.txt dal repo pubblico (checkout locale o raw GitHub).
  La copia manuale nel file dei principi cessa di esistere come file da
  mantenere: esiste solo come output della generazione.
- Transizioni della macchina a stati: promosse a DATI, un file unico nel repo
  pubblico; la dashboard lo legge, il server lo incorpora al deploy. Il
  comportamento del server cambia solo al rideploy (stesso livello di fiducia
  di oggi).

## 8. Documenti: nuova struttura

Principio: i file sono per chi li mantiene; le istanze ricevono testo già
composto (dispatch inlina). MAI duplicare a mano un blocco in due posti.

- CLAUDE.md → snello: switch di ruolo, letture obbligatorie, regole del repo,
  fonti di verità, comandi, architettura. Rimandi, non trattati.
- LOCAL.md (nella cartella sopra, fuori repo) → il lavoro locale: meta-lavoro
  (routine, filo-security, design, aprire feedback) + ricetta per quando si
  tocca codice.
- ROUTINES.md → ABOLITO. L'orchestratore diventa un file-ruolo
  (routines/roles/orchestrator.md) e ANCHE A LUI il ruolo viene CONSEGNATO:
  il preflight di dispatch lo inlina nell'output quando risponde "si può
  lavorare" (piccolo ritocco al preflight). In cloud nessuno legge file di
  istruzioni da sé: orchestratore ← preflight, worker ← dispatch. Il prompt
  salvato su claude.ai resta di due righe (parola d'ordine + "lancia il
  preflight") e non si tocca più quando si ritoccano i ruoli.
- routines/shared.md → NON SI CREA (decisione rivista il 18/08 con l'owner: il
  riferimento era rotto da sempre — citato ovunque, mai esistito, mai notato —
  prova che i file-puntatore falliscono). TUTTO il condiviso vive in CLAUDE.md:
  sintomo-vs-causa, invarianti UX e deviazioni, i tre testi di consegna, la
  verifica coi suoi minimi. Meno file, meno chiamate, meno modi di sbagliare.
  Nei ruoli restano solo le meccaniche di consegna specifiche.
- Le CICATRICI degli incidenti (chiave ri-prefissata nelle shell nuove,
  rifiuto≠guasto, mai rilanciare dopo un taglio, riga finale = dato) si
  conservano nel file-ruolo a cui insegnano qualcosa. Non si cancellano.
- La scorciatoia che salta la verifica in `npm run finish`: eliminata da
  documenti E script.
- Mai lavorare direttamente su main: una riga di divieto; la protezione sta
  nel codice.
- L'hook di salvataggio continuo RESTA, rimotivato: non è (solo) il paracadute
  anti-crash, è il trasporto del lavoro (rende il ramo visibile a verifica,
  server, riconciliazione).

## 9. Laboratorio del verificatore (già operativo)

- Clone in Desktop/Filo/verifier-lab: senza remoto (non può pushare per
  costruzione), hook staccati, 34 rami e storia completa per il checkout dei
  commit verificati all'epoca.
- Metodo: due insiemi — feedback poi rivelatisi difettosi (conteggio
  automatico: preso/non preso) e feedback rimasti sani (le critiche NON si
  contano come falsi positivi: si raccolgono e le giudica l'owner — potrebbero
  essere errori veri mai notati). Più corse per caso (3-5). L'istanza che
  verifica è CIECA: riceve richiesta e ramo come in produzione, mai il difetto
  atteso.
- Anche modelli open economici via OpenRouter come possibile setaccio
  AGGIUNTIVO (mai sostitutivo), nel rispetto della politica modelli: pesi
  aperti, mai dai server del produttore.
- **Varianti di prompt già in lista** (18/08): la lente "immagina di essere un
  utente che si vuole lamentare" — proposta dall'owner, sospesa perché rischia
  solo rumore ("si trova sempre di che lamentarsi"): entra nel prompt SOLO se
  nel lab alza le catture sui difettosi senza alzare gli allarmi sui sani.
- **ESITI DEL LAB (18/08, due tornate — dati in `Desktop/Filo/verifier-lab-results/`).**
  8 rami ciechi: 5 lavori genuini, 2 mutazioni da una riga costruite per
  **passare i test scritti col lavoro**, 1 caso volutamente ambiguo.
  - *Tornata 1 (prompt storico, quello permissivo).* Nessun modello ha mai
    approvato una mutazione: deepseek 21/21 sui casi netti a $0.007 a corsa,
    glm 20/21, Opus e Fable senza errori. **Zero oscillazioni** su 3 corse
    identiche nei casi chiari; l'unica oscillazione è sul caso ambiguo — cioè
    dove il giudizio è legittimamente incerto. La verifica per ragionamento
    coglie il «verde ma sbagliato» che i test inclusi non vedono: è la prova
    del concetto.
  - *Tornata 2 (prompt audace, sui 5 lavori che erano stati APPROVATI).*
    Risposta alla domanda «esagera?»: **il modello forte ha trovato 5 rilievi
    su 5, tutti verificati veri** (fra cui due chiusi indipendentemente mesi
    dopo da qualcun altro: prova esterna che non erano capricci). Ma sono **5
    bocciature su 5**, una delle quali per un'evidenziazione invisibile sul
    tema scuro. Conclusione: il prompt audace **non esagera nel trovare, ma
    l'esito binario esagera nel bloccare** → §13.
  - *Il modello economico non serve a questa verifica.* Con lo **stesso** prompt
    audace, deepseek ha dato PASS in **15 corse su 15**, zero rilievi: trovare
    ciò che manca richiede di costruirsi il modello di cosa dovrebbe esistere,
    e quel salto non lo fa. Resta bravo sui difetti **presenti**.
  - *Trappola metodologica da non ripetere:* la prima tornata aveva letto la
    recipe **dal checkout del ramo** (versione storica), non il prompt da
    misurare. Il prompt sotto esame va passato da fuori, sempre.
- **Il prompt base è deliberatamente AUDACE sullo scope** (decisione owner
  18/08): nel dubbio si completa — le invarianti e i miglioramenti senza
  trade-off mancanti si segnalano, non si perdonano; solo il trade-off vero va
  all'owner come suggerimento. Motivo: i feedback di Filo saranno spesso poco
  specificati (screenshot + "non va"), il valore sta nel ricostruire l'intento.
  ⚠️ **Aggiornamento**: la parte «sono FAIL» è **superata da §13**. Il prompt
  resta audace nel CERCARE; a ciò che trova dà un livello, e l'esito lo calcola
  il server. Non ammorbidire la ricerca: cambia solo dove finisce l'esito.

## 10. Chiusura del buco del push diretto su `main` (sicurezza)

Individuato dall'owner il 18/08: oggi NIENTE impedisce fisicamente a
un'istanza catturata da una prompt injection di pushare dritta su `main`,
saltando verifier, secaudit e L5 — i controlli girano solo sul cammino onesto.
"Difficile" non è una difesa: l'ultimo livello deve essere NON CONVINCIBILE.

Chiusura (si incastra nell'architettura del canale #477):

- **il merge lo fa il SERVER, non la sessione**: il worker chiede "fondi
  questo ramo" sul canale autenticato; il server verifica dallo stato VERO
  (PASS verifier + PASS secaudit registrati, L5 sul diff) e fonde lui via API
  GitHub con una propria identità;
- **`main` protetto lato GitHub**: possono scriverci solo quell'identità e
  l'owner. Il push diretto da una sessione diventa fisicamente impossibile,
  non solo vietato a parole;
- `npm run finish` locale continua a funzionare con l'identità dell'owner
  (o passa anch'esso dal server, da decidere all'implementazione);
- finché non è implementato, il rischio residuo resta documentato (è la coda
  dell'incidente #378 / spec integrità dei rami).

**Fatto il 2026-08-20** (dettaglio in `ROUTINE-AUTH-SPEC.md` §11). Le due cose
da decidere all'implementazione sono decise così:

- l'identità del server è una **GitHub App** installata sul solo repo pubblico
  (il PAT resta come ripiego): non è l'account di nessuno e il token con cui
  parla dura un'ora;
- **anche il finish locale passa dal server** (`ownerMerge`): niente più
  fusione né push da questa macchina. Non pretende i verdetti registrati — quelli
  sono il vocabolario delle routine — ma **L5 gira lo stesso**, e lo `sha`
  dichiarato deve combaciare con la punta vera del ramo.

La **ruleset su `main`** (passo dell'owner) è stata messa il **2026-08-20**: da
lì il push diretto da una sessione non è più vietato a parole. Riverificato sul
campo il **2026-08-21**: un push da questa macchina con le credenziali
dell'owner viene **respinto** (`push declined due to repository rule
violations`); l'unica identità ammessa è la GitHub App del server.

Il muro sta quindi su GitHub, **non** sulla macchina: le credenziali locali
esistono ancora (servono a spedire i rami di lavoro). Per questo le difese
locali restano, e sono state completate il 2026-08-21 anche sugli **automatismi**
— salvataggio e diagnostico non committano né spediscono un ramo protetto, e
quando si astengono lo dicono. Due motivi, nessuno dei quali è il muro: un
tentativo respinto in silenzio è un guasto invisibile, e una difesa appesa a un
muro solo cade con quel muro.

### Il numero di versione lo scrive il server (2026-08-21, variante)

Con la ruleset attiva, l'ultimo che scriveva su `main` senza passare dal server
era il lavoro di **pubblicazione**: ogni sei ore alzava la patch version e la
pushava. Deciso con l'owner: il numero **resta nel manifesto del repo** — le
note di rilascio per l'utente sono organizzate per versione, e senza quel
numero smetterebbero di raggiungerlo — ma a scriverlo su `main` è il server,
l'unico che può.

- **`releaseBump`** (filo-security, parola d'ordine di scopo `build` come
  `buildKeys`/`buildAlarm`): legge il manifesto vero su `main`, calcola lui il
  numero successivo, e scrive lui un commit che cambia **solo** il campo della
  versione. Dal chiamante non si accetta niente — né il numero, né il
  contenuto, né il ramo: accettarli sarebbe un push diretto travestito.
- **Freno anti-raffica** con lo stato sul server: al massimo un aumento ogni 20
  minuti e 12 al giorno (il cron pubblica ogni sei ore: non intralcia).
- Il lavoro di pubblicazione **chiede** il numero, poi rilegge `main` e
  costruisce. Non fa più nessun `git push`, e una sentinella negli unit test
  diventa rossa se ci torna.

Dettaglio in `ROUTINE-AUTH-SPEC.md` §12.

Collegato (18/08, revisione del ruolo secaudit con l'owner):

- **bonifica dello storico in chiaro su Firestore**: i testi dei feedback
  vecchi (pre-cifratura) e le note di lavorazione storiche sono leggibili da
  chiunque — un attaccante può osservare titoli e note per capire se un suo
  attacco è passato. Cifratura retroattiva o rimozione; valutare quanto della
  superficie pubblica (titoli compresi) si può chiudere. I testi vecchi sono
  "sicuri" (unico utente: l'owner) ma lasciarli lì non è pulito né coerente.
- **la nota di un blocco di sicurezza è cifrata e dettagliata**: su pass una
  riga; su blocco spiegazione esaustiva (cosa, dove, perché, scenario, cosa
  verificare se falso positivo) — e MAI in chiaro: è la descrizione esatta di
  come l'attacco è stato scoperto.

## 11. Suite completa: in GitHub, non dentro il giro

**Dal 2026-09-15 la suite intera (`npm test`) non la lancia nessun ruolo**, e
nemmeno una sessione locale: gira in GitHub, nel lavoro di release, che parte
ogni sei ore — verde, e la patch si pubblica; un rosso nuovo (fuori dai rossi
noti del contenitore), e la patch non esce, il rosso diventa un feedback e si
corregge con calma, saltando un giro. Una regressione è rara: non vale un'ora
d'attesa a ogni consegna.

Dentro il giro: chi scrive codice fa unit test e spec mirati, e le regressioni
incrociate restano responsabilità di chi le introduce. Il verificatore, prima
di lasciar passare, lancia `npm run finish:check` (unit test più gli spec delle
aree toccate) e le prove del giro in `tests/verifica/<numero>/`; per il resto
non rifà i test del worker, fa verifica avversariale, scrivendone di nuovi se
serve. L'orchestratore non lancia controlli (un compito in meno: più cieco e
più scemo, che è la direzione giusta).

## 12. Ritorno dei worker: niente canale di testo

Deciso con l'owner il 18/08 (terza passata): il "contratto della riga finale"
è ABOLITO. Il testo con cui un worker chiude non viene letto da nessuna
macchina — l'orchestratore decide il passo successivo SOLO interrogando il
canale (chiede un biglietto nuovo: exit 0 = spawna, 2 = chiudi, 3 = guasto,
chiudi senza rispawnare) più il controllo del proprio contesto (~70%).

Perché: il testo di ritorno entra comunque nel contesto dell'orchestratore
(non si può impedire), quindi la difesa non è chiedere una riga corta ma
togliere al testo OGNI peso decisionale — un worker catturato non ha più
niente da dire a nessuno. Sparisce anche la violazione cronica del vecchio
contratto (report interi al posto della riga).

Conseguenze da implementare nel cantiere:

- il **guasto si dichiara al canale** (rilascio del claim con motivo), non a
  parole: è così che il server smette di dare lavoro per il giro e
  l'orchestratore lo scopre alla richiesta di biglietto;
- **ritentativi automatici dentro routine-channel** (pochi, con attesa breve)
  prima di uscire con 3: quando esce 3 il canale è giù davvero, e la regola
  per le istanze resta secca "fermati". (Idea dell'owner: meglio ritentare —
  ma nel codice deterministico, mai nel prompt.)

Corollario (osservazione dell'owner): **i ruoli `idle` e `off` sono ABOLITI.**
Esistevano perché lo smistamento girava dentro un worker già spawnato, che
aveva bisogno di istruzioni anche per il caso "non fare niente". Ora coda
vuota e interruttore spento sono un **exit 2 alla richiesta di biglietto**
(o al preflight): l'orchestratore chiude senza spawnare nessuno. La logica
"prober sì/no a coda vuota" si sposta nel server, che a coda vuota dà un
biglietto da prober oppure exit 2 secondo l'impostazione della dashboard.

Secondo corollario, da confermare a canale maturo: muore anche il **ripiego
sulla coda git** per la scelta del lavoro (exit 3 = chiudi, nessun cammino
alternativo). A quel punto l'intera coda su git si può ritirare.

Terzo (quarta passata, 18/08): **new-work e fixer FUSI in un ruolo unico,
`resolver`** — stesso lavoro, cambia solo il punto di partenza (richiesta
dell'owner vs critica del verifier), e dispatch dice il caso nel payload.
Anche le correzioni grosse possono usare sotto-agenti (sequenziali). Regole
collegate:

- il resolver in correzione NON vede il report del primo passaggio (occhi
  freschi, e comunque è cifrato); vede la riga di changelog nel codice; frase
  e changelog si aggiornano SOLO se il comportamento visibile è cambiato
  (ritocco: `--frase` opzionale nella consegna della correzione);
- **i numeri configurabili dalla dashboard non si scrivono MAI nei prompt**
  (la soglia dei FAIL — oggi 5 — la legge il server dalla config; i documenti
  che dicevano "3" erano già stantii: è la prova del principio);
- i file-ruolo non ripetono il metodo di CLAUDE.md: contengono solo ciò che è
  specifico del ruolo. E **non spiegano ciò che non compete al ruolo** ("cosa
  succede dopo non ti riguarda", soglie altrui, meccaniche a valle):
  informazione inutile è superficie in più.

## 13. La verifica: critica a livelli, esito del server

I tre esiti scelti dal verificatore (pass / migliorabile / fail) non esistono
più dal 2026-09-05 (feedback #561). Il racconto di quella decisione sta nella
storia di git di questo file; qui c'è lo stato vero, in breve, e dove sta il
resto.

- **Chi verifica scrive una critica, non un verdetto.** Una riga per rilievo,
  col livello davanti (3/2/1/0; `?` = chiede una decisione dell'owner). Il
  metro dei livelli sta nel testo del ruolo
  (`routines/roles/_critica-e-livelli.md`), uno per tutti gli ambiti.
- **L'esito lo calcola il server** dai livelli e da tre bilanci per lavoro
  (`cap2` per i livelli 3/2, `cap1`, `cap0`): `pass`, `fix` o `stop`. Le regole
  stanno in `src/shared/verifierRound.js`, che il server incorpora al deploy; i
  numeri li scrive l'owner in Gestione → Automazioni e non hanno un default nel
  codice. Un'istanza catturata non può promuoversi da sola: i conti non li fa
  lei.
- **Fase 2.** Con esito `fix` corregge lo stesso agente che ha scritto la
  critica, sui soli rilievi che il server gli rimanda, e consegna con
  `--record-fixed`. Se correggere non si può senza una decisione, consegna con
  `--ferma` e una segnalazione: il lavoro aspetta l'owner. Ogni correzione
  porta a un'altra verifica, fatta da un'altra istanza.
- **I rilievi non corretti non spariscono**: il server li raccoglie in un
  feedback derivato per lavoro, figlio `#N.k`, categoria `routine:residuo`. Il
  verificatore non apre feedback.
- **Ambiti.** La verifica è piena di serie. Due giri stretti la sostituiscono
  quando la ricerca larga è già stata fatta: `chiusura` (dopo una correzione,
  se l'owner ha acceso «Giro stretto dopo una correzione») e `riallineamento`
  (dopo un conflitto di fusione risolto a mano su un lavoro già verificato).
  Cambia il perimetro, non il metro; un difetto fuori perimetro vale al massimo
  livello 1, salvo danno concreto all'utente. L'ambito lo decide il server e
  viaggia nel payload.
- **Un solo modello per la verifica**, quello forte: nel laboratorio (§9) i
  modelli economici non hanno prodotto un rilievo di completezza in 15 corse.

Stati e transizioni del giro: `FEEDBACK-STATES.md`. Cosa viaggia fra server e
ruoli (`scope`, `perimetro`, `stop`, la risposta alla critica):
`ROUTINE-AUTH-SPEC.md` §6 e «I livelli sul feedback».

## 14. Ordine di esecuzione

1. La sessione in corso sui feedback (#477.x) finisce. Fino ad allora: solo
   bozze fuori dal repo (questa cartella) e lavoro nel verifier-lab.
2. Trasloco documenti (unica modifica, contro lo stato del repo a quel punto).
3. Smontaggio sotto-feedback (prima drenare i .x ancora in volo), riallineo
   delle due copie della macchina a stati + rideploy.
4. Pacemaker + ruolo orchestratore + prompt salvato nuovo della routine.
5. Merge sul server + protezione di `main` (chiusura del buco §10 — priorità
   alta: è l'unico punto di sicurezza vero dell'elenco).
6. Esperimenti sul verificatore nel lab (possono partire anche subito).
7. Revisione dei prompt dei ruoli (l'owner li legge per la prima volta) con
   gli esiti del lab.
8. Critica a livelli ed esito calcolato dal server (§13): fatto.
