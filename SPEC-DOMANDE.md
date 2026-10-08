# Domande all'owner, fiducia e lavoro che si organizza da solo

Specifica decisa con l'owner l'08/10/2026. È il riferimento per i feedback che la
realizzano: chi ne lavora uno legge la sezione che gli tocca, non tutto il file.

## 0. Perché

I limiti del piano non sono più il collo di bottiglia. Lo sono due cose:

- **L'attenzione dell'owner.** Ogni lavoro produce un report con decine di
  domande, ogni domanda vive in un posto diverso (chat, pagine HTML, Ricevuti,
  note), le risposte si copiano e incollano a mano, e da ogni report nascono
  altre conversazioni. Ogni salto fra un posto e l'altro è una distrazione.
- **Il portatile dell'owner.** Si spegne quando lo sposta e rallenta con dieci
  sessioni che fanno prove. Una sessione persa butta crediti in avvii a freddo.

La soluzione è invertire i ruoli. Gli agenti organizzano e fanno il lavoro.
L'owner dà il giudizio, da **un posto solo** dentro Filo, quando può.

Principio cardine: la **bitter lesson**. Un agente generico capace, con buone
prove e permessi imposti dal server, al posto di meccanismi scritti a mano per
ogni caso. Ogni regola speciale costa manutenzione e invecchia col modello
successivo.

Tre regole che valgono per tutta la specifica:

1. **Nessun agente accetta un blocco di sicurezza**, di nessun livello (L1–L5,
   secaudit, giudici). Lo decide solo l'owner. Se i falsi positivi diventano un
   problema, si correggono i controlli guardando i dati.
2. **Meno domande, raggruppate.** Una domanda che una decisione già presa
   risolve non arriva all'owner (§ 3.5).
3. **Niente scadenze automatiche.** Una domanda senza risposta resta aperta.
   Conta la priorità: l'owner risponde prima a ciò che blocca.

## 1. Fiducia: due livelli soli

### 1.1 La regola

Ogni feedback, domanda e compito ha un campo `fiducia`: `fidato` oppure
`non_fidato`. Lo calcola e lo scrive **solo il server**. Nessun client e nessun
agente lo imposta.

È **fidato** solo ciò che viene da:

- **l'owner**: un feedback scritto da lui (app autenticata come admin);
- **un'approvazione dell'owner**: un feedback che l'owner segna come fidato
  dopo averlo letto (§ 1.3);
- **un agente a contesto pulito**: la sua sessione ha letto solo cose fidate
  (§ 1.2);
- **il server**: allarmi, blocchi, compiti ricorrenti nati da un modello
  dell'owner.

Tutto il resto è **non fidato**: i feedback degli utenti, quelli che Filo apre
per conto di un utente, e **ogni cosa scritta da un agente che ha letto testo non
fidato**. La contaminazione si propaga. Un feedback nato dall'unione di altri è
fidato solo se lo sono tutti i genitori e chi l'ha scritto ha il contesto
pulito.

Il mittente (`clientId`) resta, con tutte le sue varianti, ma **serve solo alle
statistiche** (§ 7). Non dà più nessun permesso.

### 1.2 Contesto pulito

Un agente ha il contesto pulito se nella sessione ha letto solo:

- il repo su `main` (il codice fuso ha passato i controlli);
- feedback, domande e risposte fidati;
- le istruzioni del suo ruolo.

Hanno il contesto **sporco**: chi lavora un feedback non fidato, chi legge la
posta, chi fa il riordino della coda, chi legge registri che possono citare
testo di utenti (il monitoraggio). Quello che scrivono nasce non fidato.

In cloud lo decide il server: il biglietto nasce da un lavoro fidato o no, e
quello che il lavoro produce eredita la sua fiducia. Il server prende la
fiducia dal biglietto, mai dalla dichiarazione dell'agente.

Nelle sessioni locali (owner in chat) il server non vede cosa ha letto la
sessione. Un feedback aperto da una sessione locale è fidato. Fa eccezione la
sessione che ha letto testo non fidato (feedback di utenti decifrati, pagine
web, posta): quella lo apre con `--non-fidato`. È un limite accettato: la
sessione locale è sorvegliata dall'owner. Gli strumenti che stampano testo
non fidato lo ricordano in fondo all'uscita.

