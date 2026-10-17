# Domande all'owner, fiducia e lavoro che si organizza da solo

Specifica decisa con l'owner l'08–09/10/2026; compiti e urgenze (§ 6) il 12/10;
gestione del lavoro (§ 4.3–4.8) il 13/10.
È il riferimento per i feedback che la realizzano: chi ne lavora uno legge la
sezione che gli tocca, non tutto il file.

## 0. Perché

I limiti del piano non sono più il collo di bottiglia. Lo sono due cose:

- **L'attenzione dell'owner.** Ogni lavoro produce un report con decine di
  domande, ogni domanda vive in un posto diverso (chat, pagine HTML, Ricevuti,
  note), le risposte si copiano a mano, e da ogni report nascono altre
  conversazioni. Ogni salto fra un posto e l'altro è una distrazione.
- **Il portatile dell'owner.** Si spegne quando lo sposta e rallenta con dieci
  sessioni che fanno prove. Una sessione persa butta crediti in avvii a freddo.

La soluzione è invertire i ruoli. Gli agenti organizzano e fanno il lavoro;
l'owner dà il giudizio, da **un posto solo** dentro Filo, quando può.

Principio cardine: la **bitter lesson**. Un agente generico capace, con buone
prove e permessi imposti dal server, al posto di meccanismi scritti a mano per
ogni caso.

Regole che valgono per tutta la specifica:

1. **Nessun agente accetta un blocco di sicurezza**, di nessun livello. Lo decide
   l'owner, oppure la fiducia calcolata dal server (§ 1.5): mai il giudizio di
   un agente.
2. **Meno domande, raggruppate.** Una domanda che una decisione già presa
   risolve non arriva all'owner (§ 3.6).
3. **Niente scadenze automatiche.** Una domanda senza risposta resta aperta.
   Conta la priorità.
4. **Permessi minimi.** Ogni ruolo ha solo le operazioni che il suo compito
   richiede (§ 5).
5. **Quello che l'owner approva lo deve poter vedere senza fidarsi di un
   agente**: l'azione di un pulsante si legge dai dati, non dal testo di chi
   chiede (§ 3.3); un blocco di sicurezza si approva leggendo il testo
   originale, non un riassunto (§ 2.2).

## 1. Fiducia

### 1.1 Due livelli soli

Feedback, domande, compiti e biglietti hanno un campo `fiducia`: `fidato` o
`non_fidato`. Lo calcola e lo scrive **solo il server**.

È **fidato** solo ciò che nasce da:

- **l'owner**: un feedback scritto da lui, una sua risposta;
- **un'approvazione dell'owner**: un feedback che l'owner segna come fidato
  dopo aver letto il testo originale (in Ricevuti, § 2.2);
- **un biglietto pulito** (§ 1.2);
- **il server**: allarmi, istanze dei compiti ricorrenti scritti dall'owner.

Tutto il resto è **non fidato**: i feedback degli utenti, quelli che Filo apre
per conto di un utente, e ogni cosa scritta da un biglietto sporco.

Il mittente (`clientId`) resta, ma serve **solo alle statistiche** (§ 10). Non dà
più nessun permesso.

### 1.2 Biglietti che si sporcano

Ogni sessione che lavora, in cloud o in locale, ha un **biglietto** del server.
Il biglietto nasce pulito o sporco (pulito se il lavoro da cui nasce è
fidato) e **si sporca** appena il server gli consegna qualcosa di non fidato:

- il testo di un feedback, una domanda o una conversazione non fidati (il
  server li decifra: sa cosa consegna);
- la posta;
- registri che possono citare testo di utenti;
- un ramo scritto da un biglietto sporco.

Uno sporco non torna pulito. Quello che un biglietto scrive prende la fiducia
che il biglietto ha **in quel momento**.

Quello che non passa dal server (pagine web, file fuori dal repo) il server non
lo vede:

- **in cloud:** gli ambienti dei lavori fidati hanno la rete limitata al
  repo e ai pacchetti;
- **in locale:** un gancio sporca il biglietto dopo ogni strumento, tranne un
  elenco chiuso di quelli che non portano dentro niente da fuori (la shell, le
  ricerche nel disco, le scritture, i sotto-agenti locali, i compiti); uno
  strumento nuovo sporca finché qualcuno non lo mette nell'elenco. Un file
  letto sporca solo fuori dal repo. Uno strumento che apre un canale da cui il
  testo arriva dopo, senza passare da uno strumento (un sotto-agente che gira
  nel cloud, un artefatto pubblicato che riceve commenti), sporca quando parte.
  Il gancio non conta sulla sessione, che un testo malevolo può ingannare;
  col server giù lo sporco resta annotato accanto al biglietto, che intanto
  vale sporco, e parte alla prossima occasione. Il resto (un comando di shell
  che scarica qualcosa) lo dichiara la sessione (`biglietto.mjs sporca
  "motivo"`), e gli strumenti che stampano testo esterno lo fanno da soli. È un
  limite accettato: in locale c'è l'owner.

Le sessioni locali prendono il biglietto all'avvio (hook), come le routine.

### 1.3 Unire senza sporcare: la delega

Chi riordina la coda legge testo di utenti, quindi è sporco. Se scrivesse lui il
feedback unito, il risultato sarebbe non fidato anche quando i genitori sono
tutti fidati. Quindi non lo scrive: chiede al server un **biglietto di
unione**, che porta solo dati strutturati, cioè il ruolo `unisci` e i numeri
dei feedback, senza testo. Il biglietto di unione:

- nasce pulito;
- legge i genitori dal server, e si sporca se uno di loro è non fidato;
- scrive il feedback unito con `genitori`.

Il figlio è fidato se e solo se lo sono tutti i genitori. Lo stesso schema vale
ogni volta che un agente sporco deve far nascere qualcosa che può restare
fidato: passa numeri e ruoli, mai testo.

### 1.4 Le parole dell'owner

Una risposta dell'owner è un **turno a sé**, scritto col suo token e
riconoscibile dal server. Questo non pulisce niente. Un agente che legge la
risposta insieme a una domanda non fidata resta sporco, e quello che scrive
nasce non fidato.

Serve a una cosa sola: chi legge sa quali parole sono certamente dell'owner. Le
azioni che chiedono il suo consenso (approvare, segnare fidato) le applica il
server solo da un turno dell'owner, mai da un testo che dice «l'owner ha
detto».

### 1.5 La fiducia decide L5

- **Lavoro fidato:** tutti i biglietti che hanno scritto sul ramo (primo
  lavoro, correzioni, riallineamenti) sono rimasti puliti, e il feedback è
  fidato. In questo caso **L5 non si applica**: il blocco si registra in
  Automazioni, non ferma. L'owner non legge il codice e non saprebbe
  distinguere un blocco giusto da uno sbagliato meglio della catena pulita.
- **Lavoro non fidato:** L5 si applica come oggi. L'owner approva in Ricevuti,
  leggendo il testo originale dell'utente (§ 2.2), e può chiedere un parere a
  una sessione.

