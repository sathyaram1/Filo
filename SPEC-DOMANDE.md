# Domande all'owner, fiducia e lavoro che si organizza da solo

Specifica decisa con l'owner l'08–09/10/2026; compiti e urgenze (§ 6) il 12/10;
gestione del lavoro (§ 4.3–4.8) il 13/10; guasti, segnalazioni e addetto
comunicazioni il 23/10.
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
- le pagine web che il server cerca per un compito (§ 5.1);
- registri che possono citare testo di utenti;
- un ramo scritto da un biglietto sporco.

Uno sporco non torna pulito. Quello che un biglietto scrive prende la fiducia
che il biglietto ha **in quel momento**.

Quello che non passa dal server (pagine web, file fuori dal repo) il server non
lo vede:

- **in cloud:** gli ambienti dei lavori fidati hanno la rete limitata al repo
  e ai pacchetti, e le loro sessioni partono senza gli strumenti web propri
  della sessione: la ricerca web la fa il fornitore del modello, fuori dal
  contenitore, e la rete limitata non la ferma;
- **in cloud, l'ambiente dei riservati** (§ 5.1) ha una regola sola: l'unica
  uscita è il server. Il clone e i pacchetti li prepara l'ambiente prima che
  la sessione parta; da lì la rete arriva al server e, in sola lettura, al
  repo. La sessione parte senza strumenti web propri, senza permesso di
  scrittura su GitHub e senza salvataggio automatico, che spingerebbe il ramo
  sul repo pubblico a ogni modifica. Quello che produce lo consegna al server
  come dati. Un canale che non passa dal server resta chiuso, anche uno nuovo.
  È l'unico ambiente a cui il server consegna testo riservato (§ 5.1);
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
Alla fine (hook) chiudono il biglietto se è sporco; uno pulito resta, perché la
sessione si può riprendere senza nascere sporca. Quelli fermi da più di 30
giorni, o di sessioni morte senza l'hook di fine, li chiude l'avvio di una
sessione successiva.

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