### 1.3 Cosa cambia con la fiducia

- **Il server e filo-security.** Un lavoro che tocca il server, le sue regole o
  i suoi segreti deve essere fidato. Se un feedback non fidato ne ha bisogno, il
  worker si ferma e apre una domanda «Rendere fidato questo feedback?». L'owner
  legge il testo e risponde: segnarlo fidato è un'azione chiusa (§ 3.3).
- **I giudici alla nascita** (L2) restano per i soli non fidati, come oggi per i
  mittenti provati.
- **Lo spareggio della coda.** A pari priorità, prima i fidati, poi la
  generazione, poi l'età. Sostituisce `senderClass` (owner 1, locale 2, utente
  3, filo 4, routine 5) in `selectTodoWinner`
  (filo-security `functions/src/routine/select.js`). La regola «prima si
  finisce un ramo in revisione, poi si comincia lavoro nuovo» (`REVIEW_RANK`)
  resta: non dipende dal mittente.
- **L5 non dipende dalla fiducia.** Un feedback fidato che fa scattare L5
  aspetta comunque l'owner. Oggi `mergePreapproved` fa due cose insieme: rende
  il lavoro «dell'owner» e salta L5. Si dividono:
  - «Segna fidato»: un'azione dell'owner sul feedback;
  - «Approvo in anticipo i blocchi di sicurezza»: una risposta dell'owner,
    data prima, alla domanda L5 di quel feedback. Resta legata allo sha e alla
    stessa lista di blocchi, come oggi.

  In entrambi i casi decide l'owner. Nessun agente.

### 1.4 Dati

- `fiducia` sul documento del feedback (e della domanda). Lo scrive solo
  l'Admin SDK. Le regole di Firestore lo vietano ai client, come `senderProof`.
- `genitori: [id…]` sul feedback derivato.
- Migrazione: i feedback esistenti diventano fidati se oggi il mittente è
  provato (`senderProof` admin o server, prefisso owner/local), altrimenti non
  fidati. `routine:residuo` è non fidato: nasce da rilievi su lavori di utenti.

## 2. Gestione: un posto solo per tutto Filo

La pagina Gestione (`src/pages/manage/`) diventa il posto unico dell'owner. Oggi
ha una barra piatta con 10 schede. Diventa una **barra di sezioni**, ciascuna
con le sue schede:

| Sezione | Schede | Quando |
|---|---|---|
| **Domande** | Da rispondere · In lavorazione · Risposte automatiche · Archivio | adesso |
| **Feedback** | Ricevuti · In coda · Lavori locali · Risolti · Archiviati · Statistiche · Red Team | adesso (spostate) |
| **Routine** | Automazioni · Monitoraggio · Log · Compiti ricorrenti | adesso (spostate più le nuove) |
| **Impostazioni predefinite** | Modelli di supporto, poi tutte le impostazioni predefinite di Filo | ora solo lo spostamento; il resto è un lavoro a parte |
| **Statistiche d'uso** | — | lavoro a parte, non ora |

- Si apre su **Domande** se c'è almeno una domanda bloccante, altrimenti
  sull'ultima sezione usata.
- Ogni sezione mostra un contatore: per Domande quelle bloccanti, più il
  totale.
- Le schede esistenti si spostano **senza essere rifatte**. Il lavoro di questa
  specifica è la barra e la sezione Domande.
- Da Ricevuti escono le domande: i `design` con motivo `clarify` o `decisione`,
  le richieste di fusione L5, i `locale` e gli `attesa_chiusa` diventano
  domande (§ 3.7). Ricevuti torna a essere solo l'ingresso: i feedback nuovi,
  quelli sospetti o d'attacco, e gli allineati da approvare.

## 3. Domande

### 3.1 Cos'è una domanda

Una domanda è un documento a sé (collezione `domande`), cifrato come i
feedback e leggibile solo dall'owner e dal server. Campi:

