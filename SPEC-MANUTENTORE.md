# Il manutentore: far funzionare il sistema, e migliorarlo

Decisioni dell'owner del 31/10/2026 (chat). Rivede SPEC-RIDISEGNO-LAVORO.md § 2
(il manutentore come regista dell'ordine) e sostituisce SPEC-DOMANDE.md § 4.3–4.8
per tutto ciò che riguarda il manutentore; assorbe #1155 (monitoraggio con
taccuino e sveglie). Quelle sezioni restano valide dove questa non dice altro.

## 1. Compito

Il manutentore fa quello che oggi fanno gli sviluppatori che «coordinano gli
agenti»: fa in modo che il sistema di Filo funzioni e che migliori. Non fa i
singoli lavori. Tre facce dello stesso compito:

- **regia**: decide cosa si lavora, in che ordine, quanto in parallelo;
- **pronto soccorso**: un guasto, un deploy rosso, un lavoro che gira a vuoto
  si indagano al primo segnale, e si riaggiusta il lavoro perché prosegua;
- **ricerca**: ogni cosa sospetta è un'opportunità. Cerca dati nuovi (quali
  strumenti falliscono, quanto aspettano i modelli, dove si spende senza
  fondere), propone e fa esperimenti dal vivo, misura cosa hanno portato.

Il suo contesto è testo scritto da chiunque, quindi è **non fidato**: non
scrive codice, non fonde, non approva L5. Scrive ordini che il server applica
e apre feedback che le routine lavorano.

Modello: **Opus** a sforzo high (scelta dell'owner del 4 novembre: Fable
consuma più in fretta il limite settimanale, quello che ferma le routine, e ha
un suo tetto dentro il limite comune).

## 2. La scala delle priorità