Dal #1153 il biglietto di unione è un compito senza feedback (§ 6.1) con l'ambito
`unisci` e i soli numeri dei genitori: lo chiede `coda.unione`, su 2–12 feedback
in coda non ancora iniziati, e finché è aperto nessun altro lavoro prende i
genitori. Il figlio lo scrive `unisci.scrivi`; i genitori diventano `archived`
col rimando `unitoIn`. Immagini, documenti, pagina e decisioni dell'owner dei
genitori li porta il server nel figlio, insieme al segno di chi ha scritto le
domande di quelle decisioni: l'unione non perde niente.

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
  fidato. Non conta lo sporco della domanda di fine turno della gestione del
  lavoro, che arriva quando il biglietto non scrive più sul ramo (§ 5.4). In
  questo caso **L5 non si applica**: il blocco si registra in
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
  dei figli, poi l'età. I rami in revisione non hanno più la precedenza
  assoluta (#1451). Coi compiti (#1196) spariscono anche lo spareggio
  provvisorio e l'ordine per ruolo (`REVIEW_RANK`): decide l'urgenza (§ 6.3),
  quindi un feedback iniziato passa davanti a uno nuovo solo con un gradino di
  priorità in più, e la priorità 3 passa sopra tutto. Il controllo di sicurezza
  di un ramo finito non aspetta a nessuna priorità (#1451); gli altri lavori
  aspettano solo chi li supera sia in priorità sia in urgenza (filo-security
  `functions/src/routine/select.js`, `ordinaLavori`).

### 1.7 Dati

- `fiducia` su feedback, domande, compiti e biglietti. La scrive solo l'Admin
  SDK; le regole la vietano ai client.
- `riservato` su feedback, domande, compiti e biglietti (§ 5.1), scritto come
  `fiducia`.
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
| **Feedback** | Ricevuti · In coda · Aspettano · Risolti · Archiviati · Statistiche · Red Team | adesso (spostate) |
| **Routine** | Automazioni · Crediti · Gestione del lavoro · Log · Compiti · Compiti ricorrenti | adesso (spostate più le nuove) |
| **Utenti** | Inviti e utenti (la pagina che era `credits/owner.html`) | spostata (#1414) |
| **Impostazioni predefinite** | Modelli predefiniti, poi tutte le impostazioni predefinite di Filo | spostata (#1414); i Modelli di supporto restano in Automazioni (#1110) |
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

Chi risolve, corregge o verifica può segnare un feedback come attacco o spam
(#1358, motivo `worker`, Ricevuti L3): è lo stesso giudizio dei giudici, dato
da chi ha letto il feedback da vicino.

## 3. Domande

### 3.1 Cos'è una domanda

Un documento a sé (collezione `domande`), cifrato come i feedback, leggibile
dall'owner e dal server. Campi:

- `titolo`: al più 10 parole. Non è esaustivo: dice di cosa si parla.
- `contesto`: quanto basta per decidere senza aprire altro.
- `problema`: cosa succede in pratica. Per un buco, cosa fa un attaccante; per
  una funzione, cosa vede l'utente.
- `opzioni`: almeno due, ognuna con testo, pro, contro e `azione`
  strutturata (§ 3.3). Un'opzione sola non è una domanda: è un feedback, o una
  nota. Un resoconto senza niente da decidere (§ 4.8) non è una domanda: va nel
  rapporto settimanale o nelle note del feedback. Fa eccezione la domanda che
  il server apre al terzo guasto uguale (§ 3.8): un'opzione sola, perché non
  arriva all'owner e la smista il compito della § 3.5 (#1790).
- `consiglio`: l'opzione che sceglierebbe chi chiede, e perché.
- `priorita`: `bloccante`, `importante`, `quando_puoi`.
- `origine` e `collegamenti`: feedback, rami, compiti, altre domande.
- `notePerAgenti`: testo privato per chi riprenderà la domanda (§ 3.2).
- `gruppo`: il tema, per il raggruppamento.
- `blocca` (#1577): una domanda legata a un feedback (un'opzione `riprendi`
  lo riprende) dice se lo ferma; lo decide chi la apre, e col biglietto senza
  si rifiuta. Blocca se andare avanti con la consigliata, e poi l'owner sceglie
  altro, lascia un danno che un altro giro non rimedia (soldi, dati
  dell'utente, sicurezza e segreti, politica sui modelli, terzi, account e
  credenziali), o se serve un fatto che sa solo l'owner; nel dubbio blocca.
  Una bloccante aperta toglie il feedback alla coda (`todo` o in revisione):
  il server ne scrive l'id in `domandeBloccanti` sul feedback, che in Gestione
  sta fra quelli che aspettano col segno «aspetta D-n»; alla risposta riparte
  con la decisione in `payload.decisioni`. Una non bloccante non ferma: il
  lavoro va avanti con la consigliata, scritta come decisione provvisoria
  nella conversazione (`payload.provvisorie` per chi viene dopo). Una risposta
  diversa dalla provvisoria riporta in coda anche un fuso (`done` → `todo`);
  la stessa, senza parole in più, su un fuso risponde «non serviva». Una
  risposta che arriva mentre il lavoro è in coda, in mano a qualcuno o in
  verifica non sposta lo stato: la decisione si accoda e la prende il giro
  dopo. Un lavoro già passato, al controllo di sicurezza, torna in verifica
  con la risposta (sicurezza e fusione non leggono le decisioni), salvo la
  stessa scelta della provvisoria. Un lavoro che l'owner ha archiviato dopo
  la nascita della domanda resta archiviato: la risposta si scrive nella sua
  conversazione e non lo riapre; una domanda nata su un lavoro già chiuso lo
  riapre. Finché una bloccante è aperta la fusione non parte. Una fermata
  (§ 3.8) blocca da sé. `legata`, `provvisoria` e `nataSuChiuso` le scrive il
  server.
- `destinatario`: l'owner. Le domande di guasto non arrivano a nessuno: le
  smista il compito «Gestisci la domanda» (§ 3.5).
- `soloOwner`: sulle domande dell'addetto comunicazioni (§ 4.1), che nessun
  compito legge.
- `fiducia`: § 1.
- `principio`: la regola generale che la risposta stabilisce (§ 3.6), la
  scrive il compito della § 3.5; `conPrincipio` in chiaro la fa trovare al
  registro.
- `stato`: `in_smistamento` (appena nata: la sta smistando il compito della
  § 3.5, e in Gestione sta fra quelle in lavorazione, non fra quelle da
  rispondere), `aperta`, `in_lavorazione`, `chiusa`, `superata`.
- `smistamento`: `'fallito'` quando il compito della § 3.5 non è riuscito a
  smistarla in tre tentativi e la domanda è uscita com'era (in Gestione il
  segno «non riscritta»). Lo scrive il server.
- `principioContestato`: su una domanda chiusa, il suo principio che l'owner
  ha contestato riaprendo una risposta automatica che lo usava (§ 3.6). Lo
  scrive il server, e lo toglie quando l'owner risponde alla domanda riaperta.
- `provvisoria`: su una domanda che non ferma, l'opzione con cui il lavoro è
  già andato avanti. La riscrittura del compito della § 3.5 può cambiare il
  consiglio ma non lei: la indica col campo `provvisoria` del file, o il server
  la ritrova per azione e testo e rifiuta se non ci riesce.
- `conversazione`: i turni, con autore (owner o biglietto) e ora.
- `creataIl` e `modificataIl`: la seconda è l'ultima volta che un agente ha
  aggiunto un turno o cambiato qualcosa.

Il formato per l'owner è quello del report delle 102 domande: contesto,
problema in pratica, opzioni con pro e contro, scelta consigliata. Nessun nome
di file o di funzione nel testo per l'owner. Prima di scriverla si applica
`.claude/skills/unslop/SKILL.md`. La validazione comune, quella dello script e
del server, rifiuta e dice quale campo: un titolo oltre le 10 parole, meno di
due opzioni, un'opzione senza pro o senza contro (anche «nessuno»), e nei
campi per l'owner un nome di file di codice o una lineetta; `notePerAgenti`
resta libero. Quello che il compito della § 3.5 pubblica per l'owner è più
corto ancora: da 2 a 4 opzioni, contesto al più 5 righe, problema al più 3,
pro, contro e motivo del consiglio di una riga (una riga sono 140 caratteri).

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
- `automazione` (accendi o spegni una voce);
- `ambito` (approva un ambito nuovo, § 5.3);
- `attendi` (il feedback fermo aspetta il feedback indicato, che ne corregge
  la causa: quando quello si fonde, il server anticipa l'istanza della
  gestione del lavoro, che controlla e riprende, § 4.3);
- `esperimento` (approva un esperimento della gestione del lavoro oltre il suo
  budget, § 4.8);
- `cancella_rami` (cancella i rami elencati nell'azione, § 4.7);
- `invia_mail` (il server manda la mail: destinatario, oggetto, testo, e i
  solleciti con il loro testo e dopo quanti giorni lavorativi. Un sollecito
  parte solo se nella stessa conversazione non è arrivata risposta. L'owner
  può correggere il testo prima di approvare, e il testo corretto è suo);
- `compito` (l'opzione richiede lavoro: nasce il compito della § 3.5).

Le azioni di sicurezza non stanno qui: si fanno in Ricevuti (§ 2.2). Nemmeno
l'affidare un lavoro ai lavori server: un feedback fidato col segno dei lavori
server ci va da sé, uno non fidato aspetta in Ricevuti che l'owner lo segni
(§ 3.8, #1576). Il tipo `approva_locale` non c'è più.

### 3.4 Rispondere

1. **Scegliere un'opzione.** Il server applica l'azione, senza agenti, e le
   parole scritte partono con lei. Se è `compito`, nasce il compito della § 3.5.
2. **Scrivere.** Le parole senza una scelta non applicano nessuna azione, da
   nessuna strada (script e Gestione, anche su una domanda di un'attesa):
   restano parole e nasce il compito della § 3.5 (decisione dell'owner del
   29/10 su D-186, #1598). L'azione parte solo con la scelta: `--scelta N` o il
   pulsante dell'opzione, che porta con sé le parole già scritte. Se il lavoro
   riparte o cambia attesa senza la scelta (la casella di risposta del
   feedback, un'altra attesa), la domanda diventa superata e le sue parole
   entrano nella conversazione del feedback come risposta a quella domanda,
   col loro segno di fiducia: per qualunque strada riparta, chi riprende le
   legge.
3. **Applicare il consiglio**, su una domanda sola o su tutte quelle
   selezionate.

«Riprendi #N con questa scelta», scelto o applicato col consiglio, rimette in
coda #N solo se è fermo ad aspettare l'owner (`design`), e scrive la ripresa
sul ramo del lavoro, così chi lo prende riparte da lì (#1482). Se #N non è
fermo lo stato non cambia: la decisione si scrive nella sua conversazione,
accodata come per le non bloccanti, e l'esito dice «#N non era fermo: è
<stato>, la decisione resta accodata». Una risposta a una domanda non
bloccante di un feedback fermo su un'altra domanda, bloccante, non lo fa
ripartire: la decisione si accoda e la bloccante resta aperta (#1577.2).
4. **Discuterne.** Il pulsante copia una riga sola («Discutiamo la domanda
   D-123») da incollare in una sessione locale. La sessione legge la domanda con
   `domanda.mjs mostra` e risponde con `domanda.mjs rispondi`: `--scelta N` per
   l'opzione decisa (riprendere compreso), `--testo` da solo per una risposta a
   parole (punto 2). Lo script dice cosa il server ha applicato.
5. **Letto**, sui resoconti senza opzioni nati prima di #1790: la domanda si
   chiude, senza agenti. Di nuovi non ne nascono (§ 3.1).

### 3.5 I compiti «Gestisci la domanda» e «Gestisci la risposta»

Due compiti stanno fra le domande e l'owner: uno alla nascita, uno alla
risposta.

#### «Gestisci la domanda» (#1790)

Decisioni dell'owner del 29/10. Prima, metà delle domande aperte le aveva
composte il server incollando pezzi, e l'altra metà erano guasti che non
chiedevano niente: l'owner le apriva, non le capiva e le chiudeva senza
rispondere.

- **Nascita.** Il server lo apre alla nascita di ogni domanda destinata
  all'owner, da qualunque strada: la fermata di un worker, una domanda non
  bloccante su una consegna, `domanda.mjs chiedi` con biglietto di routine o
  locale, il terzo guasto uguale (§ 3.8). Stesso meccanismo di «Gestisci la
  risposta» qui sotto: `compiti/C-n` di tipo `smistamento`, ruolo
  `smistamento`, Opus a sforzo alto, tre tentativi, puntatore alla domanda, le
  reti del pacemaker (una domanda `in_smistamento` senza il suo compito lo
  riceve, un compito orfano si chiude superato).
- **Non lo apre** sulle domande dell'addetto comunicazioni (`soloOwner`,
  § 4.1): nessun compito le legge, e arrivano all'owner come le scrive lui.
- **Stato `in_smistamento`.** La domanda non sta fra quelle da rispondere (in
  Gestione è fra quelle in lavorazione). Il feedback legato resta fermo come
  sempre se la domanda blocca, o va avanti con la provvisoria se non blocca.
- **Fascicolo.** La domanda intera, note per gli agenti comprese; il feedback
  d'origine con conversazione e note; il registro dei principi come per il
  compito della risposta (fuori dall'ambiente dei riservati è `assente`, e il
  passo 2 si salta). Il compito legge testo scritto da altri: è non fidato, e
  quello che scrive nasce non fidato. La fiducia della domanda non cambia.
- **Cosa fa, in ordine** (`routines/roles/smistamento.md`):
  1. **Un guasto o un difetto di uno strumento** (dal gruppo «guasto: …» o dal
     contenuto: spinta rifiutata, permesso negato, clone che non parte,
     strumento vecchio rispetto al server, biglietto sporco) lo tratta lui:
     apre o riusa il feedback del difetto (chiave: nome dello strumento più la
     prima riga del rifiuto; cerca fra gli aperti prima di aprirne uno), mette
     al feedback fermo l'attesa su quello (#903) e lo riprende: torna in coda,
     trattenuto dall'attesa, e riparte da solo alla fusione. La domanda si
     chiude con `esito.smistata = 'guasto'` e un resoconto di tre righe nelle
     note del feedback fermo. Se il guasto chiede davvero l'owner (una fiducia
     da dare, un permesso da scrivere, una chiave da sostituire) il feedback va
     nei Ricevuti con la richiesta giusta (il rombo azzurro per la fiducia, il
     segno «chiede un permesso» per il resto), e la domanda si chiude lo
     stesso (`esito.smistata = 'ricevuti'`). All'owner non arriva mai una
     domanda di guasto.
  2. **Il registro risponde.** Se il principio di una domanda chiusa copre il
     caso, risponde lui: l'opzione che il principio indica, e un testo che
     cita il principio e la domanda da cui viene. La domanda si chiude con
     `esito.automatica = true` (§ 3.6).
  3. **Decide l'owner.** Riscrive la domanda nella forma per l'owner (§ 3.1:
     titolo al più 10 parole, contesto al più 5 righe, problema al più 3, da 2
     a 4 opzioni con pro e contro di una riga e l'azione, consiglio con un
     motivo di una riga, unslop) e la pubblica: stato `aperta`. Se chi ha
     chiesto ha scritto un'opzione sola, aggiunge quelle che il caso ammette
     («Archivia il feedback», «Tenere com'è» per un rilievo esterno, «Rimanda a
     dopo il lancio») senza inventare azioni che chi riprende non può
     eseguire. Priorità, gruppo, collegamenti e `blocca` restano di chi ha
     chiesto, e il suo testo resta intero nelle note per gli agenti: chi
     riprende dopo la risposta legge il problema vero (#1579, punto 1).
- **Operazioni** (intento `smistamento` del canale, `domanda.mjs smista` col
  biglietto): `mostra` (il fascicolo), `guasto` (`chiave`, `titolo`, `testo`,
  `resoconto`), `ricevuti` (`richiesta`: `fiducia` o `permesso`, `testo`),
  `automatica` (`scelta`, `principio`: la domanda chiusa, `testo`), `pubblica`
  (`domanda`, controllata con la validazione comune e la forma per l'owner).
  Ognuna tranne `mostra` chiude il compito.
- **Tentativi.** Un biglietto che finisce senza nessuna delle quattro rimette
  il compito in attesa; al terzo la domanda esce com'è fra quelle da
  rispondere, con `smistamento: 'fallito'`. Niente resta nascosto. È anche la
  rete per un guasto che colpisce il compito stesso: un compito che non può
  girare non trattiene una domanda per sempre. Esce com'è, col segno, anche
  quando nessun agente la prende: a routine spente al giro dopo del
  pacemaker, a routine accese dopo 12 ore senza un biglietto vivo.
- **Migrazione.** Un'operazione del server idempotente (`smista_aperte`),
  lanciata una volta dal pacemaker dopo il deploy, apre il compito per ogni
  domanda oggi `aperta`, destinata all'owner e senza turni dell'owner in
  conversazione.
- **Il manutentore riceve, non smista**: nel suo contesto
  (`npm run manutentore -- contesto`) c'è una riga per ogni domanda aperta o
  in smistamento che ferma un feedback del suo ordine (numero, titolo, da
  quando). Non passa da lui in persona: gira a orari, e una domanda va
  smistata in minuti.

#### «Gestisci la risposta»

- Un compito senza feedback (§ 6), urgenza 47: passa davanti a tutto tranne i
  feedback a priorità 3.
- Lo lavora **Opus col repo**: una decisione capita male costa più di qualunque
  risparmio sul modello.
- Il biglietto nasce con la fiducia della domanda (§ 1.2).
- Non lavora le domande dell'addetto comunicazioni: una risposta scritta su
  una di quelle la riceve l'addetto stesso (§ 4.1).
- Legge la domanda con conversazione e note, i collegamenti e il registro
  delle decisioni, e poi fa una o più di queste cose:
  - apre o aggiorna feedback;
  - riprende il feedback d'origine;
  - scrive un **chiarimento**: aggiunge un turno, e la domanda torna `aperta`
    come mini-conversazione;
  - apre una domanda nuova;
  - scrive il principio (§ 3.6);
  - aggiorna `notePerAgenti`.

Come funziona oggi (#1152):

- **Nascita.** La risposta presa (in lavorazione) fa nascere il compito
  `risposta` (`compiti/C-n`, uno aperto per domanda, puntatore `dq:<id>`; quello dello smistamento ha `ds:<id>`) con
  la fiducia della domanda dopo il turno dell'owner, e la domanda lo nomina in
  `esito.compito.id`. Il pacemaker tiene la rete: una domanda in lavorazione
  senza il suo compito lo riceve (le risposte di prima di #1152 comprese), un
  compito la cui domanda non lo aspetta più si chiude `superato`.
- **Biglietto.** La coda dà i compiti senza feedback con la loro urgenza e
  li conta come una priorità 3: non aspettano nessuno, e li passa solo chi ha
  urgenza più alta. Né il giro su un solo feedback né la chiave dei lavori
  server li prendono. Il semaforo è sul compito (`compito:C-n`); il biglietto
  ha il ruolo `risposta`, nasce pulito solo con compito e domanda fidati e la
  chiave a rete limitata, e la domanda non fidata lo sporca prima che il testo
  esca.
- **Fascicolo.** La domanda intera (conversazione coi turni dell'owner, i suoi
  allegati aperti dal server, `notePerAgenti`), numero, stato e priorità dei
  feedback che nomina. Il registro (§ 3.6) è testo di altre domande, cioè
  riservato (§ 5.1): arriva solo a un biglietto della chiave con `ambiente:
  'riservati'`, e da pulito con i soli principi fidati.
- **Operazioni** (intento `risposta` del canale, `domanda.mjs` col biglietto):
  `mostra`, `chiarimento` (turno `chiarimento`, la domanda torna `aperta` e
  il compito è fatto), `note`, `principio`, `azione`, `chiudi` (resoconto per
  l'owner e principio, la domanda si chiude). Chiarimento e chiusura si
  rifiutano se l'owner ha scritto dopo l'ultima lettura (`domanda_cambiata`).
  `azione` applica solo `riprendi`, `priorita` e `archivia`, e solo sui
  feedback che la domanda nomina: mai un'azione di consenso. Nel feedback
  ripreso il turno dell'owner porta le sue parole lette dalla domanda; la nota
  del compito resta testo d'agente. Feedback e domande che il compito apre
  restano scritti nella conversazione della sua domanda.
- **Tentativi.** Un biglietto che finisce senza chiarire né chiudere rimette
  il compito in attesa; al terzo la domanda torna `aperta` all'owner, con un
  turno del server che lo dice.

### 3.6 Registro, raggruppamento, risposte automatiche

- **Principio.** Ogni domanda chiusa porta, quando c'è, la regola generale che
  la risposta stabilisce («zero fiducia nei crediti dichiarati dal client»).
- **Il registro** sono le domande chiuse col loro principio, interrogabili con
  `domanda.mjs`. Nessun file a parte.
- **Prima di chiedere**, un agente cerca nel registro
  (`domanda.mjs registro <parole>`, che cerca fra i principi delle domande
  chiuse; il registro è riservato, § 5.1, e a un biglietto che non lo può
  leggere arriva `assente` col perché). Se un principio risponde, lo applica e
  lo cita.
- **Risposte automatiche.** Le scrive il compito «Gestisci la domanda» alla
  nascita (§ 3.5, passo 2), non una revisione quotidiana: `esito.automatica`
  le porta nella scheda «Risposte automatiche». L'owner può riaprirle: la
  riapertura rimette la domanda fra quelle da rispondere e segna il principio
  come da rivedere (`principioContestato` sulla domanda da cui viene), così il
  compito non lo riusa finché l'owner non risponde. Un'opzione con un'azione
  che esce (`invia_mail`) non si applica da una risposta automatica: la
  sceglie solo l'owner (§ 1.4), che legge la mail prima che parta.
- **Revisione quotidiana** (§ 4). Lavora sulle domande per l'owner, tranne
  quelle dell'addetto comunicazioni (§ 4.1). Il compito:
  - raggruppa le domande aperte;
  - assorbe in una domanda sola quelle che sono casi dello stesso problema e
    propone il ripensamento del sistema (le assorbite diventano `superata`).
    Una domanda che ferma un lavoro non si assorbe, perché solo la sua
    risposta lo riprende: si raggruppa con le altre del suo caso;
  - rivede le priorità.

### 3.7 Ordine

Prima `bloccante`, poi `importante`, poi `quando_puoi`. Dentro ciascuna, per
gruppo e poi per età. Un gruppo si apre come un blocco solo.

### 3.8 Cosa diventa domanda fra le attese di oggi

| Oggi | Dove va |
|---|---|
| `design` + `clarify`/`decisione` | la domanda che scrive chi si ferma, con almeno due opzioni (`riprendi` e un'altra): il server non ne compone più, e una fermata senza domanda si rifiuta alla consegna, per ogni motivo tranne `locale` (#1790). La segnalazione in markdown (`--segnala`) non c'è più |
| `design` + `locale` | nessuna domanda per il codice del server: un lavoro fidato prende il segno dei lavori server e lo fa la loro routine (#1253); uno non fidato va in Ricevuti L3 come richiesta di renderlo fidato (motivo `fidato`), e «Segna fidato» lo rimette in coda. Diventa domanda solo ciò che chiede il suo PC o un suo passo (una prova sulla sua macchina, segreti, automazioni GitHub), scritta da chi si ferma (#1358) |
| guasto (#1781) | nessuna domanda e nessuna fermata: chi ci cade lo dichiara nel rilascio (`--guasto "<gruppo>: <il messaggio esatto>"`, il gruppo fisso `guasto: <la cosa rotta>`), e il feedback torna in coda sul suo ramo con la nota del guasto (in verifica o al controllo di sicurezza resta dov'è, con la nota). Al terzo guasto uguale di seguito sullo stesso feedback nasce UNA domanda col conteggio, con un'opzione sola, che il compito della § 3.5 smista come guasto (feedback del difetto, attesa). Conta il guasto di chiunque ci lavori, e un esito consegnato in mezzo azzera la fila. Una consegna `design` + `guasto` si rifiuta. Una richiesta all'owner (fiducia, permesso, chiave) va in Ricevuti con la richiesta giusta, mai in una domanda |
| `design` + `attesa_chiusa`, `loop`, `arenato`; `aligned` + `origine_chiusa`/`origine_mancante` | sono fermate del server, non di chi lavora: rimesse in coda girerebbero senza fine (altri giri di correzione, altri arenamenti). Il server apre la domanda di servizio coi fatti e le due strade (riprendi, archivia), che non arriva all'owner così: la riscrive il compito della § 3.5 (#1790). Una fermata di chi lavora rimasta senza domanda viva (da un'altra porta: pipeline, migrazione) torna invece in coda con una nota che dice perché |
| `design` + `secaudit`, `l5`, `fidato`; attacchi, spam (anche segnati dal worker, L3), sospetti | Ricevuti, e nessun altro |

Il feedback in attesa resta `design` (o `aligned`) col suo motivo e prende
`domandaId`: la macchina a stati non cambia. Per l'owner, però, un `design` con una domanda
aperta si vede nella scheda **In coda**, col segno «aspetta una domanda» che
porta alla domanda, e non in Ricevuti. Il dettaglio di come nasce, si risponde e
si migra sta in FEEDBACK-STATES.md §5.

## 4. Compiti ricorrenti, pubblicazione, gestione del lavoro

### 4.1 Compiti ricorrenti

Un compito ricorrente lo scrive l'owner (quindi è fidato): un testo di
istruzioni, una cadenza, un ambito, un'urgenza, un modello e uno sforzo.
All'ora giusta il server ne crea un'istanza: un compito fidato (§ 6) con
`nonPrimaDi`. L'orchestratore lo prende come ogni altro lavoro. Un'istanza non
ancora iniziata quando nasce la successiva si chiude come «superata»: le
istanze non si accumulano.

Un ricorrente lavora con un'istanza alla volta, qualunque porta l'abbia fatta
nascere. Se all'ora giusta una sua istanza è al lavoro, la cadenza salta quel
giro: vale quella al lavoro, come per «Avvia adesso», che in quel caso
rifiuta. Un'istanza nata da un'altra porta (la gestione del lavoro, la risposta
che anticipa l'addetto comunicazioni) aspetta in coda che quella al lavoro
chiuda: la coda non dà mai due istanze dello stesso ricorrente insieme.

Un ruolo generico `compito` esegue il testo del ricorrente. I permessi li dà
l'ambito, non il ruolo. I testi dei ricorrenti stanno nel repo privato del
server (§ 9), non in questa spec.

Ogni istanza chiude con un **rapporto**: cosa ha fatto, cosa ha trovato, da
dove deve ripartire la prossima. Resta legato al ricorrente: l'istanza
successiva lo riceve col biglietto, con la fiducia che aveva. Resta quello
dell'istanza nata per ultima: il rapporto di una più vecchia che chiude dopo
non lo sostituisce. È così che
l'audit sa da quale commit ripartire e la potatura quanti rami sono nuovi.
Riordino e potatura lo scrivono anche nel taccuino della gestione del lavoro
(§ 4.3). Un ricorrente che segue cose lunghe settimane ha anche un
**taccuino** suo sul server, come la gestione del lavoro: oggi l'addetto
comunicazioni, con le opportunità e le loro pratiche.

**L'addetto comunicazioni** è un compito solo con due ambiti in fila (§ 5.1):
prima `opportunita` cerca sul web, poi il server consegna la casella e da lì
vale `posta`, che non esce più. Quello che l'istanza scrive dopo la casella (il
rapporto, la parte del taccuino) è figlio della casella: l'istanza successiva
lo riceve insieme alla casella, non col biglietto. Uno spunto arrivato per mail
non si cerca: diventa una domanda per l'owner.

Le sue domande sono solo per l'owner (`soloOwner`, § 3.1), e nessun altro
compito le legge: né la revisione, né «Gestisci la risposta», né la gestione
del lavoro, che delle sue istanze vede solo i numeri (costo, durata, esito),
non sessioni, registri, taccuino o rapporti. Per la stessa ragione le sue
segnalazioni libere, le sue domande di guasto e le sue risposte alla domanda
di fine turno vanno all'owner, `soloOwner` come le altre sue domande, e non
alla gestione del lavoro (§ 4.3, § 5.4).
Una risposta scritta dell'owner
su una di quelle anticipa l'istanza dell'addetto, che la riceve insieme alla
casella. La mail resta
fra l'addetto comunicazioni e l'owner.

| Quando (ora italiana) | Compito | Ambito | Urgenza | Modello iniziale | Sforzo iniziale |
|---|---|---|---|---|---|
| ogni giorno | revisione delle domande (§ 3.6) | `domande` | 30 | Opus | `high` |
| ogni giorno | addetto comunicazioni: incentivi, crediti, programmi sul web; poi la casella di Filo | `opportunita`, poi `posta` | 30 | Opus | `high` |
| ogni giorno | gestione del lavoro (§ 4.3) | `gestione_lavoro` | 45 | Opus | `high` |
| lunedì | riordino della coda (§ 6.6) | `coda` | 45 | Opus; Haiku da provare (rischia i 100k token) | `high` |
| lunedì | potatura dei rami (§ 4.7) | `rami` | 5 | Opus; Haiku da provare | `high` |
| domenica | audit di sicurezza | `audit` | 45 | Opus | `high` |

Lo sforzo parte da `high`, come nelle fasi di un feedback dopo il primo lavoro
(§ 6.4), perché nessun ricorrente costruisce codice da zero. Modello e sforzo si
vedono e si cambiano su ciascuno, in Routine → Compiti ricorrenti. La gestione
del lavoro (§ 4.3) può lanciare riordino e potatura anche fuori cadenza.

Com'è fatto dal #1153:

- il server semina la tabella una volta, coi testi di `ruoli/` del suo repo; da
  lì un ricorrente si cambia, si spegne, si toglie o si aggiunge solo in Routine
  → Compiti ricorrenti, e uno tolto non torna. Le ore della tabella: revisione
  delle domande 07:00, gestione del lavoro 06:00, addetto comunicazioni 09:00,
  riordino lunedì 01:00, potatura lunedì 02:00, audit domenica 00:30;
- nascono spenti la gestione del lavoro e l'addetto comunicazioni, i cui
  strumenti arrivano coi punti 9 e 14 (§ 13): un'istanza senza i suoi strumenti
  spende e basta;
- il pacemaker fa nascere l'istanza quando l'ora è venuta, con `nonPrimaDi` uguale
  a quell'ora; dopo un fermo ne nasce una sola, e la prossima ora si conta da
  adesso. «Avvia adesso» ne fa nascere una subito;
- il rapporto (`rapporto`) chiude l'istanza e resta sul ricorrente, cifrato, con
  la fiducia e il segno riservato del biglietto che lo scrive. Un compito senza
  esito torna in coda; dopo tre tentativi il server lo ferma;
- la domanda di fine turno di un ricorrente è il suo slot (§ 5.4).

### 4.2 Due canali di aggiornamento

- **Veloce** (com'è oggi): una versione ogni sei ore, il commit più nuovo con la
  suite verde.
- **Stabile** (nuovo): una versione minor il lunedì alle 00:00. Esce solo se non
  c'è nessun feedback di sicurezza a priorità 3 aperto. La domenica l'audit li
  cerca; le routine hanno 24 ore per chiuderli. Se ne resta uno aperto, quella
  settimana la minor non esce: nessuna domanda, lo dice la gestione del lavoro.

L'utente sceglie il canale nelle impostazioni. Il canale stabile è per chi
preferisce un'esperienza più ferma, con le verifiche fatte poco prima.

### 4.3 Gestione del lavoro

> Dal ridisegno del lavoro (SPEC-RIDISEGNO-LAVORO.md, #1680) questo compito diventa il
> **manutentore**: in più decide l'ordine dei feedback, forma i pacchetti e sceglie cosa
> accendere insieme, con tutte le schede in contesto e i rami in corso coi loro file
> (`routines/roles/manutentore.md`, `npm run manutentore -- contesto`). Il resto di questa
> sezione vale ancora dove quella spec non dice altro.

Tre compiti gestiscono il lavoro delle routine: la **gestione del lavoro**, che
decide (fino al 23/10 si chiamava monitoraggio), e il **riordino della coda**
(§ 6.6) e la **potatura dei rami** (§ 4.7), che lavorano per lei. Lo scopo è
uno: fondere più lavoro utile possibile per ogni credito speso, a cominciare
dal più urgente. Decisioni dell'owner del 13/10 e del 23/10.

La gestione del lavoro legge i registri: costi e giri delle routine, fusioni e
tempi, accensioni a vuoto, sessioni, suite, rilasci, esecuzioni in cloud, e
**tutte le domande passate** con le risposte. Dell'addetto comunicazioni vede
solo i numeri (§ 4.1): niente domande, sessioni, registri o taccuino suoi.

- **Il suo contesto è sempre non fidato:** legge testo scritto da chiunque.
  Quindi non scrive codice e non cambia feedback. Apre feedback e domande, e i
  suoi feedback che toccano L5 li approva l'owner (§ 1.5).
- **Lancia riordino e potatura per numeri.** Chiede al server di anticipare
  l'istanza di un ricorrente, al massimo con dei numeri di feedback, mai testo.
  Come per l'unione (§ 1.3), l'istanza nasce fidata e lavora col suo ambito.
- **Riordino e potatura le fanno rapporto:** a fine istanza scrivono nel suo
  taccuino cosa hanno fatto e cosa hanno trovato.
- **Le arrivano i problemi dei worker.** I worker sanno che esiste e le
  segnalano quello che non va: le segnalazioni libere (§ 5.4) vanno a lei, non
  all'owner, tranne quelle dell'addetto comunicazioni, che vanno all'owner
  (§ 4.1). Per ciascuna cerca la causa, apre il feedback della correzione,
  mette il feedback fermo in attesa di quello e lo riprende quando la causa è
  sparita. Quando la segnalazione dice già la causa, il feedback della
  correzione lo fa nascere per numero, come l'unione (§ 1.3): il testo resta
  di chi ha segnalato, con la sua fiducia. Quello che scrive lei nasce non
  fidato.
- **I guasti non passano da lei** (#1790): li smista in minuti il compito
  «Gestisci la domanda» (§ 3.5), che fa lo stesso lavoro (causa, feedback
  della correzione, attesa) e non li manda mai all'owner. A lei arriva, nel
  contesto, una riga per ogni domanda aperta o in smistamento che ferma un
  feedback del suo ordine. Un guasto non anticipa mai l'istanza di chi ci è
  caduto, che cadrebbe di nuovo e ne aprirebbe un altro, in una fila di
  accensioni senza fine.
- **All'owner** arrivano solo le domande di prodotto e le sue, quando dopo
  l'indagine la scelta spetta a lui: soldi, sicurezza, permessi, gusto.
- **Le sue leve:** ritmo e parallelismo (§ 4.5), quando lanciare riordino e
  potatura, indagini ed esperimenti (§ 4.6), la domanda di fine turno dei ruoli
  (§ 5.4), lo spegnimento in emergenza.
- **Non sono sue leve:** la priorità dei feedback, i criteri di verifica, i
  prompt dei ruoli, i blocchi di sicurezza. Può proporre di cambiarli con una
  domanda. Così non può migliorare i suoi indicatori verificando di meno o
  gonfiando le priorità.
- **Spegne in emergenza** routine o account, e riaccende solo quello che ha
  spento lei, mai quello che ha spento l'owner.
- **Taccuino**, persistente sul server: appunti da ricontrollare, ipotesi,
  modifiche in studio, i rapporti di riordino e potatura, i guasti e le
  segnalazioni che segue. Lo legge a ogni accensione.
- **Una sessione al giorno**, che riparte dal taccuino, non un contesto che vive
  per sempre. Un guasto che va a lei le anticipa l'istanza: una sessione al
  giorno non basta a un feedback fermo. Le indagini lunghe le fanno
  sotto-agenti, e il suo contesto resta piccolo.
- **Segue un problema da vicino:**
  - resta accesa quanto serve e si risveglia da sola ogni 55 minuti al
    massimo, così la cache (60 minuti) resta calda;
  - per attese più lunghe chiede al server una **sveglia**, che il pacemaker
    rispetta con un tetto suo, separato da quello del lavoro.
- **Chi controlla lei:** se il server non la vede scrivere nel taccuino da 26
  ore, apre una domanda.

### 4.4 Cosa minimizzare

La gestione del lavoro non ha un numero da massimizzare: qualunque conteggio si
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
chiude tre. I feedback che le routine aprono da sole (audit, gestione del
lavoro) contano solo come spesa. Il costo per radice dipende anche da
cosa c'è in coda, quindi da solo non dice se il processo è migliorato: lo
dicono gli esperimenti (§ 4.6).

### 4.5 Ritmo e parallelismo

- La gestione del lavoro scrive una **curva**: quanti lavori insieme (N, § 12.2) in
  base alla quota usata e alle ore che mancano al rinnovo di ciascun account.
  Il server la applica a ogni battito del pacemaker (10 minuti). La
  gestione del lavoro non è sempre accesa, e a pieno ritmo la quota sale di circa
  1,4% l'ora (26/09: 662 $ in 21,5 ore).
- **Niente tetto.** Bruciare una settimana costa solo un po' di efficienza, in
  riallineamenti: il lavoro resta fatto. Il parallelismo giusto è quello che
  fonde di più, non quello che spende di più. Oltre un certo N i conflitti con
  main crescono, e la gestione del lavoro lo misura.
- **Inizio settimana più pieno:** spendere presto sfrutta un rinnovo
  anticipato, se arriva.
- **Fine quota senza compiti morti.** Vicino al limite la curva scende, per
  esempio 4 lavori fino al 95% e poi 1. Il server dà biglietti solo ai compiti
  il cui costo tipico, per fase e ruolo, sta nella quota rimasta. Abbassare N
  non ferma i lavori in corso (§ 12.2).
- Resta la **riserva dell'owner** su A (§ 8.2). Non è un tetto al
  parallelismo: è la quota per le sessioni locali.
- **Senza curva**, perché la gestione del lavoro non è mai partita o la
  curva è scaduta, vale il passo del § 8.2.

### 4.6 Indagini ed esperimenti

- **Indagini.** Quando un indicatore va male, la gestione del lavoro scende nel
  caso:
  un feedback con molti giri di verifica (per esempio 4 o più), una sessione
  con molto contesto inutile, una fila di compiti morti. Un sotto-agente legge
  i motivi (rilievi dei giri, registro della sessione), e l'ipotesi va nel
  taccuino.
- **Esperimenti.** Un'ipotesi si prova rifacendo un lavoro già fatto con una
  cosa cambiata: prompt del ruolo, modello, sforzo, contesto. Un esperimento è
  un compito con ambito `esperimento`:
  - parte da un commit fissato, lo stato di allora, col numero del feedback;
  - porta il testo alternativo scritto dalla gestione del lavoro, quindi non
    fidato;
  - è riservato (§ 5.1): il testo della gestione del lavoro porta con sé
    quello che lei ha letto. Quindi gira nell'ambiente dei riservati (§ 1.2),
    che non può spingere su GitHub, dove i rami sono pubblici: consegna
    l'esito al server, come dati (il diff e il rapporto);
  - non fonde, non apre feedback né domande;
  - non vede il `main` di oggi: in una copia del repo il ref `main` è quello
    attuale, e un esperimento che lo legge falsa il confronto (lab di Haiku,
    12/10);
  - l'esito lo confronta con l'originale un giudice cieco, un compito con
    ambito `giudizio`: riceve i due esiti dal server senza sapere quale sia
    l'esperimento, ed è riservato anch'esso;
  - non ha la segnalazione libera né la domanda di fine turno (§ 5.4): quello
    che segnalerebbe o risponderebbe lo scrive nell'esito, che legge la
    gestione del lavoro.

  Ha meno permessi di un primo lavoro, per questo lo decide la gestione del
  lavoro da sola, dentro il budget (§ 4.8). L'urgenza dell'esperimento e del
  suo giudice è fissa (§ 6.3): la gestione del lavoro non la sceglie.
- **Proposte.** Se un esperimento conferma l'ipotesi, la gestione del lavoro
  apre una domanda con la modifica (a un prompt, ai criteri, a una regola) e le prove.
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
- Il rapporto va alla gestione del lavoro (§ 4.3).

### 4.8 Budget e rapporto settimanale

- **Budget:** 200 € a settimana per tutta la manutenzione del processo:
  sessioni della gestione del lavoro, indagini, esperimenti, e le pulizie della coda e
  dei rami (riordino e potatura, anche quelle del lunedì). È circa
  il 10% della settimana di un account (§ 8.1). La gestione del lavoro lo divide
  come crede; sforare di poco va bene. Si conta come nei rapporti delle routine.
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
- **La triade segue il testo.** Il testo libero porta con sé quello che ha
  visto chi lo scrive, quindi la triade non si guarda solo sulle operazioni di
  un ambito:
  - un biglietto che riceve dati privati diventa **riservato**. Sono dati
    privati la casella e quello che ne è figlio (§ 4.1), le sessioni e i
    registri, i testi di feedback e domande che non sono del suo lavoro;
  - come lo sporco (§ 1.2), il segno non si toglie e passa a quello che il
    biglietto scrive; numeri, ruoli e dati strutturati non lo portano (§ 1.3);
  - un compito che nasce da testo riservato, o lo riceve, è riservato e per la
    triade vede dati privati. Quindi non agisce verso l'esterno: gira
    nell'ambiente dei riservati (§ 1.2), che esce solo verso il server e non
    può spingere su GitHub, dove i rami sono pubblici, e non fa partire azioni
    che escono (§ 3.6);
  - il segno si prende alla consegna, l'ambiente si sceglie quando la sessione
    parte e non cambia dopo. Quindi **il server consegna testo riservato solo
    a un biglietto che gira già nell'ambiente dei riservati**, e a ogni altro
    lo rifiuta, come rifiuta le ricerche alla posta dopo la casella. Chi lo
    legge per mestiere parte lì: oggi l'addetto comunicazioni, la gestione del
    lavoro, l'audit, la revisione delle domande, «Gestisci la risposta», il
    riordino della coda, la potatura dei rami, gli esperimenti e il loro
    giudice (§ 4.6);
    l'unione e i compiti figli (§ 12.2) quando uno dei testi che riceveranno è
    riservato, cosa che il server sa già quando li crea. Le eccezioni sono
    due, tutte e due limiti accettati dall'owner: il lavoro su un feedback,
    qui sotto, e la domanda di fine turno della gestione del lavoro (§ 5.4).
    Un'eccezione nuova non si aggiunge senza una sua decisione.
- **Limite accettato dall'owner (21/10):** un feedback aperto o cambiato da
  un biglietto riservato (l'addetto comunicazioni dalle mail degli utenti, la
  gestione del lavoro, l'audit, «Gestisci la risposta») è testo riservato, ma
  il lavoro su un feedback spinge il suo ramo sul repo pubblico. Quel lavoro
  è un'eccezione alla regola sopra e va come gli altri: per portare fuori dati
  privati da qui vanno ingannati due agenti di fila, chi apre il feedback e
  chi lo lavora. L'owner ha scartato sia la lettura in Ricevuti di quei
  feedback sia i rami su un repo privato: non è un difetto da segnalare.
- **Nessun ambito** può approvare blocchi di sicurezza, cambiare la fiducia,
  creare ambiti o toccare le chiavi.
- **I segreti** stanno solo nell'ambiente cloud del compito che li usa. Gli
  ambienti li crea l'owner.
- **La casella di posta** la legge e la scrive solo il server: le credenziali
  non arrivano mai a un agente. Chi legge la posta legge testo non fidato, e
  con la password potrebbe anche spedire. L'agente riceve i messaggi come dati
  e propone bozze; il server manda quelle approvate (azione `invia_mail`,
  § 3.3).
- **Due ambiti in fila.** Un compito che deve sia uscire sia leggere dati
  privati li fa in due tempi, con due ambiti: oggi solo l'addetto
  comunicazioni (§ 4.1). Gira dall'inizio nell'ambiente dei riservati
  (§ 1.2), dove l'unica uscita è il server: le ricerche sul web le fa il
  server per lui, come la posta, quindi le vede e le può fermare. Quando
  l'agente chiede la casella, il server passa il biglietto da `opportunita` a
  `posta` prima di consegnarla, e da lì rifiuta ogni ricerca.
  Non si torna indietro.

### 5.2 Gli ambiti iniziali

| Ambito | Può | Non può |
|---|---|---|
| `lavoro` | lavorare il suo feedback, spingere il suo ramo, chiedere la fusione, aprire feedback e domande | tutto il resto |
| `coda` | leggere i feedback **in coda** (non quelli in Ricevuti né quelli fermi per attacco), cambiare priorità, chiedere un biglietto di unione (§ 1.3), archiviare, scrivere nel taccuino della gestione del lavoro | scrivere testi di feedback, cancellare, toccare Ricevuti |
| `unisci` | leggere i genitori indicati, scrivere il figlio, chiudere i genitori col rimando | leggere altro |
| `domande` | leggere le domande per l'owner, tranne quelle dell'addetto comunicazioni, e il registro; raggruppare, cambiare priorità, rispondere coi principi | rispondere senza un principio, cambiare i principi |
| `opportunita` | cercare sul web attraverso il server; leggere la parte del suo taccuino scritta prima della casella e scriverci; aprire domande con bozze di mail, solo per l'owner; chiedere la casella, che passa il biglietto all'ambito `posta` (§ 5.1) | ricevere la casella e quello che ne è figlio (la parte del taccuino scritta dopo, il rapporto dell'istanza prima); mandare mail |
| `posta` | ricevere dal server i messaggi della casella di Filo, con la parte del taccuino scritta dopo la casella e il rapporto dell'istanza prima; tenere il suo taccuino; aprire domande con bozze di mail, solo per l'owner; aprire feedback dalle mail degli utenti | uscire in rete, nemmeno attraverso il server; tornare all'ambito `opportunita`; mandare mail; vedere le credenziali della casella |
| `gestione_lavoro` | leggere registri, sessioni, domande passate, feedback e rami; il suo taccuino; ricevere le segnalazioni, tranne quelle dell'addetto comunicazioni (§ 4.3), e le righe delle domande che fermano un feedback del suo ordine; far nascere per numero un feedback da una segnalazione; scrivere la curva del parallelismo (§ 4.5); anticipare riordino e potatura; lanciare esperimenti nel budget; cambiare la domanda di fine turno; spegnere, e riaccendere quello che ha spento lei; chiedere una sveglia; aprire domande e feedback | scrivere codice; cambiare feedback, priorità, criteri di verifica, prompt dei ruoli; smistare o rispondere alle domande (lo fa il compito della § 3.5); leggere dell'addetto comunicazioni altro che i numeri (domande, segnalazioni, sessioni, registri, taccuino, rapporti); riaccendere quello che ha spento l'owner |
| `rami` | leggere rami, storia di git e feedback; aprire feedback e domande; scrivere nel taccuino della gestione del lavoro | cancellare rami: lo fa la regola del server (§ 4.7) |
| `audit` | leggere il codice di Filo e del server, i metadati dei feedback aperti e i testi che servono; provare il codice nel contenitore; aprire feedback e domande | spingere rami, chiedere fusioni, cambiare feedback |
| `esperimento` | lavorare dal commit indicato nell'ambiente dei riservati (§ 1.2); consegnare l'esito al server, come dati | fondere, aprire feedback o domande, spingere su GitHub, uscire in rete, leggere il `main` di oggi |
| `giudizio` | ricevere dal server l'esito di un esperimento e quello dell'originale, senza sapere quale sia quale; consegnare il verdetto | tutto il resto, uscire in rete compreso |
| `server` | come `lavoro`, più spingere un ramo su filo-security (§ 7) | — solo per biglietti puliti |

L'elenco chiuso delle operazioni e questa tabella vivono come dati in
`src/shared/ambiti.js` (#1153), che il server incorpora al deploy; una sentinella
la confronta con questa tabella. Ogni operazione dice quale gamba della triade
tocca, e una sentinella la controlla su ogni ambito. Un'operazione dell'ambito
che il server non fa ancora (il taccuino, la curva, i principi) è rifiutata col
suo nome, come una fuori ambito; `opportunita`, `posta`, `esperimento` e
`giudizio` non si possono ancora dare a un compito. Le operazioni passano dal
canale (`routine-channel.mjs operazione`, `segnala`, `rapporto`).

L'ambiente dei riservati lo dichiara la chiave della sua routine
(`routine-keys.mjs ambiente <nome> riservati`): i suoi biglietti ricevono solo
compiti, e soltanto loro il testo riservato. Finché nessuna chiave lo dichiara,
i compiti che lo leggono aspettano, e la Gestione lo dice. Il pacemaker conta il
lavoro di ogni account con rete e ambiente delle sue chiavi: un'istanza pronta
accende la routine dei riservati anche a coda vuota, e un feedback non la
accende mai.

### 5.3 Ambiti nuovi

Un agente che ne ha bisogno apre una domanda con la proposta: le operazioni,
cosa non può, il controllo della triade. L'azione `ambito` la approva, e da lì
vale per tutti i compiti di quel tipo.

### 5.4 Segnalazioni e domanda di fine turno

- **Domanda di fine turno:** si può impostare per **ogni ruolo**, compiti
  compresi, o per tutti insieme, come oggi per le routine. Serve a indagare
  una cosa precisa. Quella scritta dalla gestione del lavoro arriva a tutti i
  ruoli, come quella scritta dall'owner (D-141).
- **La domanda della gestione del lavoro arriva dopo l'ultima scrittura.** È
  testo non fidato e sporca chi la riceve (§ 1.2). Quindi il server la
  consegna solo al rilascio, dopo la consegna dell'esito e il salvataggio del
  ramo; da lì il rilascio non salva più niente e la risposta va al server. Il
  ramo resta scritto da un biglietto pulito e il lavoro resta fidato (§ 1.5).
  Una spinta sul ramo arrivata dopo la consegna della domanda è del biglietto
  sporco: il lavoro diventa non fidato.
- **Limite accettato dall'owner (23/10), accanto a quello dei feedback
  (§ 5.1):** la domanda della gestione del lavoro è testo riservato, e chi la
  riceve fuori dall'ambiente dei riservati può ancora scrivere un file che il
  salvataggio automatico spinge sul repo pubblico. Per portare fuori dati privati da qui
  vanno ingannati due agenti di fila, la gestione del lavoro e chi riceve la
  domanda. La posta non c'è, perché dell'addetto comunicazioni la gestione del
  lavoro vede solo i numeri (§ 4.1): da una mail servono tre agenti
  ingannati, l'addetto che ne apre un feedback, la gestione del lavoro che lo
  legge e chi riceve la domanda.
- **Segnalazione libera:** ogni biglietto ha un comando `segnala "testo"` anche
  senza domanda. Serve per un errore avuto, un problema trovato, un permesso
  che mancava. Il server la consegna alla **gestione del lavoro** (§ 4.3), non
  all'owner, con la fiducia del biglietto; quelle dell'addetto comunicazioni
  vanno all'owner (§ 4.1). Lei ne cerca la causa e, se serve,
  apre il feedback della correzione o lo fa nascere dalla segnalazione per
  numero. Una richiesta di permessi la trasforma in una proposta d'ambito
  (§ 5.3), che decide l'owner.
- **Gli esperimenti** non hanno né l'una né l'altra: scrivono tutto nell'esito
  (§ 4.6).

Dal #1153 la segnalazione libera è `segnala`, che ogni biglietto delle routine
può fare: un feedback con `tipo: 'segnalazione'`, priorità 0 e la fiducia del
biglietto, finché il punto 9 non la manda alla gestione del lavoro. Conta nel
tetto delle consegne del biglietto, come un feedback aperto. La domanda di
fine turno ha gli slot `tutti`, `orchestrator`, `worker`, uno per ruolo
(`compito` compreso) e `compito:<ricorrente>`; vale il più preciso.

## 6. Feedback e compiti

Due oggetti, decisi dall'owner il 12/10:

- **Feedback**: una cosa da fare, segnalata da un utente, da un agente o
  dall'owner. Ha una **priorità** da 0 a 3 e, se è un cambio di codice, il suo
  ciclo: ramo, verifica, controllo cieco, fusione. Non porta un modello.
- **Compito**: una chiamata di un agente. Ha **urgenza**, **modello**,
  **sforzo**, **ambito**, fiducia e, se c'è, il feedback a cui è legato con la
  sua **fase**, o il compito padre se è un figlio (§ 12.2). Il biglietto è un
  tentativo di eseguire un compito: un compito ne può avere più di uno, per
  esempio dopo un arenamento.

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
Invariante, con sentinella: al massimo un compito di fase aperto per feedback.
I compiti figli, qui sotto, non contano.

**Senza feedback:** le istanze dei ricorrenti (§ 4.1), «Gestisci la risposta»
(§ 3.5), l'unione (§ 1.3), gli esperimenti della gestione del lavoro (§ 4.6),
che rifanno un lavoro già fatto ma non sono una fase del suo feedback, e i
compiti creati a mano dall'owner o da una sessione locale.

**Da un altro compito:** i figli (§ 12.2). Un figlio è legato al compito padre,
non al feedback, e al feedback arriva attraverso il padre. Così un padre di fase
con i suoi figli aperti resta, per l'invariante, un compito solo. I figli
seguono il padre: quando il trigger o il pacemaker ne ricalcola l'urgenza
o lo chiude come «superato», lo stesso vale per i figli ancora aperti.

**Non sono compiti**, perché non chiamano un agente: la fusione (la fa il
server), l'invio di una mail approvata (lo fa il server, § 5.1), il blocco di
sicurezza (diventa una domanda), la segnalazione (va alla gestione del lavoro, § 5.4).

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
| Gestione del lavoro, audit di sicurezza, riordino della coda | 45 |
| Esperimento della gestione del lavoro, e il giudice cieco che ne confronta l'esito (§ 4.6) | 44 |
| Revisione delle domande, addetto comunicazioni | 30 |
| Unione di feedback | 20 |
| Potatura dei rami | 5 |

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
- **Compiti senza feedback:** dal ricorrente (§ 4.1) o da chi crea il compito.
  «Gestisci la risposta» resta Opus (§ 3.5), sforzo `high`.
- **Compiti figli** (§ 12.2): modello e sforzo del padre.
- Ogni agente può lanciare sotto-agenti, fino a tre livelli sotto la sessione
  principale, e sceglierne il modello.

Il server manda modello e sforzo col biglietto (#1192), presi dal compito
(#1196), che per le fasi li prende da `config/routines.roleModels` (la scelta
per fase, scrivibile in Automazioni con #1193). Il gancio che li impone è
#1189. `model` ed `effort` sul feedback non li legge più nessuno.

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
  rapporto va alla gestione del lavoro, che può anche lanciare il riordino
  fuori cadenza (§ 4.3).
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
    (`routine-channel.mjs git-server`, #1233), che chiede il token al server:
    il sì o il no si decide lì. In locale il token va solo a quella chiamata,
    nell'URL riscritto; in cloud non si usa, e autentica il proxy della
    sessione, che serve solo i repository agganciati alla routine (#1761). Le
    due strade stanno nella sezione 14 di ROUTINE-AUTH-SPEC.md;
  - il worker non se ne accorge;
  - alla chiusura del biglietto il server revoca il token in corso.

  Rispetto a un token da 24 ore, così un biglietto che si sporca perde l'accesso
  entro l'ora, e uno chiuso subito.

  Il server lo dà solo a un biglietto pulito su un feedback fidato, e non lo
  rinnova a un biglietto che si è sporcato. In locale il worker clona
  filo-security con quel token e spinge il suo ramo; in cloud, dove la rete
  la apre il proxy, quel limite lo tiene git-server chiedendo il sì a ogni
  chiamata.
- **Una routine a parte (#1253).** Dalla cloud il clone passa solo se la routine
  ha filo-security fra i suoi repo: il proxy della sessione vede solo quelli.
  Quindi i lavori server li fa una routine dedicata, con Filo e filo-security
  collegati e la rete limitata:
  - la sua parola d'ordine ha `lavori: server` (`routine-keys.mjs lavori`) e
    riceve solo lavori server fidati; le altre chiavi non
    ricevono mai lavoro server, salvo il controllo di sicurezza, che legge il
    diff dal server senza clonare;
  - ce n'è una per account (#1426), e il pacemaker le accende con voci sue,
    fuori dall'alternanza della routine normale: A con `routineIdServer` e il
    segreto `CC_ROUTINE_FIRE_TOKEN_SERVER`, B con `routineIdServerB` e
    `CC_ROUTINE_FIRE_TOKEN_SERVER_B`. Una voce senza id o senza segreto non
    esiste, e accende solo con la sua parola d'ordine server (`lavori: server`,
    rete limitata) sul suo account; una parola d'ordine server senza account
    vale per A. Una parola d'ordine server a rete aperta viva sul suo account
    la ferma, e il log del pacemaker la nomina a ogni giro (#1251);
  - accende solo se c'è un lavoro server che nascerebbe pulito. Decide prima
    di A/B, che altrimenti riempirebbero ogni posto, e prende i posti che
    spettano ai lavori server nell'ordine di priorità della coda: a pari
    priorità il server, e un lavoro normale più urgente non lo ferma se A/B non
    possono accendere;
  - fra le due voci sceglie con le regole di A/B, senza tetto giornaliero
    (#996): pausa a chi fallisce o nasce morta, riserva dei crediti, account
    prioritario, alternanza. La pausa di ogni voce, col motivo, si legge in
    Gestione → Automazioni. Una voce si ferma con l'account
    escluso o con la sua esclusione (`accountServerOff`, `accountServerBOff`);
    il tetto delle sessioni è comune.
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
- **Passo:** lo decide la curva della gestione del lavoro (§ 4.5). Senza curva, ogni
  giorno si spende al massimo il rimasto diviso i giorni che mancano al
  rinnovo.
- **Ordine:** quello della coda, cioè l'urgenza dei compiti (§ 6.3). Il passo
  e la riserva dicono quanto si spende, non cosa viene prima: la priorità 3
  resta sopra le risposte e i ricorrenti.
- **Fine settimana:** nelle ultime 24 ore prima del rinnovo la quota non spesa
  si perderebbe, quindi si apre alle priorità basse (0 e 1).
- **Controllo:** la gestione del lavoro confronta speso e passo, e apre una domanda se
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

> Superato da SPEC-RIDISEGNO-LAVORO.md (#1680): niente orchestratore, il server accende una
> sessione per ogni feedback scelto dal manutentore e la sessione lavora da sé
> (`routines/roles/sessione.md`). Questa sezione resta come storia, e descrive com'è oggi
> finché il server non accende così.

### 12.1 Oggi

- Il pacemaker accende fino a `maxSessions` orchestratori, una sessione cloud
  ciascuno. Ogni orchestratore fa lavorare un worker alla volta, in fila.
- Un orchestratore chiude quando:
  - la coda è vuota;
  - il suo contesto supera il 70%;
  - c'è un guasto o arriva un limite di sessione.
- Il pacemaker ne riaccende un altro dai battiti. Nessun tetto giornaliero
  (#996): un'accensione che claude.ai rifiuta mette l'account in pausa, e
  Gestione → Automazioni ne dice il motivo.
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
- **N lo decide la curva della gestione del lavoro** (§ 4.5), applicata dal server.
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

- **Una copia del repo per worker.** Accesa per il worker singolo (#1182): in
  cloud dispatch lo porta nel clone 1 e la cartella della sessione resta su
  main. Due worker lavorano su rami diversi, ma hanno bisogno
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
  l'orchestratore li lancia come gli altri, dentro N e K. I figli sono legati
  al padre, non al feedback (§ 6.1), e ne ereditano urgenza, modello e
  sforzo, e la fiducia che il padre ha in quel momento. Il padre aspetta i loro esiti
  dal server.
  Le chiusure a metà e i crash li segue la gestione del lavoro.
- **Le prove** non devono contendersi display virtuali, porte o cartelle: vanno
  provate con 2, 3 e 4 worker insieme.
- **Account:** ogni orchestratore consuma dall'account che lo ha acceso.
  Accende su A solo sotto il 90% (§ 8.2).

## 13. Ordine di lavoro

Ogni punto è un feedback fidato. Finché il § 7 non è fatto, i punti *server* si
lavorano in locale.

1. *server*: biglietti che si sporcano, campo `fiducia`, migrazione, spareggio
   provvisorio (§ 1.6; lo sostituisce l'urgenza al punto 5), L5 decisa dalla
   fiducia, fine di `mergePreapproved`, sessioni cloud dei lavori fidati senza
   strumenti web propri.
2. *server*: collezione `domande`, regole, operazioni, azioni strutturate.
3. App: barra delle sezioni, sezione Domande, Ricevuti coi filtri L1–L5.
4. Le attese di oggi diventano domande (§ 3.8); `domanda.mjs` per tutti.
   Le domande di guasto vanno all'owner fino al punto 9 (dal #1790 non ne
   nascono più: § 3.8).
5. *server*: compiti (§ 6): collezione, funzione delle fasi col trigger e il
   controllo nel pacemaker, urgenza al posto dell'ordine di oggi, biglietto
   legato al compito, modello e sforzo dal compito, segno riservato che segue
   il testo (§ 5.1) e ambiente dei riservati (§ 1.2: uscita solo verso il
   server, senza scrittura su GitHub e senza salvataggio automatico), prima
   di ogni compito che legge testo riservato; app: scheda Routine → Compiti.
   Serve ai punti 6 e 8.
6. Compito «Gestisci la risposta», chiarimenti, «discutiamone», note per gli
   agenti.
7. Registro, revisione quotidiana, risposte automatiche.
8. Compiti ricorrenti, ruolo `compito`, ambiti `coda`/`unisci`/`domande`/
   `gestione_lavoro`/`rami`/`audit`, rapporto che passa all'istanza
   successiva, domanda di fine turno per tutti i ruoli.
9. Gestione del lavoro (§ 4.3–4.8): taccuino, sveglie, controllo della
   gestione del lavoro, segnalazioni e domande di guasto che vanno a lei
   (campo `destinatario`, che manda all'owner i guasti dell'ambiente dei
   riservati; istanza anticipata da un guasto, mai quella di chi l'ha aperto;
   feedback per numero, azione `attendi`), la sua domanda di fine turno consegnata dopo
   l'ultima scrittura (§ 5.4), lanci per numeri, curva del parallelismo applicata dal
   server, indicatori, ambiti `esperimento` e `giudizio` con l'esito
   consegnato al server, budget, rapporto settimanale,
   potatura per regola sul server, azioni `esperimento` e `cancella_rami`.
10. Crediti (§ 8), dopo la conferma dei numeri.
11. Lavori server dalla cloud (§ 7).
12. Istruzioni dei ruoli sul server (§ 9).
13. Canale stabile (§ 4.2).
14. Addetto comunicazioni: il server legge e scrive la casella con le sue
    credenziali e cerca sul web per il compito, che gira nell'ambiente dei
    riservati, ambiti `opportunita` e `posta` col passaggio dall'uno
    all'altro, azione `invia_mail` coi solleciti, taccuino, domande
    `soloOwner` con le risposte scritte che tornano all'addetto.
15. Mittenti normalizzati (§ 10).
16. Cartella padre per le sessioni cloud (§ 11).
17. Orchestratore Haiku con worker in parallelo (§ 12): prima la misura di K e
    il salvataggio per cartella.

I punti 1–4 danno già il risultato principale: un posto solo, con le domande
ordinate per priorità e i blocchi di sicurezza letti sul testo originale.