- `titolo`: una riga.
- `contesto`: quanto basta per decidere senza aprire altro.
- `problema`: cosa succede in pratica. Per un buco di sicurezza, cosa fa un
  attaccante; per una funzione, cosa vede l'utente.
- `opzioni`: per ciascuna testo, pro, contro ed eventuale `azione` (§ 3.3).
- `consiglio`: l'opzione che sceglierebbe chi chiede, e perché.
- `priorita`: `bloccante` (qualcosa è fermo finché non rispondi),
  `importante`, `quando_puoi`.
- `origine`: feedback N, compito, audit, posta, monitoraggio o sessione
  locale.
- `blocca`: cosa aspetta la risposta (feedback, rami, la pubblicazione).
- `gruppo`: il tema, per il raggruppamento (§ 3.5).
- `fiducia`: § 1.
- `stato`: `aperta`, `in_lavorazione` (una risposta è in mano a un agente),
  `chiusa`, `superata` (assorbita da un'altra domanda).
- `conversazione`: i turni (domanda, risposta dell'owner, chiarimento, …). La
  risposta dell'owner è un turno fidato a sé e non si fonde nel testo della
  domanda.

Il formato per l'owner è quello del report delle 102 domande: contesto,
problema in pratica, opzioni con pro e contro, scelta consigliata. Nessun nome
di file o di funzione nel testo per l'owner. Prima di scriverla si applica
`.claude/skills/unslop/SKILL.md`.

### 3.2 Chi la scrive

Una sola strada per tutti, uno strumento `scripts/domanda.mjs`:

- **routine**: attraverso il canale autenticato, col biglietto. La fiducia
  della domanda è quella del biglietto.
- **sessioni locali**: col token admin, come `claude-feedback.mjs`.
- **server**: direttamente (blocchi L5, allarmi, compiti ricorrenti).

Comandi: `chiedi` (crea, da un JSON col formato sopra), `mostra <id>`,
`elenco`, `rispondi <id>` (per le sessioni locali che discutono una domanda con
l'owner).

Chi chiede deve prima controllare il registro delle decisioni (§ 3.5). Se una
decisione già presa risponde, non chiede: la applica e la cita nel suo lavoro.

### 3.3 Le risposte

Nella sezione Domande l'owner può:

1. **Scegliere un'opzione.** Se l'opzione ha un'`azione` chiusa, la applica il
   **server, senza agenti**. Azioni previste:
   - riprendi il feedback con questa decisione (torna `todo` e la decisione
     arriva al worker in `payload.decisioni`, come oggi);
   - segna fidato;
   - approva la fusione (L5);
   - approva come lavoro locale;
   - archivia;
   - cambia priorità;
   - accendi o spegni una cosa dell'automazione.

   Se l'opzione non ha un'azione chiusa, si crea un compito «Gestisci la
   risposta» (§ 3.4).
2. **Scrivere una risposta.** Si crea sempre un compito «Gestisci la
   risposta».
3. **Applicare il consiglio** su una domanda sola o su tutte quelle
   selezionate, per quando si ammassano. Vale come una scelta.
4. **Discuterne.** Il pulsante copia una riga sola, da incollare in una
   sessione locale («Discutiamo la domanda D-123»). La sessione la legge con
   `domanda.mjs mostra` e, alla fine, risponde con `domanda.mjs rispondi`.
   Serve quando una domanda apre un tema più grande (per esempio ripensare un
   sistema intero invece di rincorrere venti casi).

### 3.4 Il compito «Gestisci la risposta»

- È un feedback con priorità 3 e tipo `risposta`. L'orchestratore lo prende
  appena può, prima del lavoro nuovo di pari priorità.
- Lo lavora **Opus col repo**, come ogni altro worker. Una decisione capita
  male costa più di qualunque risparmio sul modello.
- È fidato se la domanda era fidata. Se la domanda veniva da qualcosa di non
  fidato, il compito ha il contesto sporco e quello che produce nasce non
  fidato. Fa eccezione la parte che è testo dell'owner: le sue parole restano
  fidate e viaggiano come turno a sé.
- Il compito legge la domanda con la conversazione, il feedback d'origine e il
  registro delle decisioni. Poi fa una o più di queste cose:
  - apre o aggiorna feedback (con la decisione citata);
  - riprende il feedback d'origine;
  - scrive un **chiarimento**: se l'owner ha risposto con una domanda o una
    richiesta di spiegazioni, il compito aggiunge la sua risposta alla
    conversazione e la domanda torna `aperta`. È una mini-conversazione che
    ricompare fra le domande, senza aprire chat;
  - apre una domanda nuova, se la risposta ne fa nascere una;
  - scrive il **principio** (§ 3.5).
- Contesto piccolo: legge solo quello che serve alla domanda.

### 3.5 Registro delle decisioni, raggruppamento e risposte automatiche

- **Principio.** Ogni domanda chiusa porta una frase di principio: la regola
  generale che la risposta stabilisce, quando c'è (esempio: «zero fiducia nei
  crediti dichiarati dal client»). La scrive il compito della § 3.4, o il
  server per le risposte chiuse se l'opzione ne porta già uno.
- **Il registro** sono le domande chiuse con il loro principio, cercabili da
  `domanda.mjs`. Nessun file a parte da tenere allineato.
- **Revisione quotidiana** (un compito ricorrente, § 4):
  - raggruppa le domande aperte per tema;
  - assorbe in una domanda sola quelle che sono casi dello stesso problema e
    propone il ripensamento del sistema. Le domande assorbite diventano
    `superata` e restano visibili dentro quella nuova;
  - rivede le priorità;
  - risponde in automatico alle domande che un principio già copre.
- **Le risposte automatiche** finiscono nella scheda «Risposte automatiche» con
  il principio usato. L'owner può riaprirle: una riapertura corregge anche il
  principio.

### 3.6 Ordine nella sezione

Prima `bloccante`, poi `importante`, poi `quando_puoi`. Dentro ciascuna, per
gruppo e poi per età. Un gruppo si apre come un blocco solo, e lì si può
rispondere a tutto il gruppo.

### 3.7 Cosa diventa domanda fra le attese di oggi

| Oggi | Domanda | Azione chiusa |
|---|---|---|
| `design` + `clarify`/`decisione` (deliver.js `domandeDa`) | sì, con le domande del worker | riprendi con la decisione |
| segnalazione L3 (`--segnala`) | sì | riprendi con la decisione |
| richiesta di fusione L5 (mergeApprovals) | sì, `bloccante` | approva la fusione / rimanda al lavoro |
| `design` + `locale` | sì: «lavoro locale o fidato?» | approva come locale / segna fidato |
| `attesa_chiusa` | sì | riprendi / archivia |
| `design` + `loop`, `arenato`, `secaudit`, `l5` | sì | riprendi / archivia |
| domanda di fine sessione alle routine | no: resta un'impostazione (Routine → Automazioni) | — |

Il feedback in attesa resta `design` col suo motivo e prende `domandaId`. La
macchina a stati non cambia. Cambia dove l'owner risponde.

## 4. Compiti ricorrenti

Un compito ricorrente è un **modello** scritto dall'owner (quindi fidato): un
testo di istruzioni, una cadenza e un ambito (§ 5). All'ora giusta il server ne
crea un'istanza: un feedback fidato, priorità 3, tipo `compito`, con
`nonPrimaDi` uguale all'ora prevista. L'orchestratore lo prende come ogni altro
lavoro.

Non ci sono ruoli nuovi. Un ruolo generico `compito` legge il testo del modello
e lo esegue. I permessi li dà l'ambito, non il ruolo.

Cadenze iniziali, ora italiana:

| Quando | Compito | Ambito |
|---|---|---|
| ogni giorno | revisione delle domande (§ 3.5) | `domande` |
| ogni giorno | posta di Filo: legge, riassume, prepara le risposte come domande | `posta` |
| ogni giorno | monitoraggio (§ 4.1) | `monitor` |
| lunedì | riordino dei feedback (§ 6) | `coda` |
| lunedì | potatura dei rami fusi | `lavoro` |
| domenica | audit di sicurezza | `lavoro` |
| lunedì 00:00 | pubblicazione della versione minor | pubblicazione (GitHub) |

- L'audit della domenica apre feedback a priorità 3. Se un rilievo è grave e non
  sembra chiudibile entro la notte, apre una domanda `bloccante`: «Rinvio la
  minor di lunedì?».
- I compiti ricorrenti si vedono e si modificano in Routine → Compiti
  ricorrenti. Aggiungerne uno è una richiesta dell'owner, anche a parole in una
  domanda.

### 4.1 Monitoraggio e sveglie

Il monitoraggio legge, senza scrivere nel codice:

- i costi e i giri delle routine;
- le accensioni a vuoto;
- la suite su main;
- i rilasci;
- i registri delle esecuzioni in cloud.

Quando qualcosa non va, apre una domanda o un feedback.

Cosa può fare:

- cambiare la domanda di fine sessione ai worker;
- **spegnere** le routine o un account in caso di emergenza, ma non
  riaccenderli: quello lo decide l'owner. È la direzione sicura;
- seguire da vicino un problema:
  - **attese fino a circa 2 ore:** aspetta dentro la stessa sessione e si
    risveglia ogni 40 minuti al massimo, così la cache resta calda e non
    spreca accensioni;
  - **attese più lunghe:** chiede al server una sveglia (`sveglia: ora`
    sul suo biglietto). Il pacemaker la rispetta con un tetto suo (6 al
    giorno), separato da quello del lavoro.

## 5. Ambiti: i permessi stanno sul server

Gli agenti in cloud **non hanno credenziali** del database o del server, come
oggi. Chiedono un biglietto, e il biglietto porta un **ambito**: un elenco
chiuso di operazioni che il server accetta.

| Ambito | Può | Non può |
|---|---|---|
| `lavoro` | lavorare un feedback, spingere il suo ramo, chiedere la fusione, aprire feedback e domande | toccare la fiducia, approvare blocchi |
| `coda` | cambiare priorità, unire feedback (creando il derivato), chiudere doppioni e stantii, aprire domande | cancellare, segnare fidato, toccare attacchi o feedback di sicurezza aperti |
| `domande` | raggruppare, cambiare priorità, rispondere coi principi, segnare `superata` | rispondere senza un principio, cambiare principi |
| `posta` | leggere la casella di Filo, aprire domande con bozze di risposta | mandare mail, spingere codice |
| `invio` | mandare una bozza **già approvata dall'owner** | scrivere testi nuovi |
| `monitor` | leggere statistiche e registri, cambiare la domanda di fine sessione, spegnere, chiedere una sveglia | accendere, toccare feedback |

Regole:

- **La triade.** Un ambito non mette mai insieme tutte e tre queste cose:
  - leggere testo non fidato;
  - vedere segreti o dati privati;
  - agire verso l'esterno.

  Per questo `posta` (testo non fidato più la casella) non manda niente, e
  `invio` manda solo testi fidati.
- **Un ambito nuovo lo approva l'owner.** Un agente che ne ha bisogno apre una
  domanda con la proposta (operazioni, cosa non può, triade). L'owner lo
  approva una volta e da lì vale per tutti i compiti di quel tipo.
- **Nessun ambito** può approvare blocchi di sicurezza, cambiare la fiducia,
  creare ambiti o toccare le chiavi.
- **I segreti** (la casella di posta, eventuali credenziali di deploy) stanno
  solo nell'ambiente cloud del compito che li usa. Gli ambienti li crea
  l'owner, una volta.

## 6. Feedback: una cosa da fare

- Un feedback è una cosa da fare. Unire vuol dire **creare un feedback nuovo**
  con `genitori`. I genitori si chiudono con il rimando al figlio.
- Il riordino del lunedì lavora tutta la coda insieme, non un feedback alla
  volta:
  - unisce i doppioni;
  - chiude gli stantii e quelli già fatti;
  - rivede le priorità con la scala 3/2/1/0;
  - trasforma in domande quelli che aspettano una scelta.

  È non fidato per costruzione: legge testo di utenti. Agisce solo con
  l'ambito `coda`.
- I feedback a bassa priorità che si accumulano sono normali: verranno fatti
  quando ci saranno crediti. Il riordino li tiene puliti, non li svuota.
- I «lavori locali» di oggi restano feedback (fidati, `localOnly`). Il nome per
  i compiti interni si decide nel lavoro sulla Gestione.

## 7. Mittenti: solo statistica

Il campo `clientId` resta, con tutti i mittenti, ma perde ogni significato di
permesso (§ 1). Per le statistiche si aggiunge una classe normalizzata,
`mittenteClasse`, scritta dal server:

- `owner`;
- `utente`;
- `filo_per_utente` (Filo apre per conto di un utente);
- `sessione_locale`;
- `routine` (il ruolo va in `mittenteRuolo`);
- `server`;
- `test`.

Oggi le etichette sono più di venti e scritte senza un criterio
(`routine:residuo`, `routine:routine`, `routine:routine:nice-wozniak`,
`verifica-3e`, `agent:gemma-4-31b-it`, …). Una migrazione le mappa sulle
classi. Il codice che decide permessi in base al prefisso (`isTrustedClient`,
gruppi di `autoApprove`, `nascita.js`) passa a leggere `fiducia`.

## 8. Dove gira il lavoro

- **In locale quasi niente.** Restano l'owner che risponde in Filo, le
  discussioni in chat e quello che richiede il suo PC.
- **Le prove con Electron** girano nei contenitori delle routine (xvfb, già
  pronto), non sul portatile.
- **Il server dalla cloud**, per i soli lavori fidati:
  - filo-security prende una suite su GitHub Actions per i rami;
  - la fusione su `main` la fa il server con il cancello di fusione, come per
    Filo, solo per feedback fidati e con L5 anche sui diff del server;
  - un'automazione su `main` di filo-security fa il deploy con l'identità
    federata di GitHub verso Google Cloud, senza nessuna chiave salvata;
  - un agente non tiene mai le credenziali di deploy.

  Passi dell'owner, una volta:
  - identità federata;
  - regola su `main` di filo-security;
  - installazione del cancello di fusione anche su filo-security.

  Il cancello chiede token ristretti al repo su cui fonde.
- **La cartella padre** (LOCAL.md, report, laboratori) diventa leggibile dalle
  sessioni cloud fidate come repo privato. Esiste già `sathyaram1/filo-backup`
  (privato, backup giornaliero): si verifica se basta usarlo così. Restano
  fuori per regola, controllata prima di ogni spinta:
  - `.env` e ogni file con chiavi;
  - `node_modules`;
  - video e modelli pesanti.

  Le sessioni non fidate non lo ricevono.

## 9. Ordine di lavoro

Ogni punto è un feedback. Quelli marcati *server* sono fidati e, finché il §8
non è fatto, si lavorano in locale.

1. *server*: campo `fiducia` (calcolo, regole, migrazione), spareggio, divisione
   di `mergePreapproved`.
2. *server*: collezione `domande`, regole, operazioni del canale, azioni
   chiuse.
3. App: barra delle sezioni in Gestione con le schede spostate, sezione
   Domande.
4. Le attese di oggi diventano domande (§ 3.7), con `domanda.mjs` per tutti.
5. Compito «Gestisci la risposta», chiarimenti, pulsante «discutiamone».
6. Registro, revisione quotidiana, risposte automatiche.
7. Compiti ricorrenti (`nonPrimaDi`, modelli, ruolo `compito`) e ambiti `coda`,
   `domande`, `monitor`.
8. Monitoraggio e sveglie.
9. Riordino della coda e feedback derivati con `genitori`.
10. Server dalla cloud (§ 8).
11. Posta (`posta`, `invio`), quando l'owner ha creato l'ambiente.
12. Mittenti normalizzati (§ 7).
13. Cartella padre per le sessioni cloud.

Le prime quattro danno già il risultato principale: un posto solo con le
domande ordinate per priorità.
