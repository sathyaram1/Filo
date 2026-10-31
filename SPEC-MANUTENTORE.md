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

Modello: **Fable** (scelta dell'owner: compito aperto, serve giudizio; costa
un po' di più di Opus).

## 2. La scala delle priorità

La priorità non è più una coda: dice quanto una cosa conta oggi.

| | cosa | chi la mette | come si lavora |
|---|---|---|---|
| **3** | urgentissimo, a prescindere dall'efficienza: buchi di sicurezza, funzioni che l'owner vuole subito e per cui accetta un riallineamento | owner, giudici, manutentore (può crearne, **non toglierne**) | parte subito, sempre in parallelo, fuori da ogni ordine |
| **2** | la rosa del giorno: i feedback più importanti fra tutti, scelti ogni mattina leggendo tutte le schede | manutentore | sempre nel suo contesto; fra questi decide ordine, pacchetti e quanti insieme |
| **1** | da fare, ma non oggi | manutentore (e owner) | aspettano una prossima rosa |
| **0** | da fare idealmente, rimandato a lungo termine: difetti minori per cui lo sforzo oggi non vale (un difetto grafico fra scroll e zoom, un errore raro senza danni permanenti) | manutentore (e owner) | non si lavorano; ne esistono infiniti, e oggi conta più un'analisi per velocizzare Filo che correggerli |

La soglia fra i livelli si muove con la maturità di Filo e con i token
disponibili: con dieci account, o con un modello piccolo al livello di Opus,
molti 0 diventano 1 e molti 1 diventano 2. Lo decide il manutentore, e lo
scrive nel taccuino quando cambia il criterio.

**Quanti insieme.** Oggi non c'è un tetto per priorità: il pacemaker accende
fino ai posti liberi, con la coda per priorità o l'ordine del manutentore. Da
ora: le priorità 3 partono sempre, il resto segue l'ordine e il **parallelismo
N** scritto dal manutentore. Resta un solo freno d'emergenza dell'owner in
Gestione → Automazioni: il massimo di sessioni insieme (default 20), che il
manutentore non può alzare. Restano la pausa crescente del pacemaker sulle
accensioni nate morte e il tetto sulle richieste al minuto.

**I giri di verifica non c'entrano con la priorità del lavoro.** I bilanci del
verificatore (quante correzioni per un rilievo di livello 3, 2, 1, 0: cap3,
cap2, cap1, cap0, scritti dall'owner in Gestione → Automazioni) sono un altro
parametro, sensibile perché cambia la qualità. Il manutentore può ottimizzarli
con prove fuori da main (§ 6, esperimenti non dal vivo); un cambio dal vivo lo
chiede prima all'owner.

**Transizione.** Le centinaia di priorità 2 in coda oggi scendono a 1 in un
colpo; la prima mattina il manutentore promuove la rosa. Nessuna segnalazione
si perde: cambia solo quante 2 si vedono in Gestione.

## 3. Cosa può fare, e cosa no

Può, da solo e senza passare dall'owner:

- scrivere l'**ordine** dei feedback e il **parallelismo N**; il server accende
  una sessione per feedback nell'ordine, fino a N, come in #1680;
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
loro file, la spesa della settimana per account. Scrive: la rosa (priorità 2),
l'ordine, N, i pacchetti, le attese. È l'unica lettura intera: ~240k token,
una volta al giorno.

**Fra una decisione e l'altra non resta sveglio: si fa svegliare.** Ogni
accensione è una sessione nuova con un contesto piccolo (ruolo, taccuino,
schede a priorità 3 e 2, rami vivi, segnali dall'ultima volta: ~25k token) e
la memoria nel taccuino (§ 5). Si accende:

- a un **battito** ogni 55 minuti al massimo, per guardare biglietti, guasti,
  deploy, suite, domande di processo;
- a una **sveglia del server** al segnale, senza aspettare il battito: guasto
  dichiarato, deploy del server rosso, suite rossa su main, accensione nata
  morta, domanda di processo di un worker, richiesta dell'owner dalla chat;
- **quando segue un problema**, più spesso: chiede lui al server la prossima
  sveglia (minimo 5 minuti), e il pacemaker la rispetta con un tetto suo,
  separato da quello del lavoro.

**Cache.** Il manutentore vuole la cache a **un'ora**: il battito ogni 55
minuti la tiene calda a costo di una rilettura. Se le sessioni cloud non
permettono di sceglierla (oggi i worker girano a cinque minuti, e in locale la
decide l'app), il contesto piccolo delle sveglie tiene comunque il costo basso:
è la lettura intera che non si ripete. Da verificare per primo (§ 6).

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
comando; raccontato nel recap del mattino. Niente esperimenti dal vivo sui
modelli che fanno il lavoro né sui bilanci dei giri di verifica (§ 2) senza il
sì dell'owner; cambiare un parametro di cache sì.

**Esperimenti non dal vivo.** Rifare un feedback già fuso con altri modelli,
altro sforzo di ragionamento o altri prompt, solo per confrontare costo e
qualità: il lavoro non si pubblica. Se il risultato è migliore, le aggiunte
possono andare su main per la via normale (un feedback, con i suoi controlli).
Qui il manutentore è libero, anche sui modelli e sui giri di verifica.

**Compiti che non sono feedback.** Il sistema di priorità dei compiti
ricorrenti è superato: li programma il manutentore. Una revisione chiesta
dall'owner (cosa si può rendere più veloce), una verifica sistematica di ogni
feedback aperto (è ancora attuale? già risolto?), un censimento: il manutentore
decide quando ha senso farli (la revisione della velocità va dopo i problemi di
velocità già noti, o li ritroverebbe) e li lancia come compiti suoi, non come
feedback con verifica e controllo di sicurezza: un compito con Opus che guida
molti Haiku e poi verifica dove serve, come nel censimento del 27/10. Quello
che il compito trova diventa feedback, priorità o taccuino.

**Primo filone: la cache.** I worker girano già a cinque minuti. Da misurare
coi dati dei biglietti: quanti turni arrivano dopo un buco sopra i cinque
minuti (unit ≈ 4 minuti, un controllo finale di più, le attese del server) e
quanto costano in riletture; se conviene un'ora per alcuni ruoli; se per il
manutentore l'ora si può scegliere. Le chiamate di Filo stesso (gli utenti)
hanno la stessa domanda, e lì il TTL lo scegliamo noi.

## 7. Guasti e account

**Niente fermo globale** (D-250, 31/10): un guasto non ferma più nessun altro
lavoro. Il lavoro che l'ha dichiarato resta fermo finché il manutentore non lo
sblocca con una nota o finché una correzione non lo riguarda: il guasto arriva
a chi deve indagare e non si ripete da solo (#1589 si è guastato sette volte in
una notte). Il caso «ambiente rotto per tutti» lo copre la pausa del pacemaker
sulle accensioni nate morte.

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
- Fermo globale dopo un guasto e riserva su A: tolti. I bilanci dei giri di
  verifica restano dell'owner (§ 2).
- Il sistema di priorità dei compiti ricorrenti: superato, li programma il
  manutentore (§ 6).
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
