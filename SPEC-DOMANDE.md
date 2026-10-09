# Domande all'owner, fiducia e lavoro che si organizza da solo

Specifica decisa con l'owner l'08–09/10/2026. È il riferimento per i feedback che
la realizzano: chi ne lavora uno legge la sezione che gli tocca, non tutto il
file.

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
- **il server**: allarmi, compiti ricorrenti nati da un modello dell'owner.

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
- **in locale:** la sessione dichiara da sé di essersi sporcata (`biglietto.mjs
  sporca "motivo"`), e gli strumenti che stampano testo esterno lo fanno da
  soli. È un limite accettato: in locale c'è l'owner.

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
- **Spareggio della coda:** a pari priorità prima i fidati, poi la
  generazione, poi l'età. Sostituisce `senderClass` in `selectTodoWinner`
  (filo-security `functions/src/routine/select.js`). La regola «prima si
  finisce un ramo in revisione» (`REVIEW_RANK`) resta.

### 1.7 Dati

- `fiducia` su feedback, domande e biglietti. La scrive solo l'Admin SDK; le
  regole la vietano ai client.
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
| **Routine** | Automazioni · Crediti · Monitoraggio · Log · Compiti ricorrenti | adesso (spostate più le nuove) |
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
- `esperimento` (approva un esperimento del monitor, § 4.3);
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

### 3.5 Il compito «Gestisci la risposta»

- Un feedback a priorità 3, tipo `risposta`. L'orchestratore lo prende appena
  può.
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
| `attesa_chiusa`, `loop`, `arenato` | domanda, azioni `riprendi` / `archivia` |
| `design` + `secaudit`, `l5`; attacchi, spam, sospetti | Ricevuti |

Il feedback in attesa resta `design` col suo motivo e prende `domandaId`: la
macchina a stati non cambia. Per l'owner, però, un `design` con una domanda
aperta si vede nella scheda **In coda**, col segno «aspetta una domanda» che
porta alla domanda, e non in Ricevuti.

## 4. Compiti ricorrenti, pubblicazione, monitoraggio

### 4.1 Compiti ricorrenti

Un compito ricorrente è un **modello** scritto dall'owner (quindi fidato): un
testo di istruzioni, una cadenza e un ambito. All'ora giusta il server ne crea
un'istanza: un feedback fidato, priorità 3, tipo `compito`, con `nonPrimaDi`.
L'orchestratore lo prende come ogni altro lavoro.

Un ruolo generico `compito` esegue il testo del modello. I permessi li dà
l'ambito, non il ruolo.

| Quando (ora italiana) | Compito | Ambito |
|---|---|---|
| ogni giorno | revisione delle domande (§ 3.6) | `domande` |
| ogni giorno | posta di Filo: legge e prepara domande con le bozze di risposta | `posta` |
| ogni giorno | monitoraggio (§ 4.3) | `monitor` |
| lunedì | riordino della coda (§ 6) | `coda` |
| lunedì | potatura dei rami fusi | `rami` |
| domenica | audit di sicurezza | `lavoro` |

Si vedono e si cambiano in Routine → Compiti ricorrenti.

### 4.2 Due canali di aggiornamento