Sparisce `mergePreapproved` («fondi senza chiedermelo»). Il suo posto lo
prende «segna fidato», che vale prima del lavoro, non a lavoro fatto.

La verifica cieca (secaudit) resta su tutto: costa poco, e un buco di sicurezza
lo può scrivere anche un agente pulito.

### 1.6 Cos'altro cambia con la fiducia

- **Lavori server.** Un lavoro che tocca filo-security, le regole del database o
  i segreti dev'essere fidato (§ 7). Se un feedback non fidato ne ha bisogno,
  il worker si ferma e il feedback va in Ricevuti come «chiede di diventare
  fidato».
- **Giudici alla nascita (L2):** restano per i soli non fidati.
- **Ordine della coda:** fiducia e figli sono gradini dell'urgenza dentro la
  casella di priorità e fase (§ 6.3): prima i fidati, poi i principali prima
  dei figli, poi l'età. Finché i compiti (§ 13, punto 5) non ci sono, lo
  stesso ordine fa da spareggio provvisorio a pari priorità, al posto di
  `senderClass` in `selectTodoWinner` (filo-security
  `functions/src/routine/select.js`); fino ad allora non si tocca nemmeno la
  precedenza assoluta dei rami in revisione (`REVIEW_RANK`). Con i compiti
  spariscono tutti e due: un feedback iniziato passa davanti a uno nuovo solo
  con un gradino di priorità in più, e la priorità 3 passa sopra tutto.

### 1.7 Dati

- `fiducia` su feedback, domande, compiti e biglietti. La scrive solo l'Admin
  SDK; le regole la vietano ai client.
- `genitori: [id…]` sul feedback derivato.
- `scrittoDa: [{biglietto, fiducia}]` sul ramo di lavoro, per il § 1.5.
- **Migrazione:** fidati i feedback con mittente provato (`senderProof` admin o
  server, prefisso owner/local) e quelli con `mergePreapproved`; tutti gli
  altri non fidati, `routine:residuo` compreso. I rami già in lavorazione
  restano sotto L5 finché non si chiudono.

## 2. Gestione: un posto solo per tutto Filo

### 2.1 Sezioni

La pagina Gestione (`src/pages/manage/`) passa da una barra piatta di 10 schede a
una **barra di sezioni**, ciascuna con le sue schede:

| Sezione | Schede | Quando |
|---|---|---|
| **Domande** | Da rispondere · In lavorazione · Risposte automatiche · Archivio | adesso |
| **Feedback** | Ricevuti · In coda · Lavori server · Risolti · Archiviati · Statistiche · Red Team | adesso (spostate) |
| **Routine** | Automazioni · Crediti · Monitoraggio · Log · Compiti · Compiti ricorrenti | adesso (spostate più le nuove) |
| **Impostazioni predefinite** | Modelli di supporto, poi tutte le impostazioni predefinite di Filo | ora solo lo spostamento |
| **Statistiche d'uso** | — | lavoro a parte |

- Si apre su Domande se c'è una domanda bloccante, su Ricevuti se c'è un blocco
  di sicurezza, altrimenti sull'ultima sezione usata.
- Ogni sezione ha un contatore.
- Le schede esistenti si spostano senza essere rifatte.

### 2.2 Ricevuti: solo i blocchi di sicurezza

In Ricevuti stanno **solo i giudizi di sicurezza**, non quelli di prodotto. Lì
l'owner deve leggere il **testo originale** dell'utente, non il riassunto di un
agente che potrebbe essere stato ingannato. Ci finiscono, per livello:

- **L1–L2:** i nuovi non ancora giudicati, i sospetti, gli attacchi, lo spam;
- **L3:** un worker che giudica il feedback un attacco o spam, o che chiede di
  renderlo fidato perché il lavoro ha bisogno del server;
- **L4:** i blocchi della verifica cieca (secaudit);
- **L5:** i blocchi di fusione dei lavori non fidati.

Le decisioni di prodotto di L3 («decisione da prendere») **non** vanno in
Ricevuti: stanno solo in Domande. Il feedback resta nella coda, con un segno
che dice che aspetta una domanda (§ 3.8).

In testa alla colonna, cinque pulsanti **L1 L2 L3 L4 L5**:

- premuto uno, si vedono solo i feedback fermi a quel livello;
- se ne premono più insieme, si vedono quelli fermi a uno qualunque dei livelli;
- tutti spenti, si vede tutto.

Ogni pulsante porta il suo conteggio.

Se oggi un worker non può segnare un feedback come attacco o spam (solo
`clarify`, `decisione`, `locale`), si aggiunge: è lo stesso giudizio dei
giudici, dato da chi ha letto il feedback da vicino.

## 3. Domande

### 3.1 Cos'è una domanda

Un documento a sé (collezione `domande`), cifrato come i feedback, leggibile
dall'owner e dal server. Campi:

- `titolo`: una riga.
- `contesto`: quanto basta per decidere senza aprire altro.
- `problema`: cosa succede in pratica. Per un buco, cosa fa un attaccante; per
  una funzione, cosa vede l'utente.
- `opzioni`: per ciascuna testo, pro, contro e `azione` strutturata (§ 3.3).
  Vuote in un resoconto senza niente da decidere (§ 4.8): l'owner lo chiude
  con «letto».
- `consiglio`: l'opzione che sceglierebbe chi chiede, e perché.
- `priorita`: `bloccante`, `importante`, `quando_puoi`.
- `origine` e `collegamenti`: feedback, rami, compiti, altre domande.
- `notePerAgenti`: testo privato per chi riprenderà la domanda (§ 3.2).
- `gruppo`: il tema, per il raggruppamento.
- `fiducia`: § 1.
- `stato`: `aperta`, `in_lavorazione`, `chiusa`, `superata`.
- `conversazione`: i turni, con autore (owner o biglietto) e ora.
- `creataIl` e `modificataIl`: la seconda è l'ultima volta che un agente ha
  aggiunto un turno o cambiato qualcosa.

Il formato per l'owner è quello del report delle 102 domande: contesto,
problema in pratica, opzioni con pro e contro, scelta consigliata. Nessun nome
di file o di funzione nel testo per l'owner. Prima di scriverla si applica
`.claude/skills/unslop/SKILL.md`.

### 3.2 Note per gli agenti

Chi chiede ha di solito già esplorato:

- i punti del codice;
- le cause;
- le strade scartate;
- cosa serve per applicare ciascuna opzione.

Lo scrive in `notePerAgenti`. Nella pagina sono **chiuse** in fondo alla
domanda: l'owner le apre solo se vuole. Chi riprende la domanda le legge e non
riesplora da capo.

Stanno nel documento della domanda, sul server: non in un feedback (una domanda
non è sempre una cosa da fare) e non nel repo pubblico. Se il lavoro esiste già,
la domanda ha un feedback o un ramo nei `collegamenti`, e le note puntano lì.

### 3.3 Azioni strutturate