La priorità non è una coda: dice quanto una cosa conta. Il posto in coda lo dà
l'**ordine** del manutentore, l'unica condizione per cominciare (#2269): un
primo lavoro nell'ordine parte qualunque sia la sua priorità da 0 a 2, fuori
dall'ordine parte solo una 3. Con l'ordine vuoto o senza lavori pronti il
server accende per urgenza, come ripiego, e solo lì le basse aspettano l'ultimo
giorno prima del rinnovo.

| | cosa | chi la mette | come si lavora |
|---|---|---|---|
| **3** | urgentissimo, a prescindere dall'efficienza: buchi di sicurezza, funzioni che l'owner vuole subito e per cui accetta un riallineamento | owner, giudici, manutentore (può crearne, **non toglierne**) | parte subito, sempre in parallelo, fuori da ogni ordine |
| **2** | importante: la classe che passa per prima quando il manutentore sceglie l'ordine | manutentore (e owner) | parte quando è nell'ordine |
| **1** | da fare | manutentore, owner, giudici, rilievi delle verifiche | parte quando è nell'ordine |
| **0** | da fare idealmente, rimandato a lungo termine: difetti minori per cui lo sforzo oggi non vale (un difetto grafico fra scroll e zoom, un errore raro senza danni permanenti) | manutentore (e owner) | parte quando è nell'ordine, e di rado ci entra; ne esistono infiniti |

La priorità da 0 a 2 è la **classe**: il primo criterio con cui il manutentore
sceglie l'ordine, non un filtro (§ 4). La soglia fra le classi si muove con la
maturità di Filo e con i token disponibili; la decide il manutentore, e la
scrive nel taccuino quando cambia il criterio. I rilievi delle verifiche che
diventano feedback nascono a 1, salvo un rilievo esterno di livello 3 che
nasce a 3; i bilanci dei giri per livello non cambiano.

**Tetti.** I tetti per priorità di oggi (6 lavori a priorità 3 insieme, 4 a
priorità 2) spariscono: li sostituiscono le priorità 3 che partono sempre e il
**parallelismo N** scritto dal manutentore per il resto. Resta un solo freno
d'emergenza dell'owner in Gestione → Automazioni: il massimo di sessioni
insieme (default 20), che il manutentore non può alzare. Restano la pausa
crescente del pacemaker sulle accensioni nate morte e il tetto sulle richieste
al minuto.

**Transizione.** Le centinaia di priorità 2 in coda oggi scendono a 1 in un
colpo. Nessuna segnalazione si perde: cambia solo quante 2 si vedono in
Gestione. Dal #2269 non c'è più una scelta quotidiana delle 2: la prima
mattina dopo, il manutentore toglie dal taccuino le regole che la descrivevano.

## 3. Cosa può fare, e cosa no

Può, da solo e senza passare dall'owner:

- scrivere l'**ordine** dei feedback e dei compiti e il **parallelismo N**; il
  server accende una sessione per lavoro nell'ordine, fino a N, come in #1680,
  e le sessioni libere (compiti, sessioni accese a mano) seguono la stessa
  sequenza;
- cambiare le **priorità** (0, 1, 2; creare 3; mai abbassare una 3);
- comporre **pacchetti** (SPEC-RIDISEGNO-LAVORO § 3.1) e mettere **attese**
  fra feedback;
- aprire feedback e domande; archiviare doppioni e mettere note; **sbloccare
  un lavoro fermo per guasto** (§ 7);
- **spegnere e riaccendere** un account o le routine, e scegliere quale account
  usare prima (di norma B, poi A: non c'è più la riserva del 10% su A, perché
  anche a quote finite Filo resta usabile con i crediti API dell'account);
- fare **esperimenti** dal vivo entro i paletti del § 6;
- chiedere ai worker **dati nuovi** (registrazioni al rilascio), via feedback;
- riscrivere le **novità** prima di un rilascio (§ 8);
- cambiare la domanda di fine turno dei ruoli.

Non può: scrivere codice, fondere, approvare L5, rispondere alle domande
dell'owner (quelle di processo dei worker sì: § 4), alzare il freno
d'emergenza.

## 4. Ritmo: una decisione al giorno, e sveglie

**La decisione del mattino, ogni giorno.** Legge tutte le schede (una riga per
feedback, ~800 oggi), le indicazioni dell'owner nel taccuino, i rami vivi coi
loro file, la spesa della settimana per account. Scrive: le classi dove il
criterio le cambia, l'ordine, N, i pacchetti, le attese. È l'unica lettura intera: ~240k token,
una volta al giorno. Prima della lettura il censimento delle schede parte da
lui: Haiku scrive quelle mancanti o vecchie, Opus rilegge quelle che tolgono
lavoro e un campione.

**A secco.** Un'indicazione dell'owner nel taccuino chiede la prova a secco:
finché c'è, nessuna accensione (mattino, battito, sveglia) cambia il lavoro;
quello che avrebbe fatto lo scrive come proposta nel taccuino, e al mattino
nel recap. La toglie la decisione del mattino del giorno dopo, o l'owner.

**Fra una decisione e l'altra non resta sveglio: si fa svegliare.** Ogni
accensione è una sessione nuova con un contesto piccolo (ruolo, taccuino,
schede dei lavori nell'ordine e a priorità 3, rami vivi, segnali dall'ultima
volta: ~25k token) e la memoria nel taccuino (§ 5). Si accende:

- a un **battito** ogni 55 minuti al massimo, per guardare biglietti, guasti,
  deploy, suite, domande di processo;
- a una **sveglia del server** al segnale, senza aspettare il battito: guasto
  dichiarato, deploy del server rosso, suite rossa su main, accensione nata
  morta, domanda di processo di un worker, richiesta dell'owner dalla chat;
- **quando segue un problema**, più spesso: chiede lui al server la prossima
  sveglia (minimo 5 minuti), e il pacemaker la rispetta con un tetto suo,
  separato da quello del lavoro.

Fermo su un guasto suo, invece, valgono solo le accensioni del § 7.

**L'ordine (#2269).** A ogni battito e sveglia l'ordine contiene almeno 2×N
lavori che possono partire subito (quelli in attesa, fermi o in mano all'owner
non contano); se mancano, il manutentore lo allunga coi criteri del mattino.
La spesa si regola con N, non svuotando l'ordine. La classe è il primo
criterio, non un filtro: un lavoro che tocca i file di un ramo vivo aspetta, e
intanto entra uno di classe più bassa in un'area libera. L'ordine porta anche
compiti senza feedback, e un compito può stare davanti a un feedback; un
feedback può aspettare un compito, e l'attesa si scioglie quando il compito
chiude. Un lavoro già iniziato non si mette in attesa di uno non iniziato. Un
feedback fidato entra nell'ordine anche senza il segno «lavoro server», che il
server mette da sé e che non sta fra le cose che aspettano l'owner.

**Cache.** Il manutentore vuole la cache a **un'ora**: il battito ogni 55
minuti la tiene calda a costo di una rilettura. Se le sessioni cloud non
permettono di sceglierla (oggi i worker girano a cinque minuti, e in locale la
decide l'app), il contesto piccolo delle sveglie tiene comunque il costo basso:
è la lettura intera che non si ripete. Misurato il 05/11/2026 (§ 6): nemmeno
per lui l'ora conviene.

**Domande di processo dei worker.** Un worker che si ferma su un dubbio di
processo (quale strumento, quale ordine, cosa fare di un rilievo) lo scrive nel
rilascio come domanda al manutentore, non all'owner: il server lo sveglia, lui
risponde nel feedback con una nota, il lavoro riparte. All'owner arrivano solo
le scelte vere (SPEC-DOMANDE § 3).

## 5. Il taccuino

Un documento sul server, letto a ogni accensione e riscritto alla fine. Dentro:

- **stato**: criterio del giorno per le priorità, N e perché, account in uso;
- **problemi che sta seguendo**, uno per riga: segnale, ipotesi, prossimo
  controllo e quando;
- **esperimenti** in corso e conclusi, con misura prima e dopo;
- **indicazioni dell'owner**, con la data («priorità a ciò che cambia la
  grafica», 31/10): la decisione del mattino le legge, il recap dice come le
  ha applicate; le toglie l'owner o il manutentore quando sono esaurite;
- **misure** che tiene d'occhio (fusioni al giorno, costo per fusione,
  riallineamenti, guasti per famiglia).

Il taccuino sopravvive al PC spento, ai compattamenti e a una sessione morta.
Il registro delle decisioni (#1154, i principi delle domande chiuse) resta a
parte e lo legge insieme.

## 6. Dati ed esperimenti

**Dati.** Oggi i biglietti registrano costo e strumenti usati, non quali
strumenti falliscono né quanto aspettano i modelli. Il primo dato nuovo: al
rilascio ogni worker registra gli **strumenti falliti** (nome, errore in una
riga, cosa ha fatto dopo) e le **attese** sopra i 30 secondi (cosa aspettava,
quanto). Altri dati li chiede il manutentore con un feedback, quando un
sospetto lo richiede.

**Esperimenti dal vivo**, quattro paletti: dichiarato nel taccuino prima di
partire, con la misura che deciderà; uno alla volta; reversibile con un
comando; raccontato nel recap del mattino. Niente esperimenti sui modelli che
fanno il lavoro (provare un modello piccolo dal vivo no; cambiare un
parametro di cache sì).

**Cache a un'ora per i sotto-agenti: chiuso il 05/11/2026 (#2121), si resta a
cinque minuti.** Su un giorno (491 biglietti con rapporto) la cache scritta era
304 $ su 1.104 $ di spesa, le riscritture il 9,6 % di quella (29 $): l'ora
costerebbe 183 $ al giorno in più contro un risparmio massimo di 27 $ (saldo
−155 $; converrebbe sopra il 62 % di riscrittura), e nessun ruolo si avvicina.
Le riscritture vengono dalle attese in primo piano oltre i cinque minuti: la
leva è la disciplina dei pezzi da quattro minuti (#2185), non il TTL. Il
confronto si rifà ogni settimana con `npm run manutentore -- rapporti --giorni 7
--cache` e va nel taccuino. Le chiamate di Filo stesso (gli utenti) hanno la
stessa domanda, e lì il TTL lo scegliamo noi.

## 7. Guasti e account

**Niente fermo globale** (D-250, 31/10): un guasto non ferma più nessun altro
lavoro. Il lavoro che l'ha dichiarato resta fermo finché il manutentore non lo
sblocca con una nota o finché una correzione non lo riguarda: il guasto arriva
a chi deve indagare e non si ripete da solo (#1589 si è guastato sette volte in
una notte). Il caso «ambiente rotto per tutti» lo copre la pausa del pacemaker
sulle accensioni nate morte.

**Un guasto suo** (#1249.3, #1249.4). La regola intera sta qui: gli altri testi
rimandano a questo paragrafo e non la riscrivono. Una sessione del manutentore
che si chiude con un guasto (`--guasto` nel rilascio) lo lascia fermo fino alla
prossima **sessione chiusa bene**, cioè arrivata al rilascio senza guasto.
Intanto il pacemaker non lo accende per nessun automatismo: né il battito, né
un segnale (i guasti degli altri lavori, la fusione di una correzione che un
lavoro aspettava, una domanda di processo, un deploy o una suite rossi), né una
sveglia chiesta prima, che non suona. Ognuna di quelle accensioni cadrebbe
sullo stesso guasto e ne dichiarerebbe un altro. Lo accendono solo:

- la **decisione del mattino**, che è il tentativo del giorno;
- l'**owner dalla chat**, quando chiede di farlo ripartire (di solito dopo aver
  sistemato l'ambiente): subito, senza aspettare il mattino;
- la risposta **«lascialo riprovare»** dell'owner alla domanda del controllo
  qui sotto: subito anche lei;
- l'**interruttore** del manutentore (o quello delle routine) che l'owner
  riporta da spento ad acceso, di solito dopo aver scelto «spegnilo» e
  sistemato l'ambiente: vale come «lascialo riprovare», che scrive la stessa
  impostazione.

I segnali non letti restano per la prima sessione chiusa bene.

**Chi controlla il manutentore.** A interruttore acceso, se il server non vede
una sua sessione chiusa bene da 26 ore (contate dall'ultima, o dall'accensione
dell'interruttore se è più recente), apre una domanda per l'owner coi fatti:
l'ultima sessione chiusa bene, le accensioni da allora e come sono finite (il
guasto col suo messaggio, o la caduta senza rilascio), e due strade, spegnerlo
o lasciarlo riprovare (azione `automazione`, che lo accende subito anche se è
fermo). Contano le chiusure, non le
scritture nel taccuino: una sessione che scrive all'inizio e poi cade
(contesto esaurito, processo ucciso, limite di sessione) non è chiusa bene.
Una domanda alla volta, e la prima sessione chiusa bene la rende superata. Va
diretta all'owner, senza passare dal compito che smista le domande: lì un
guasto si chiude con un lavoro che lo cura, e questo lo curerebbe il
manutentore stesso. Lo decide il server, non le istruzioni di un agente.

**Account.** Il manutentore spegne e riaccende; usa prima B; niente riserva
su A. La spesa si dosa sulla settimana, più piena all'inizio; il limite delle
5 ore non esiste più.

## 8. Le novità (patch notes)

Oggi ogni worker scrive la sua riga alla consegna e il rilascio le pubblica
com'erano. Prima di ogni rilascio (ogni sei ore, se la suite è verde) passa un
**redattore**: un sotto-agente del manutentore con un contesto piccolo e
apposito, non quello intero. Riceve le righe dei worker dall'ultimo rilascio,
il manifesto delle capacità e i titoli della rosa e delle priorità 3 in corso.
Riordina per argomento, dà spazio a ciò che conta, condensa. Può aggiungere una
promessa («il supporto per altri formati è in arrivo») **solo** su un lavoro
già nella rosa o a priorità 3: non ogni rilascio ne ha una.

Le novità le leggono tutti gli utenti e il redattore lavora su testo scritto
da chiunque: il server accetta la riscrittura solo se non contiene link che
non stavano nelle righe originali, e la riga di changelog resta del worker se
il redattore non arriva in tempo. La pagina in Filo dove leggerle tutte è
#1956.

## 9. Parlare col manutentore, e il recap

**La chat.** L'owner apre una sessione con lo stesso contesto del manutentore
(ruolo, taccuino, schede, rami, registro delle decisioni) e gli parla: fa
domande sul recap, discute idee di efficientamento, dà indicazioni a voce. Le
indicazioni finiscono nel taccuino con la data (§ 5). La chat ha gli stessi
poteri e gli stessi limiti del manutentore. Dal cloud serve la stessa
operazione del server che gli dà schede e testi; in locale funziona da subito
con `npm run manutentore -- contesto` più il taccuino.

**Il recap del mattino.** Breve, in Gestione → Automazioni, un foglio al
giorno: fusioni e spesa di ieri, scelte prese (rosa, N, pacchetti) e perché,
esperimenti e cosa hanno portato, efficientamenti con la misura, segnali che
sta seguendo, come ha applicato le indicazioni dell'owner. **Mai cose da fare
per l'owner né domande**: quelle vanno nelle domande. Il recap è per ciò che
si può perdere senza danno e interessa sapere.

## 10. Cosa cambia rispetto a prima

- SPEC-RIDISEGNO-LAVORO § 2 «Manutentore»: resta, con i poteri del § 3 e il
  ritmo del § 4 di questa spec al posto della sessione sempre accesa.
- SPEC-DOMANDE § 4.3–4.8: sostituite da questa spec per il manutentore; il
  riordino della coda (§ 6.6) e la potatura (§ 4.7) restano compiti suoi.
- #1155 (monitoraggio, taccuino, sveglie): assorbito qui.
- Tetti per priorità, fermo globale dopo un guasto, riserva su A: tolti.
- Scala delle priorità: `patterns/` e la scala del 03/09 si riscrivono con il
  § 2; i giudici assegnano 3 o lasciano 1 (la 2 è del manutentore).

## 11. Da costruire

Il minimo di feedback; chi li prende usa sotto-agenti per area.

**Server (filo-security), primo:**
- chiave di classe «manutentore» sul canale delle routine, coi poteri del § 3
  e niente altro; una sessione con quella chiave è non fidata;
- operazione che dà a quella chiave schede, testi e note di un feedback a
  scelta, e i rapporti dei biglietti (oggi servono il token admin e la chiave
  di decifratura, solo sul PC dell'owner);
- taccuino (§ 5) e recap (§ 9) come documenti del server; ordine, N, priorità,
  attese, account scritti dalla chiave manutentore; freno d'emergenza
  dell'owner; via i tetti per priorità e la riserva su A;
- sveglie (§ 4): segnali che accendono il manutentore, sveglia richiesta,
  tetto suo nel pacemaker; compito ricorrente quotidiano per la decisione;
- guasti (§ 7): via il rispetto globale; lavoro guasto fermo finché una nota del
  manutentore o una correzione non lo sblocca; domanda di processo nel rilascio
  che sveglia il manutentore;
- registrazione al rilascio di strumenti falliti e attese (§ 6);
- riscrittura delle novità: operazione che accetta il testo del redattore con
  il controllo sui link (§ 8).

**App e script (Filo), dopo il server:**
- ruolo `manutentore.md` riscritto su §§ 1–9: decisione del mattino, sveglia,
  taccuino, esperimenti, redattore; `npm run manutentore` che parla con la
  chiave manutentore e non più col token admin; il contesto piccolo e quello
  intero;
- la chat con lo stesso contesto (§ 9) e l'invio delle indicazioni al taccuino;
- Gestione → Automazioni: il recap del giorno e il freno d'emergenza;
- i worker registrano al rilascio strumenti falliti e attese (contratto del
  worker e `routine-channel`);
- la scala delle priorità nei testi (patterns, FEEDBACK-STATES, prompt dei
  giudici lato app) e la discesa delle 2 a 1.

**Fase 0, da subito, in locale:** la sessione locale fa da manutentore con gli
strumenti di oggi (ordine e parallelismo via `npm run manutentore -- accendi`,
incroci, note, feedback), finché la chiave e le sveglie non sono in produzione.