- **Veloce** (com'è oggi): una versione ogni sei ore, il commit più nuovo con la
  suite verde.
- **Stabile** (nuovo): una versione minor il lunedì alle 00:00. Esce solo se non
  c'è nessun feedback di sicurezza a priorità 3 aperto. La domenica l'audit li
  cerca; le routine hanno 24 ore per chiuderli. Se ne resta uno aperto, quella
  settimana la minor non esce: nessuna domanda, lo dice il monitoraggio.

L'utente sceglie il canale nelle impostazioni. Il canale stabile è per chi
preferisce un'esperienza più ferma, con le verifiche fatte poco prima.

### 4.3 Monitoraggio

Legge i registri:

- costi e giri delle routine;
- fusioni e tempi;
- accensioni a vuoto;
- suite, rilasci, esecuzioni in cloud;
- **tutte le domande passate** con le risposte.

Quando qualcosa non va, apre una domanda o un feedback.

- **Ha un taccuino suo,** persistente sul server: appunti da ricontrollare il
  giorno dopo, modifiche che sta studiando, ipotesi. Lo legge a ogni
  accensione.
- **Propone esperimenti** (per esempio rifare un feedback con altri prompt o
  modelli): diventano domande con azione `esperimento`.
- **Cambia la domanda di fine turno** dei ruoli (§ 5.4).
- **Può spegnere** routine o account in emergenza, non riaccenderli. Riaccendere
  spende, e lo decide l'owner.
- **Segue un problema da vicino:**
  - resta accesa quanto serve e si risveglia da sola ogni 55 minuti al
    massimo, così la cache (60 minuti) resta calda;
  - per attese più lunghe chiede al server una **sveglia**, che il pacemaker
    rispetta con un tetto suo, separato da quello del lavoro.

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
- **I segreti** (casella di posta) stanno solo nell'ambiente cloud del compito
  che li usa. Gli ambienti li crea l'owner.

### 5.2 Gli ambiti iniziali

| Ambito | Può | Non può |
|---|---|---|
| `lavoro` | lavorare il suo feedback, spingere il suo ramo, chiedere la fusione, aprire feedback e domande | tutto il resto |
| `coda` | leggere i feedback **in coda** (non quelli in Ricevuti né quelli fermi per attacco), cambiare priorità, chiedere un biglietto di unione (§ 1.3), archiviare | scrivere testi di feedback, cancellare, toccare Ricevuti |
| `unisci` | leggere i genitori indicati, scrivere il figlio, chiudere i genitori col rimando | leggere altro |
| `domande` | leggere le domande e il registro, raggruppare, cambiare priorità, rispondere coi principi | rispondere senza un principio, cambiare i principi |
| `posta` | leggere la casella di Filo, aprire domande con bozze | mandare mail |
| `invio` | mandare una bozza approvata dall'owner | scrivere testi |
| `monitor` | leggere registri e domande passate, il suo taccuino, cambiare la domanda di fine turno, spegnere, chiedere una sveglia, aprire domande e feedback | accendere, cambiare feedback |
| `rami` | cancellare rami fusi che nessun feedback aperto nomina | tutto il resto |
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

## 6. Feedback: una cosa da fare

- Un feedback è una cosa da fare. Unire vuol dire creare un feedback nuovo con
  `genitori`, per delega (§ 1.3).
- Il riordino del lunedì lavora tutta la coda insieme:
  - unisce i doppioni;
  - archivia gli stantii e i già fatti;
  - rivede le priorità con la scala 3/2/1/0.

  Quelli che aspettano una scelta li segnala alla revisione delle domande.
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
  - git chiede il token a un aiutante di credenziali (`biglietto.mjs token`),
    che ne chiede uno nuovo al server quando quello vecchio sta per scadere;
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
- **Passo:** ogni giorno si spende al massimo il rimasto diviso i giorni che
  mancano al rinnovo, così la settimana non finisce il martedì.
- **Ordine:**
  1. i compiti fidati (risposte, ricorrenti);
  2. i feedback per priorità.
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
  aspetta e rilascia. I worker restano Opus, dalle definizioni degli agenti.
- **Lavori in parallelo dentro la stessa sessione.** Chiede un biglietto, lancia
  il worker in sottofondo, e ripete finché il server dice di sì.
- **I posti li conta solo il server.** Un biglietto nuovo esce solo se i lavori
  vivi, di tutti gli orchestratori insieme, sono meno di N. L'orchestratore non
  fa conti: chiede, e il server risponde sì o no. Così più orchestratori
  possono convivere e i lavori non superano mai N.
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

- **Il salvataggio automatico** oggi passa da tutte le cartelle di lavoro, e due
  worker si pestano sui lock: deve salvare solo la cartella di chi ha
  modificato.
- **Le prove** non devono contendersi display virtuali, porte o cartelle: vanno
  provate con 2, 3 e 4 worker insieme.
- **Account:** ogni orchestratore consuma dall'account che lo ha acceso.
  Accende su A solo sotto il 90% (§ 8.2).

## 13. Ordine di lavoro

Ogni punto è un feedback fidato. Finché il § 7 non è fatto, i punti *server* si
lavorano in locale.

1. *server*: biglietti che si sporcano, campo `fiducia`, migrazione, spareggio,
   L5 decisa dalla fiducia, fine di `mergePreapproved`.
2. *server*: collezione `domande`, regole, operazioni, azioni strutturate.
3. App: barra delle sezioni, sezione Domande, Ricevuti coi filtri L1–L5.
4. Le attese di oggi diventano domande (§ 3.8); `domanda.mjs` per tutti.
5. Compito «Gestisci la risposta», chiarimenti, «discutiamone», note per gli
   agenti.
6. Registro, revisione quotidiana, risposte automatiche.
7. Compiti ricorrenti, ruolo `compito`, ambiti `coda`/`unisci`/`domande`/
   `monitor`/`rami`, segnalazioni, domanda di fine turno per tutti i ruoli.
8. Monitoraggio: taccuino, sveglie, esperimenti.
9. Crediti (§ 8), dopo la conferma dei numeri.
10. Lavori server dalla cloud (§ 7).
11. Istruzioni dei ruoli sul server (§ 9).
12. Canale stabile (§ 4.2).
13. Posta (`posta`, `invio`), quando l'owner ha creato l'ambiente.
14. Mittenti normalizzati (§ 10).
15. Cartella padre per le sessioni cloud (§ 11).

I punti 1–4 danno già il risultato principale: un posto solo, con le domande
ordinate per priorità e i blocchi di sicurezza letti sul testo originale.