Ogni opzione ha un'`azione` fatta di **dati**: un tipo fra quelli ammessi più i
suoi parametri. Il pulsante mostra un'etichetta generata dalla pagina a partire
dall'azione («Priorità di #813: 1 → 3», «Archivia #902», «Riprendi #1073 con
questa scelta»), non il testo scritto dall'agente. Un agente sporco può mentire
nel testo dell'opzione, ma non sull'effetto del pulsante.

Tipi ammessi:

- `riprendi` (il feedback torna `todo` e la decisione arriva al worker in
  `payload.decisioni`, come oggi);
- `priorita`;
- `archivia`;
- `approva_locale`;
- `automazione` (accendi o spegni una voce);
- `ambito` (approva un ambito nuovo, § 5.3);
- `esperimento` (approva un esperimento del monitoraggio oltre il suo budget,
  § 4.8);
- `cancella_rami` (cancella i rami elencati nell'azione, § 4.7);
- `invia_mail` (il server manda la mail: destinatario, oggetto, testo, e i
  solleciti con il loro testo e dopo quanti giorni lavorativi. Un sollecito
  parte solo se nella stessa conversazione non è arrivata risposta. L'owner
  può correggere il testo prima di approvare, e il testo corretto è suo);
- `compito` (l'opzione richiede lavoro: nasce il compito della § 3.5).

Le azioni di sicurezza non stanno qui: si fanno in Ricevuti (§ 2.2).

### 3.4 Rispondere

1. **Scegliere un'opzione.** Il server applica l'azione, senza agenti. Se è
   `compito`, nasce il compito della § 3.5.
2. **Scrivere.** Nasce sempre il compito della § 3.5.
3. **Applicare il consiglio**, su una domanda sola o su tutte quelle
   selezionate.
4. **Discuterne.** Il pulsante copia una riga sola («Discutiamo la domanda
   D-123») da incollare in una sessione locale. La sessione legge la domanda con
   `domanda.mjs mostra` e risponde con `domanda.mjs rispondi`.
5. **Letto**, su un resoconto senza opzioni (§ 3.1): la domanda si chiude,
   senza agenti.

### 3.5 Il compito «Gestisci la risposta»

- Un compito senza feedback (§ 6), urgenza 47: passa davanti a tutto tranne i
  feedback a priorità 3.
- Lo lavora **Opus col repo**: una decisione capita male costa più di qualunque
  risparmio sul modello.
- Il biglietto nasce con la fiducia della domanda (§ 1.2).
- Legge la domanda con conversazione e note, i collegamenti e il registro
  delle decisioni, e poi fa una o più di queste cose:
  - apre o aggiorna feedback;
  - riprende il feedback d'origine;
  - scrive un **chiarimento**: aggiunge un turno, e la domanda torna `aperta`
    come mini-conversazione;
  - apre una domanda nuova;
  - scrive il principio (§ 3.6);
  - aggiorna `notePerAgenti`.

### 3.6 Registro, raggruppamento, risposte automatiche

- **Principio.** Ogni domanda chiusa porta, quando c'è, la regola generale che
  la risposta stabilisce («zero fiducia nei crediti dichiarati dal client»).
- **Il registro** sono le domande chiuse col loro principio, interrogabili con
  `domanda.mjs`. Nessun file a parte.
- **Prima di chiedere**, un agente cerca nel registro. Se un principio risponde,
  lo applica e lo cita.
- **Revisione quotidiana** (§ 4). Il compito:
  - raggruppa le domande aperte;
  - assorbe in una domanda sola quelle che sono casi dello stesso problema e
    propone il ripensamento del sistema (le assorbite diventano `superata`);
  - rivede le priorità;
  - risponde coi principi. Queste risposte vanno nella scheda «Risposte
    automatiche», e l'owner può riaprirle: una riapertura corregge anche il
    principio.

### 3.7 Ordine

Prima `bloccante`, poi `importante`, poi `quando_puoi`. Dentro ciascuna, per
gruppo e poi per età. Un gruppo si apre come un blocco solo.

### 3.8 Cosa diventa domanda fra le attese di oggi

| Oggi | Dove va |
|---|---|
| `design` + `clarify`/`decisione`, segnalazione L3 | domanda, azione `riprendi` |
| `design` + `locale` | domanda «lavoro server?» se il feedback è fidato; Ricevuti («rendere fidato») se non lo è |
| `design` + `guasto` | la domanda c'è già: la apre chi cade sul guasto, col gruppo `guasto: <la cosa rotta>` e il numero nella nota (#1241) |
| `attesa_chiusa`, `loop`, `arenato` | domanda, azioni `riprendi` / `archivia` |
| `design` + `secaudit`, `l5`; attacchi, spam, sospetti | Ricevuti |

Il feedback in attesa resta `design` col suo motivo e prende `domandaId`: la
macchina a stati non cambia. Per l'owner, però, un `design` con una domanda
aperta si vede nella scheda **In coda**, col segno «aspetta una domanda» che
porta alla domanda, e non in Ricevuti.

## 4. Compiti ricorrenti, pubblicazione, gestione del lavoro

### 4.1 Compiti ricorrenti

Un compito ricorrente lo scrive l'owner (quindi è fidato): un testo di
istruzioni, una cadenza, un ambito, un'urgenza, un modello e uno sforzo.
All'ora giusta il server ne crea un'istanza: un compito fidato (§ 6) con
`nonPrimaDi`. L'orchestratore lo prende come ogni altro lavoro. Un'istanza non
ancora iniziata quando nasce la successiva si chiude come «superata»: le
istanze non si accumulano.

Un ruolo generico `compito` esegue il testo del ricorrente. I permessi li dà
l'ambito, non il ruolo. I testi dei ricorrenti stanno nel repo privato del
server (§ 9), non in questa spec.

Ogni istanza chiude con un rapporto (§ 4.3), che resta legato al ricorrente:
l'istanza successiva lo riceve col biglietto, con la fiducia che aveva. È così
che l'audit sa da quale commit ripartire e la potatura quanti rami sono nuovi.
Un ricorrente che segue cose lunghe settimane ha anche un **taccuino** suo sul
server, come il monitoraggio (§ 4.3): oggi le opportunità, con le loro
pratiche.

| Quando (ora italiana) | Compito | Ambito | Urgenza | Modello iniziale |
|---|---|---|---|---|
| ogni giorno | revisione delle domande (§ 3.6) | `domande` | 30 | Opus |
| ogni giorno | opportunità e posta: incentivi, crediti, programmi; la casella di Filo | `posta` | 30 | Opus |
| ogni giorno | monitoraggio (§ 4.3) | `monitor` | 45 | Opus |
| lunedì | riordino della coda (§ 6.6) | `coda` | 45 | Opus; Haiku da provare (rischia i 100k token) |
| lunedì | potatura dei rami (§ 4.7) | `rami` | 5 | Opus; Haiku da provare |
| domenica | audit di sicurezza | `audit` | 45 | Opus |

Si vedono e si cambiano in Routine → Compiti ricorrenti. Monitoraggio, riordino
e potatura sono la **gestione del lavoro** (§ 4.3): il monitoraggio può
lanciare gli altri due anche fuori cadenza.

### 4.2 Due canali di aggiornamento

- **Veloce** (com'è oggi): una versione ogni sei ore, il commit più nuovo con la
  suite verde.
- **Stabile** (nuovo): una versione minor il lunedì alle 00:00. Esce solo se non
  c'è nessun feedback di sicurezza a priorità 3 aperto. La domenica l'audit li
  cerca; le routine hanno 24 ore per chiuderli. Se ne resta uno aperto, quella
  settimana la minor non esce: nessuna domanda, lo dice il monitoraggio.

L'utente sceglie il canale nelle impostazioni. Il canale stabile è per chi
preferisce un'esperienza più ferma, con le verifiche fatte poco prima.

### 4.3 Gestione del lavoro

Tre compiti gestiscono il lavoro delle routine: il **monitoraggio**, che
decide, e il **riordino della coda** (§ 6.6) e la **potatura dei rami**
(§ 4.7), che lavorano per lui. Lo scopo è uno: fondere più lavoro utile
possibile per ogni credito speso, a cominciare dal più urgente. Decisioni
dell'owner del 13/10.

Il monitoraggio legge i registri: costi e giri delle routine, fusioni e tempi,
accensioni a vuoto, sessioni, suite, rilasci, esecuzioni in cloud, e **tutte le
domande passate** con le risposte.

- **Il suo contesto è sempre non fidato:** legge testo scritto da chiunque.
  Quindi non scrive codice e non cambia feedback. Apre feedback e domande, e i
  suoi feedback che toccano L5 li approva l'owner (§ 1.5).
- **Lancia riordino e potatura per numeri.** Chiede al server di anticipare
  l'istanza di un ricorrente, al massimo con dei numeri di feedback, mai testo.
  Come per l'unione (§ 1.3), l'istanza nasce fidata e lavora col suo ambito.
- **Riordino e potatura gli fanno rapporto:** a fine istanza scrivono nel suo
  taccuino cosa hanno fatto e cosa hanno trovato.
- **Le sue leve:** ritmo e parallelismo (§ 4.5), quando lanciare riordino e
  potatura, indagini ed esperimenti (§ 4.6), la domanda di fine turno dei ruoli
  (§ 5.4), lo spegnimento in emergenza.
- **Non sono sue leve:** la priorità dei feedback, i criteri di verifica, i
  prompt dei ruoli, i blocchi di sicurezza. Può proporre di cambiarli con una
  domanda. Così non può migliorare i suoi indicatori verificando di meno o
  gonfiando le priorità.
- **Spegne in emergenza** routine o account, e riaccende solo quello che ha
  spento lui, mai quello che ha spento l'owner.
- **Taccuino**, persistente sul server: appunti da ricontrollare, ipotesi,
  modifiche in studio, i rapporti di riordino e potatura. Lo legge a ogni
  accensione.
- **Una sessione al giorno**, che riparte dal taccuino, non un contesto che vive
  per sempre. Le indagini lunghe le fanno sotto-agenti, e il suo contesto resta
  piccolo.
- **Segue un problema da vicino:**
  - resta accesa quanto serve e si risveglia da sola ogni 55 minuti al
    massimo, così la cache (60 minuti) resta calda;
  - per attese più lunghe chiede al server una **sveglia**, che il pacemaker
    rispetta con un tetto suo, separato da quello del lavoro.
- **Chi controlla lui:** se il server non lo vede scrivere nel taccuino da 26
  ore, apre una domanda.

### 4.4 Cosa minimizzare

Il monitoraggio non ha un numero da massimizzare: qualunque conteggio si
gonfia, spezzando un lavoro in tre, aprendo ogni ritrovamento a parte o alzando
le priorità. Ha indicatori da tenere bassi, e li usa come indizi, non come
regole.

- **Lavoro a vuoto:** spesa che non finisce in una fusione al primo colpo.
  - accensioni a vuoto e compiti morti;
  - giri di verifica oltre il primo;
  - riallineamenti con main;
  - lavori archiviati dopo averci speso.
- **Contesto inutile:** token letti che al compito non servivano. File interi
  al posto di un pezzo, uscite non filtrate, istruzioni che il ruolo non usa,
  rapporti di sotto-agenti incollati interi. Si giudica caso per caso, leggendo
  le sessioni.
- **Cache freddata:** contesto scritto in cache e non riletto prima che scada.
  Pause più lunghe della durata della cache dentro una sessione, sessioni che
  muoiono subito dopo una scrittura grossa, cambi di modello a metà sessione.

**Vincoli**, che non devono peggiorare: regressioni dopo una fusione, suite
rossa nuova, feedback riaperti.

**Andamento**, da leggere e non da inseguire: le **radici chiuse**. Una radice
è una segnalazione nata fuori dalle routine: dell'owner, di un utente, di una
sessione locale. Figli e derivati non contano come risultato, e il loro costo
si somma a quello della radice da cui vengono. Un'unione di tre radici ne
chiude tre. I feedback che le routine aprono da sole (audit, esplorazione,
monitoraggio) contano solo come spesa. Il costo per radice dipende anche da
cosa c'è in coda, quindi da solo non dice se il processo è migliorato: lo
dicono gli esperimenti (§ 4.6).

### 4.5 Ritmo e parallelismo

- Il monitoraggio scrive una **curva**: quanti lavori insieme (N, § 12.2) in
  base alla quota usata e alle ore che mancano al rinnovo di ciascun account.
  Il server la applica a ogni battito del pacemaker (10 minuti). Il
  monitoraggio non è sempre acceso, e a pieno ritmo la quota sale di circa
  1,4% l'ora (26/09: 662 $ in 21,5 ore).
- **Niente tetto.** Bruciare una settimana costa solo un po' di efficienza, in
  riallineamenti: il lavoro resta fatto. Il parallelismo giusto è quello che
  fonde di più, non quello che spende di più. Oltre un certo N i conflitti con
  main crescono, e il monitoraggio lo misura.
- **Inizio settimana più pieno:** spendere presto sfrutta un rinnovo
  anticipato, se arriva.
- **Fine quota senza compiti morti.** Vicino al limite la curva scende, per
  esempio 4 lavori fino al 95% e poi 1. Il server dà biglietti solo ai compiti
  il cui costo tipico, per fase e ruolo, sta nella quota rimasta. Abbassare N
  non ferma i lavori in corso (§ 12.2).
- Resta la **riserva dell'owner** su A (§ 8.2). Non è un tetto al
  parallelismo: è la quota per le sessioni locali.
- **Senza curva**, perché il monitoraggio non è mai partito o la curva è
  scaduta, vale il passo del § 8.2.

### 4.6 Indagini ed esperimenti

- **Indagini.** Quando un indicatore va male, il monitoraggio scende nel caso:
  un feedback con molti giri di verifica (per esempio 4 o più), una sessione
  con molto contesto inutile, una fila di compiti morti. Un sotto-agente legge
  i motivi (rilievi dei giri, registro della sessione), e l'ipotesi va nel
  taccuino.
- **Esperimenti.** Un'ipotesi si prova rifacendo un lavoro già fatto con una
  cosa cambiata: prompt del ruolo, modello, sforzo, contesto. Un esperimento è
  un compito con ambito `esperimento`:
  - parte da un commit fissato, lo stato di allora, col numero del feedback;
  - porta il testo alternativo scritto dal monitoraggio, quindi non fidato;
  - non fonde, non apre feedback né domande, spinge solo su rami
    `esperimento/*`;
  - non vede il `main` di oggi: in una copia del repo il ref `main` è quello
    attuale, e un esperimento che lo legge falsa il confronto (lab di Haiku,
    12/10);
  - l'esito lo confronta con l'originale un giudice cieco.

  Ha meno permessi di un primo lavoro, per questo lo decide il monitoraggio da
  solo, dentro il budget (§ 4.8).
- **Proposte.** Se un esperimento conferma l'ipotesi, il monitoraggio apre una
  domanda con la modifica (a un prompt, ai criteri, a una regola) e le prove.
  La approva l'owner, perché tocca tutti i lavori futuri. Gli sprechi che si
  correggono nel codice diventano feedback.

### 4.7 Potatura dei rami

- **La cancellazione è meccanica.** La fa il server il lunedì, per regola: un
  ramo fuso in `main` che nessun feedback aperto nomina. L'agente non allunga
  l'elenco.
- **L'agente capisce perché i rami sono lì.** Prima della cancellazione legge
  i candidati e gli altri rami fermi (non fusi, o di feedback chiusi senza
  fusione) e li raggruppa per causa, non uno per uno: il 07/10 erano 617. Per
  ogni causa:
  - un problema del processo (per esempio nessuno cancella il ramo dopo la
    fusione) → un feedback;
  - lavoro non fuso che forse serve → una domanda, con azioni `riprendi` o
    `cancella_rami`.
- Il rapporto va al monitoraggio (§ 4.3).

### 4.8 Budget e rapporto settimanale

- **Budget:** 200 € a settimana per tutta la manutenzione del processo:
  sessioni del monitoraggio, indagini, esperimenti, e le pulizie della coda e
  dei rami (riordino e potatura, anche quelle del lunedì). È circa
  il 10% della settimana di un account (§ 8.1). Il monitoraggio lo divide come
  crede; sforare di poco va bene. Si conta come nei rapporti delle routine.
- **Oltre il budget** chiede con una domanda, azione `esperimento`.
- **Rapporto settimanale:** una domanda, anche senza opzioni se non c'è niente
  da decidere. Contiene:
  - cosa ha fatto: curve, indagini, esperimenti, feedback e domande aperti;
  - l'andamento degli indicatori (§ 4.4) rispetto alle settimane prima;
  - una **stima del risparmio** e quanto è costato lui, per decidere se il
    ruolo serve ancora e con che budget. È una stima con l'incertezza
    dichiarata: dagli esperimenti quando ci sono, altrimenti dal prima e dopo
    di ogni modifica.
- **In mezzo alla settimana** le domande arrivano quando servono, come tutte le
  altre.

## 5. Ambiti: i permessi stanno sul server

### 5.1 Regole

Gli agenti in cloud non hanno credenziali del database. Il biglietto porta un
**ambito**: un elenco chiuso di operazioni che il server accetta.

- **Permessi minimi:** l'ambito contiene solo le operazioni del compito.
- **La triade.** Un ambito non mette mai insieme tutte e tre queste cose:
  - leggere testo non fidato;
  - vedere segreti o dati privati;
  - agire verso l'esterno.
- **Nessun ambito** può approvare blocchi di sicurezza, cambiare la fiducia,
  creare ambiti o toccare le chiavi.
- **I segreti** stanno solo nell'ambiente cloud del compito che li usa. Gli
  ambienti li crea l'owner.
- **La casella di posta** la legge e la scrive solo il server: le credenziali
  non arrivano mai a un agente. Chi legge la posta legge testo non fidato, e
  con la password potrebbe anche spedire. L'agente riceve i messaggi come dati
  e propone bozze; il server manda quelle approvate (azione `invia_mail`,
  § 3.3).

### 5.2 Gli ambiti iniziali

| Ambito | Può | Non può |
|---|---|---|
| `lavoro` | lavorare il suo feedback, spingere il suo ramo, chiedere la fusione, aprire feedback e domande | tutto il resto |
| `coda` | leggere i feedback **in coda** (non quelli in Ricevuti né quelli fermi per attacco), cambiare priorità, chiedere un biglietto di unione (§ 1.3), archiviare | scrivere testi di feedback, cancellare, toccare Ricevuti |
| `unisci` | leggere i genitori indicati, scrivere il figlio, chiudere i genitori col rimando | leggere altro |
| `domande` | leggere le domande e il registro, raggruppare, cambiare priorità, rispondere coi principi | rispondere senza un principio, cambiare i principi |
| `posta` | ricevere dal server i messaggi della casella di Filo, cercare sul web, tenere il suo taccuino, aprire domande con bozze di mail, aprire feedback dalle mail degli utenti | mandare mail, vedere le credenziali della casella |
| `monitor` | leggere registri, sessioni, domande passate, feedback e rami; il suo taccuino; scrivere la curva del parallelismo (§ 4.5); anticipare riordino e potatura; lanciare esperimenti nel budget; cambiare la domanda di fine turno; spegnere, e riaccendere quello che ha spento lui; chiedere una sveglia; aprire domande e feedback | scrivere codice; cambiare feedback, priorità, criteri di verifica, prompt dei ruoli; riaccendere quello che ha spento l'owner |
| `rami` | leggere rami, storia di git e feedback; aprire feedback e domande; scrivere nel taccuino del monitoraggio | cancellare rami: lo fa la regola del server (§ 4.7) |
| `audit` | leggere il codice di Filo e del server, i metadati dei feedback aperti e i testi che servono; provare il codice nel contenitore; aprire feedback e domande | spingere rami, chiedere fusioni, cambiare feedback |
| `esperimento` | lavorare dal commit indicato, spingere su `esperimento/*`, consegnare l'esito | fondere, aprire feedback o domande, spingere altrove, leggere il `main` di oggi |
| `server` | come `lavoro`, più spingere un ramo su filo-security (§ 7) | — solo per biglietti puliti |

### 5.3 Ambiti nuovi

Un agente che ne ha bisogno apre una domanda con la proposta: le operazioni,
cosa non può, il controllo della triade. L'azione `ambito` la approva, e da lì
vale per tutti i compiti di quel tipo.

### 5.4 Segnalazioni e domanda di fine turno

- **Domanda di fine turno:** si può impostare per **ogni ruolo**, compiti
  compresi, o per tutti insieme, come oggi per le routine. Serve a indagare
  una cosa precisa.
- **Segnalazione libera:** ogni biglietto ha un comando `segnala "testo"` anche
  senza domanda. Serve per un errore avuto, un problema trovato, un permesso
  che mancava. Il server ne fa un **feedback** di tipo `segnalazione`: è una
  cosa da valutare, non serve un oggetto nuovo. La fiducia è quella del
  biglietto, la priorità la decide la revisione. Una richiesta di permessi la
  revisione la trasforma in una proposta d'ambito (§ 5.3).

## 6. Feedback e compiti

Due oggetti, decisi dall'owner il 12/10:

- **Feedback**: una cosa da fare, segnalata da un utente, da un agente o
  dall'owner. Ha una **priorità** da 0 a 3 e, se è un cambio di codice, il suo
  ciclo: ramo, verifica, controllo cieco, fusione. Non porta un modello.
- **Compito**: una chiamata di un agente. Ha **urgenza**, **modello**,
  **sforzo**, **ambito**, fiducia e, se c'è, il feedback a cui è legato con la
  sua **fase**. Il biglietto è un tentativo di eseguire un compito: un compito
  ne può avere più di uno, per esempio dopo un arenamento.

### 6.1 Da dove nascono i compiti

**Dalle fasi di un feedback.** Quale compito serve a un feedback lo dice una
funzione sola e pura, dallo stato del feedback: è la scelta del ruolo che il
server fa già oggi. Le fasi sono primo lavoro, verifica, correzione come ripresa
e controllo cieco. La funzione gira in due momenti:

- a ogni modifica del feedback, con un trigger: copre anche le modifiche che
  l'owner fa da Gestione senza passare dal server;
- ogni 10 minuti nel pacemaker, come rete. Un feedback che ha bisogno di un
  compito e non ce l'ha lo riceve. Un compito aperto il cui feedback è andato
  avanti si chiude come «superato».

Lo stato vero resta sul feedback: il compito lo registra, non decide niente.
Invariante, con sentinella: al massimo un compito aperto per feedback.

**Senza feedback:** le istanze dei ricorrenti (§ 4.1), «Gestisci la risposta»
(§ 3.5), l'unione (§ 1.3), l'esplorazione a coda vuota, e i compiti creati a
mano dall'owner o da una sessione locale.

**Non sono compiti**, perché non chiamano un agente: la fusione (la fa il
server), l'invio di una mail approvata (lo fa il server, § 5.1), il blocco di
sicurezza (diventa una domanda), la segnalazione (diventa un feedback, § 5.4).

### 6.2 Le fasi di un cambio di codice

- **Primo lavoro.**
- **Verifica:** un compito solo, compresa la correzione dei rilievi trovati nel
  giro.
- **Correzione**, solo come ripresa: dopo una risposta dell'owner, o dopo un
  conflitto con main (riallineamento). Da valutare: riprendere da qui anche
  quando l'agente della verifica muore a metà correzione, invece di rifare la
  verifica.
- **Controllo cieco.**

### 6.3 Urgenza

Il server dà il biglietto al compito pronto con l'urgenza più alta; a pari
urgenza, al più vecchio.

**Compiti di un feedback.** Ogni casella va dalla priorità del feedback e dalla
fase:

| Fase | p0 | p1 | p2 | p3 |
|---|---|---|---|---|
| Primo lavoro | 0–3 | 5–8 | 20–23 | 50–53 |
| Verifica | 10–13 | 25–28 | 35–38 | 55–58 |
| Correzione (ripresa) | 10–13 | 25–28 | 35–38 | 55–58 |
| Controllo cieco | 15–18 | 30–33 | 40–43 | 60–63 |

Dentro la casella il gradino lo dà la provenienza, al posto degli spareggi di
oggi: +3 fidato, +2 fidato e figlio di un altro feedback, +1 non fidato, +0 non
fidato e figlio. I nipoti contano come figli.

**Compiti senza feedback:**

| Compito | Urgenza |
|---|---|
| Gestisci la risposta | 47 |
| Monitoraggio, audit di sicurezza, riordino della coda | 45 |
| Revisione delle domande, posta | 30 |
| Unione di feedback | 20 |
| Potatura dei rami | 5 |
| Esplorazione | sotto tutto, solo a coda vuota |

Cosa garantisce la scala:

- **La priorità 3 passa sopra tutto**, in qualunque fase, compresi i cicli già
  avviati degli altri feedback e i ricorrenti. Un agente già partito finisce il
  suo compito: il 3 prende il primo posto libero. Per ora il 3 vale anche per
  il lavoro sul processo (routine, gestione dei feedback, strumenti): finché non
  ci sono utenti conta più della sicurezza.
- **Sotto il 3, un feedback iniziato** passa davanti a uno nuovo con un gradino
  di priorità in più, non con due.
- **Fiducia e figli** non scavalcano mai una casella: fra una casella e l'altra
  c'è sempre almeno un numero libero.

La tabella delle fasi vive sul server come dati e si regola lì; l'urgenza dei
ricorrenti si cambia su ciascuno. Quando cambia la priorità di un feedback, il
trigger ricalcola l'urgenza del suo compito aperto.

### 6.4 Modello e sforzo

- Il compito porta modello (gli alias `opus`, `sonnet`, `haiku`, `fable`, che
  seguono da soli l'ultima versione) e sforzo. Il server li manda col biglietto,
  e il gancio dell'orchestratore li impone al lancio, qualunque cosa abbia
  scritto l'orchestratore.
- **Fasi di un feedback:** modello e sforzo per fase, scelti dall'owner in
  Routine → Automazioni. Oggi: primo lavoro Opus `xhigh`, le altre Opus `high`.
- **Compiti senza feedback:** dal ricorrente o da chi crea il compito. «Gestisci
  la risposta» resta Opus (§ 3.5).
- Ogni agente può lanciare sotto-agenti, fino a tre livelli sotto la sessione
  principale, e sceglierne il modello.

Transizione: dal 12/10 il server manda modello e sforzo col biglietto (#1192)
e li legge da `config/routines.roleModels` (la scelta per fase, scrivibile in
Automazioni con #1193). Il gancio che li impone è #1189. Il server legge anche
`model` ed `effort` sul feedback, per primo lavoro e correzione, ma nessuno li
scrive: con i compiti quella lettura si toglie.

### 6.5 Numerazione e dove si vedono

- I feedback tengono la loro numerazione (#N, #N.k). I compiti ne hanno una
  loro; quelli di un feedback si mostrano come «#N · fase».
- I feedback restano in Gestione → Feedback. I compiti hanno una scheda loro,
  Routine → Compiti: aperti, in corso e storico, con modello, costo ed esito di
  ogni chiamata. L'owner la guarda di rado.

### 6.6 La coda dei feedback

- Unire vuol dire creare un feedback nuovo con `genitori`, per delega (§ 1.3).
- Il riordino del lunedì lavora tutta la coda insieme:
  - unisce i doppioni;
  - archivia gli stantii e i già fatti;
  - rivede le priorità con la scala 3/2/1/0.

  Quelli che aspettano una scelta li segnala alla revisione delle domande. Il
  rapporto va al monitoraggio, che può anche lanciare il riordino fuori
  cadenza (§ 4.3).
- I feedback a bassa priorità che si accumulano sono normali: aspettano i
  crediti (§ 8).
- I lavori `localOnly` di oggi diventano **lavori server**: lavori che hanno
  bisogno di altro oltre al repo pubblico.

## 7. Lavori server dalla cloud

- **Oggi:** l'orchestratore clona solo Filo, e i lavori sul server si fanno in
  locale.
- **Domani:** il biglietto `server` porta con sé un **token GitHub di breve
  durata**. Lo crea il server, da un'applicazione GitHub dedicata («filo-lavori»,
  non il cancello di fusione) installata solo su filo-security, con un solo
  permesso: scrivere i contenuti, su quel repo soltanto.

  Un token di applicazione GitHub dura al massimo un'ora: è un limite di
  GitHub, non una scelta. Per il worker vale **finché il lavoro serve**:
  - ogni git che parla con GitHub passa da un comando fisso del canale
    (`routine-channel.mjs git-server`, #1233), che chiede il token al server e
    lo dà solo a quella chiamata: niente aiutante di credenziali, che il
    controllo dei permessi della sessione cloud blocca. Il token viaggia
    nell'URL riscritto solo per quella chiamata (scelta dell'owner su #1233),
    perché il proxy della sessione sostituisce l'intestazione di
    autorizzazione; se a respingerlo è il proxy e non GitHub, il comando lo
    dice. La prova vera da una sessione cloud la fa il primo lavoro server
    dopo la fusione (#1221);
  - il worker non se ne accorge;
  - alla chiusura del biglietto il server revoca il token in corso.

  Rispetto a un token da 24 ore, così un biglietto che si sporca perde l'accesso
  entro l'ora, e uno chiuso subito.

  Il server lo dà solo a un biglietto pulito su un feedback fidato, e non lo
  rinnova a un biglietto che si è sporcato. Il worker clona filo-security con
  quel token e spinge il suo ramo.
- **Su `main` di filo-security** scrive solo il cancello di fusione (regola come
  per Filo):
  - una suite su GitHub Actions prova i rami;
  - il server fonde se il feedback è fidato e la suite è verde;
  - un'automazione su `main` fa il deploy con l'identità federata di GitHub verso
    Google Cloud, senza nessuna chiave salvata.

  Nessun agente tiene mai credenziali di deploy.
- **Passi dell'owner, una volta:**
  - creare l'applicazione «filo-lavori»;
  - installare il cancello anche su filo-security, con token ristretti al repo;
  - mettere la regola su `main`;
  - configurare l'identità federata.

## 8. Crediti

I numeri restano dell'owner, in Routine → Crediti.

### 8.1 Misurare

- **Oggi:** alla chiusura del biglietto uno script legge il registro della
  sessione e allega al rilascio i token usati. Non costa niente al modello. Ma
  i biglietti contano solo il 60% circa del consumo vero: mancano
  l'orchestratore e i biglietti morti senza rilascio.
- **Domani: a ogni battito.** Il battito parte già ogni pochi minuti da un
  processo che non è il modello. Si allega il consumo progressivo, letto
  dalla parte nuova del registro: costa millisecondi e zero token. Lo fa anche
  l'orchestratore, che oggi non è contato. Un biglietto morto ha almeno il
  consumo fino all'ultimo battito.
- **La misura vera è la percentuale del piano** (settimanale e cinque ore).
  Claude Code la passa, documentata, solo allo script della **barra di stato**
  (`rate_limits.five_hour` e `rate_limits.seven_day`, con l'ora del rinnovo). Da
  nessun'altra parte.
  - **In locale:** la barra di stato dell'owner salva il dato, e il battito della
    sessione lo manda al server. Basta una sessione aperta per sapere la
    percentuale vera di quell'account.
  - **In cloud:** non è documentato se la barra di stato giri. Va provato con
    una routine di prova. Se gira, il battito delle routine allega la
    percentuale di ciascun account.
  - **Altrimenti:** si stima dai token con la taratura (100% ≈ 2.150 $ a
    settimana per account), e la taratura si corregge ogni volta che arriva una
    lettura vera da una sessione locale sullo stesso account.

  I token servono comunque a ripartire la spesa fra i lavori (quanto costa un
  giro, un ruolo, un feedback).

### 8.2 Decidere

- **Riserva dell'owner:** sull'**account A**, il principale dell'owner, il
  10% resta sempre libero: il pacemaker non ci accende più niente oltre il 90%
  della settimana. Le sessioni locali dell'owner consumano da A: col dato della
  barra di stato entrano nel conto da sole. L'account B può arrivare al 100%.
- **Passo:** lo decide la curva del monitoraggio (§ 4.5). Senza curva, ogni
  giorno si spende al massimo il rimasto diviso i giorni che mancano al
  rinnovo.
- **Ordine:** quello della coda, cioè l'urgenza dei compiti (§ 6.3). Il passo
  e la riserva dicono quanto si spende, non cosa viene prima: la priorità 3
  resta sopra le risposte e i ricorrenti.
- **Fine settimana:** nelle ultime 24 ore prima del rinnovo la quota non spesa
  si perderebbe, quindi si apre alle priorità basse (0 e 1).
- **Controllo:** il monitoraggio confronta speso e passo, e apre una domanda se
  la quota non basta per le priorità 3.

## 9. Istruzioni dei ruoli: dal repo al server

- Le **istruzioni dei ruoli** (`routines/roles/*.md`), i criteri di verifica e
  le regole sui livelli si spostano in un repo **privato** del server. Il
  biglietto le consegna intere, insieme al resto del contesto del lavoro.
  Vantaggi:
  - una sola fonte (oggi sono in parte nel server, in parte nei file);
  - si cambiano senza fondere su Filo;
  - ogni ruolo riceve solo le sue;
  - chi prepara un attacco non le può studiare.

  Non sono una difesa in sé: la difesa restano i permessi.
- **Restano nel repo pubblico:**
  - `CLAUDE.md`, `filo_filosofia.txt`, `filo_design.txt`;
  - `PATTERNS.md` con `patterns/`;
  - le spec.

  Descrivono il codice e cambiano insieme al codice, nello stesso commit, e le
  leggono anche le sessioni locali.
- Le decisioni dell'owner sono già sul server (`payload.decisioni`) e diventano
  il registro della § 3.6.

## 10. Mittenti: solo statistica

`clientId` resta con tutti i mittenti, senza più permessi. Il server aggiunge
una classe normalizzata, `mittenteClasse`:

- `owner`;
- `utente`;
- `filo_per_utente`;
- `sessione_locale`;
- `routine`, con il ruolo in `mittenteRuolo`;
- `server`;
- `test`.

Oggi le etichette sono più di venti, scritte senza criterio (`routine:residuo`,
`routine:routine:nice-wozniak`, `verifica-3e`, `agent:gemma-4-31b-it`, …): una
migrazione le mappa. Il codice che decide in base al prefisso
(`isTrustedClient`, i gruppi di `autoApprove`, `nascita.js`) passa a leggere
`fiducia`.

## 11. Dove gira il lavoro

- **In locale quasi niente:** l'owner che risponde in Filo, le discussioni in
  chat, quello che richiede il suo PC.
- **Le prove con Electron** girano nei contenitori delle routine.
- **La cartella padre** (LOCAL.md, report, laboratori) diventa leggibile dalle
  sessioni cloud pulite come repo privato. Si verifica se basta
  `sathyaram1/filo-backup` (privato, backup giornaliero). Restano fuori per
  regola, controllata prima di ogni spinta:
  - i `.env` e ogni file con chiavi;
  - `node_modules`;
  - video e modelli pesanti.

## 12. Orchestratore

### 12.1 Oggi

- Il pacemaker accende fino a `maxSessions` orchestratori, una sessione cloud
  ciascuno. Ogni orchestratore fa lavorare un worker alla volta, in fila.
- Un orchestratore chiude quando:
  - la coda è vuota;
  - il suo contesto supera il 70%;
  - c'è un guasto o arriva un limite di sessione.
- Il pacemaker ne riaccende un altro dai battiti. Ogni accensione conta nel
  tetto giornaliero (12 per account).
- L'orchestratore gira col modello della sessione, e la sua rilettura del
  contesto fra un biglietto e l'altro è buona parte del 40% di consumo che i
  biglietti non contano.

### 12.2 Domani

- **Un orchestratore Haiku.** Non legge feedback e non sceglie niente: lancia,
  aspetta e rilascia. Modello e sforzo di ogni worker vengono dal compito, col
  biglietto (§ 6.4).
- **Lavori in parallelo dentro la stessa sessione.** Chiede un biglietto, lancia
  il worker in sottofondo, e ripete finché il server dice di sì.
- **I posti li conta solo il server.** Un biglietto nuovo esce solo se i lavori
  vivi, di tutti gli orchestratori insieme, sono meno di N. L'orchestratore non
  fa conti: chiede, e il server risponde sì o no. Così più orchestratori
  possono convivere e i lavori non superano mai N.
- **N lo decide la curva del monitoraggio** (§ 4.5), applicata dal server.
- **Abbassare N** non chiude niente: il server smette di dare biglietti, e i
  lavori in corso finiscono.
- **Vita di 4 ore.** Dopo 4 ore, o col contesto oltre il 70%, l'orchestratore
  smette di chiedere biglietti, aspetta che i suoi worker finiscano e chiude.
- **Il pacemaker** accende un orchestratore nuovo ogni 4 ore, o prima se
  nessun orchestratore vivo sta ancora chiedendo biglietti e ci sono posti
  liberi. Le accensioni scendono a circa 6 al giorno.
- **Un tetto per sessione, K.** Oltre ai posti totali N, un orchestratore non
  tiene più di K worker insieme. K si misura sul contenitore: CPU e memoria con
  le prove Electron in parallelo (il battito misura già la memoria).
  - Con N maggiore di K, il pacemaker accende più orchestratori.
  - K limita anche il danno di un crash: oggi muore un lavoro, domani tutti
    quelli della sessione.

Da sistemare prima dei worker in parallelo:

- **Una copia del repo per worker.** Oggi il worker porta l'unica cartella del
  progetto sul suo ramo. Due worker lavorano su rami diversi, ma hanno bisogno
  di due cartelle. Le cartelle di lavoro di git condividono la stessa `.git`:
  scaricare e spingere insieme si contendono i lock dei riferimenti. In più il
  salvataggio automatico passa da tutte le cartelle. Quindi ogni worker ha il
  suo **clone**, con la cache dei pacchetti condivisa, e il salvataggio salva
  solo la cartella di chi ha modificato.
- **Sotto-lavori.** Un worker può lanciare sotto-agenti suoi (fino a tre
  livelli sotto la sessione principale) per il lavoro interno: esplorazioni,
  raccolte, prove. Quando invece un lavoro va diviso in pezzi che contano nei
  posti e hanno un biglietto loro (una revisione grande, per esempio), il worker
  chiede al server dei compiti figli (§ 6), col ruolo e i numeri, mai testo
  libero, come per l'unione (§ 1.3). Ognuno ha il suo biglietto, e
  l'orchestratore li lancia come gli altri, dentro N e K. I figli ereditano
  l'urgenza del padre e la sua fiducia in quel momento. Il padre aspetta i loro
  esiti dal server.
  Le chiusure a metà e i crash li segue il monitoraggio.
- **Le prove** non devono contendersi display virtuali, porte o cartelle: vanno
  provate con 2, 3 e 4 worker insieme.
- **Account:** ogni orchestratore consuma dall'account che lo ha acceso.
  Accende su A solo sotto il 90% (§ 8.2).

## 13. Ordine di lavoro

Ogni punto è un feedback fidato. Finché il § 7 non è fatto, i punti *server* si
lavorano in locale.

1. *server*: biglietti che si sporcano, campo `fiducia`, migrazione, spareggio
   provvisorio (§ 1.6; lo sostituisce l'urgenza al punto 5), L5 decisa dalla
   fiducia, fine di `mergePreapproved`.
2. *server*: collezione `domande`, regole, operazioni, azioni strutturate.
3. App: barra delle sezioni, sezione Domande, Ricevuti coi filtri L1–L5.
4. Le attese di oggi diventano domande (§ 3.8); `domanda.mjs` per tutti.
5. *server*: compiti (§ 6): collezione, funzione delle fasi col trigger e il
   controllo nel pacemaker, urgenza al posto dell'ordine di oggi, biglietto
   legato al compito, modello e sforzo dal compito; app: scheda Routine →
   Compiti. Serve ai punti 6 e 8.
6. Compito «Gestisci la risposta», chiarimenti, «discutiamone», note per gli
   agenti.
7. Registro, revisione quotidiana, risposte automatiche.
8. Compiti ricorrenti, ruolo `compito`, ambiti `coda`/`unisci`/`domande`/
   `monitor`/`rami`/`audit`, rapporto che passa all'istanza successiva,
   segnalazioni, domanda di fine turno per tutti i ruoli.
9. Gestione del lavoro (§ 4.3–4.8): taccuino, sveglie, controllo del
   monitoraggio, lanci per numeri, curva del parallelismo applicata dal
   server, indicatori, ambito `esperimento`, budget, rapporto settimanale,
   potatura per regola sul server.
10. Crediti (§ 8), dopo la conferma dei numeri.
11. Lavori server dalla cloud (§ 7).
12. Istruzioni dei ruoli sul server (§ 9).
13. Canale stabile (§ 4.2).
14. Opportunità e posta: il server legge e scrive la casella con le sue
    credenziali, ambito `posta`, azione `invia_mail` coi solleciti, taccuino.
15. Mittenti normalizzati (§ 10).
16. Cartella padre per le sessioni cloud (§ 11).
17. Orchestratore Haiku con worker in parallelo (§ 12): prima la misura di K e
    il salvataggio per cartella.

I punti 1–4 danno già il risultato principale: un posto solo, con le domande
ordinate per priorità e i blocchi di sicurezza letti sul testo originale.
