# Sicurezza di Filo

Questo documento spiega **come Filo protegge i tuoi dati e il tuo account**.
È scritto per due tipi di lettore:

- se sei un **utente** (alpha tester), la sezione "In breve" ti dice cosa
  succede ai tuoi dati in parole semplici;
- se sei uno **sviluppatore** o vuoi controllare il progetto, le sezioni
  tecniche descrivono le scelte di design e perché le abbiamo fatte.

Filo è un browser AI-native: gira sul tuo computer (app Electron) e in futuro
su telefono e altri dispositivi, condividendo lo stesso account. Proprio
perché tocca dati sensibili — cronologia, appunti, e in prospettiva un gestore
password — la sicurezza è un requisito di design, non un'aggiunta successiva.

> **Stato:** Filo è in **alpha test**. Alcune delle misure descritte qui sono
> già attive, altre sono progettate ma non ancora implementate. Ogni sezione
> indica il suo stato con ✅ (attivo), 🔜 (progettato, in arrivo) o 💭 (deciso
> ma rimandato). Questo documento è la fonte di verità: viene aggiornato man
> mano che le misure entrano in funzione.

---

## In breve (per chi usa Filo)

- **Accedi con Google.** Non creiamo né conserviamo password per il tuo
  account Filo: l'accesso passa per Google, che gestisce 2FA e recupero.
- **Le tue credenziali di accesso restano sul tuo dispositivo**, cifrate dal
  sistema operativo. Non vengono mai mandate a pagine web che visiti.
- **I tuoi dati personali (le "memorie" di Filo, gli appunti) restano sul
  dispositivo.** Per ora non li sincronizziamo da nessuna parte: nemmeno noi
  possiamo vederli. Quando attiveremo la sincronizzazione multi-dispositivo,
  lo faremo in modo che restino cifrati e illeggibili per noi.
- **I feedback che invii** (testo + eventuali screenshot) vengono salvati sui
  nostri server per permetterci di correggere i bug. Non includere in un
  feedback informazioni che non vuoi condividere.
- **Quando l'Aiuto ti guida su un sito** e alla fine dici che ha funzionato,
  salviamo la traccia della navigazione (il sito, i passaggi, una frase
  sull'obiettivo) perché aiuti anche gli altri. Non ci finiscono i tuoi
  messaggi, né niente che ti identifichi.
- **Trasparenza:** questa pagina elenca esattamente cosa raccogliamo e cosa
  no. Se qualcosa cambia, cambia anche qui.

---

## 1. Identità e accesso (account)

**Stato: 🔜 (in implementazione)**

L'accesso a Filo avviene tramite **"Accedi con Google"** (Google OAuth 2.0).
Le ragioni:

- Non gestiamo password: niente database di password da proteggere, niente
  reset, niente furti di credenziali lato nostro.
- Google fornisce già autenticazione a due fattori e recupero account.
- Un unico account funziona su tutti i dispositivi (oggi desktop; in futuro
  telefono, TV…), che è il modello "una super-app per tutti i tuoi
  dispositivi" verso cui Filo va.

### Come avviene il login (flusso tecnico)

Filo è un'app **desktop**, e le app desktop hanno regole OAuth diverse da un
sito web. Seguiamo lo standard **RFC 8252 ("OAuth 2.0 for Native Apps")**:

- **Authorization Code Flow con PKCE** (Proof Key for Code Exchange). Le app
  native non possono custodire un "client secret", quindi non ne usiamo uno:
  PKCE lega la richiesta di login alla risposta tramite un segreto generato
  al volo (`code_verifier`), impedendo l'intercettazione del codice di
  autorizzazione.
- **Consenso nel browser di sistema, non in una webview interna.** La
  schermata di login Google si apre nel tuo browser predefinito. Non la
  mostriamo dentro una finestra di Filo: le webview embeddate sono un classico
  vettore di phishing (e Google stesso le blocca). Così puoi sempre verificare
  nella barra degli indirizzi del browser che stai parlando davvero con Google.
- **Redirect su loopback locale** (`http://127.0.0.1:<porta>`): Filo apre un
  micro-server temporaneo solo su `localhost` per ricevere il codice di
  autorizzazione, poi lo chiude. Niente di questo è esposto in rete.

---

## 2. Dove vengono salvati i token di accesso

**Stato: 🔜 (in implementazione)**

Dopo il login, Filo conserva i token che dimostrano la tua identità. **Non**
li mettiamo in un file di testo o in `localStorage` (sarebbero leggibili da
qualsiasi programma sul computer). Usiamo invece **`safeStorage` di Electron**,
che cifra i dati con le API del sistema operativo:

- **Windows:** DPAPI (legata al tuo account utente Windows)
- **macOS:** Keychain
- **Linux:** il keyring di sistema (libsecret), quando disponibile

Non implementiamo crittografia "fatta in casa": ci appoggiamo ai meccanismi
del sistema operativo, che sono quelli che proteggono già le altre credenziali
della tua macchina.

---

## 3. Isolamento: i token non toccano mai le pagine web

**Stato: ✅ (principio già in vigore nell'architettura)**

Filo è un browser, quindi carica siti web di terze parti. Una pagina web
**non deve mai poter leggere** i tuoi token o i tuoi dati di Filo. Per questo:

- L'autenticazione e i token vivono **solo nel processo principale** (il
  "cervello" dell'app, in Node.js), mai nel contesto delle pagine web.
- Le pagine web esterne girano con `contextIsolation` attivo e senza accesso a
  Node, e comunicano con Filo solo attraverso un canale ristretto e
  controllato (preload). Quel canale non espone né i token né le funzioni di
  amministrazione.

In pratica: anche un sito malevolo che gira in una scheda non può chiedere a
Filo "dammi il token dell'utente" né eseguire azioni privilegiate.

---

## 4. I tuoi dati personali (memorie, appunti, cronologia)

**Stato: 💭 (local-first ora; sincronizzazione cifrata in futuro)**

Le "memorie" che Filo raccoglie su di te, gli appunti copiati e la cronologia
sono i dati **più sensibili** che l'app tocca. La nostra posizione:

- **Oggi restano sul tuo dispositivo.** Non c'è sincronizzazione attiva:
  questi dati non lasciano il computer, quindi nemmeno noi possiamo vederli.
- **Quando attiveremo il multi-dispositivo** (telefono, TV…), il principio
  guida sarà la **cifratura end-to-end**: i dati verranno cifrati sul tuo
  dispositivo prima di partire, e i nostri server custodiranno solo blocchi
  cifrati che **non siamo in grado di leggere**. La chiave non lascia i tuoi
  dispositivi.

Questa è una scelta deliberata: preferiamo *non poter* vedere i tuoi dati
piuttosto che chiederti di fidarti che non li guardiamo.

---

## 5. Gestore password (futuro)

**Stato: 💭 (rimandato, con un vincolo di design fissato fin da ora)**

Un gestore password integrato è nei piani, ma non sarà nell'alpha iniziale.
Quando lo costruiremo, sarà **zero-knowledge** per design:

- La chiave che cifra il tuo "caveau" di password deriva da un **segreto che
  controlli tu** (es. una master password), **non** dalla tua sessione Google.
- Conseguenza: anche chi gestisce i server di Filo (cioè noi) **non può
  decifrare** le tue password. Identità (Google) e chiave del caveau restano
  due cose separate.

Fissiamo questo vincolo fin d'ora — account ≠ chiave del caveau — proprio per
non incastrarci in un'architettura insicura più avanti.

---

## 6. I dati che raccogliamo: i feedback

**Stato: ✅ (attivo)**

Filo permette di inviare feedback (col tasto destro, da qualsiasi pagina). Un
feedback contiene:

- il **testo** che scrivi;
- eventuali **screenshot** che alleghi;
- l'**URL** e il titolo della pagina da cui scrivi, lo **user agent** (per
  riprodurre il bug) e un **identificativo anonimo del dispositivo**
  (`clientId`, un codice casuale che **non** è collegato alla tua identità).

Questi dati vengono salvati su Google Firebase (Firestore + Storage) e ci
servono solo per correggere bug e migliorare l'app. **Non includere in un
feedback dati che non vuoi condividere.**

---

## 7. Permessi: chi può fare cosa sui feedback

**Stato: 🔜 (regole pronte, attivazione subordinata ai prerequisiti sotto)**

I server applicano regole precise (Firebase Security Rules):

- **Chiunque** può **inviare** un nuovo feedback (in forma anonima). Non serve
  loggarsi: vogliamo abbassare al massimo l'attrito per ricevere segnalazioni.
- **Nessuno può LEGGERE i feedback**, a parte chi li gestisce: gli
  amministratori e il server che li lavora. Quello che invii non è consultabile
  da un altro utente, e nemmeno da chi conoscesse l'indirizzo del documento.
- Lo stesso vale per gli **screenshot e i file** che alleghi: non si possono
  elencare e non si aprono conoscendone l'indirizzo. L'unica chiave è il codice
  di scarico che sta nel link, e quel link non esce dalle mani di chi gestisce i
  feedback. Se un codice dovesse scappare si può cambiare, e da quel momento il
  vecchio link non apre più niente.
- Quello che tutti possono vedere è la **bacheca dei miglioramenti**, e sono
  solo i campi pensati per stare lì: il titolo breve di un problema già
  risolto, il suo numero, la versione in cui è uscito, la frase scritta per chi
  l'aveva segnalato, i voti. Non il testo, non l'indirizzo della pagina, non
  gli screenshot, non le note di lavorazione. Quei campi vivono in una raccolta
  separata — una vetrina — riempita da chi gestisce i feedback: la raccolta
  vera resta chiusa.
- **Solo gli amministratori** (un elenco ristretto di email autorizzate)
  possono **gestire** i feedback: cambiarne lo stato, la priorità, le note, o
  cancellarli. Un utente normale non può toccare i feedback altrui né mettere
  in coda lavoro.
- La lista degli amministratori è una raccolta dedicata sul server: per
  aggiungere un collaboratore basta aggiungere la sua email, senza modificare
  il codice dell'app.
- Gli **allegati** (gli screenshot, cioè il tuo schermo) non sono pubblici.
  Chiunque può caricarne di nuovi insieme a un feedback, anche senza login, ma
  nessuno può sovrascriverli, cancellarli o farsi dare l'elenco di quelli che
  ci sono. Si aprono da una strada sola: il collegamento che nasce insieme
  all'allegato e che vive dentro il tuo feedback. Nemmeno chi riceve le
  segnalazioni ne ha un'altra, ed è voluto — è quello che rende utile ritirare
  quel collegamento se finisce in giro. Prima bastava il nome del deposito, che
  è scritto nel codice, per scaricarli tutti.

C'è una seconda raccolta aperta a tutti, e va detto perché. Quando l'assistente
ti aiuta a fare qualcosa su un sito, Filo può tenere da parte come ci è
riuscito: il dominio, il percorso della pagina da cui si parte (senza la parte
dopo il punto interrogativo), una riga che riassume l'obiettivo, riscritta da un
modello e scartata se non è generica, i nomi degli elementi toccati e se la cosa
è riuscita. Serve a tutte le installazioni, che la rileggono per
il sito che hanno davanti, e per questo si legge senza credenziali. Lì dentro
non c'è niente che dica da quale installazione arriva: nessun identificativo,
nessun account, nemmeno la versione di Filo che l'ha raccolto. Le cose scritte
qui sopra sono tutte quelle che partono, e non ce ne sono altre.
Da settembre 2026 quei documenti non li scrive più il client: li scrive il
server, che rifà la pulizia e tiene i limiti di frequenza.

La sicurezza qui non sta nel nascondere la chiave API di Firebase (che, come in
tutti i progetti Firebase, è pubblica per design e visibile nel client): sta
**interamente nelle regole** descritte sopra, che sono il vero confine.

Da qui segue una cosa che non è ovvia: **aver fatto il login non è un
permesso**. La chiave è pubblica e per entrare basta un account Google
qualunque, quindi una regola che chiede solo di essere autenticati lascia
passare chiunque, anche chi Filo non l'ha mai installato. Le credenziali
condivise, cioè le chiavi dei servizi AI che Filo usa per conto tuo, le legge
**solo un amministratore**. Le chiavi che fanno funzionare Filo appena
installato non le scarica il tuo computer. Arrivano già dentro l'applicazione,
messe lì quando la versione viene costruita, e si rinnovano con l'aggiornamento
automatico.

### Le regole cambiano solo quando le pubblichi

Se le regole sono l'unico confine, il confine si sposta quando le regole
arrivano sul progetto Firebase, non quando il file cambia nel repo. Nessun
automatismo le pubblica: si fa a mano, con

```bash
npm run deploy:regole                      # regole + indici di Firestore
firebase deploy --only storage:rules       # le regole dello storage, a parte
```

Finché quel comando non gira, una regola stretta nel repo è una porta ancora
aperta in produzione, e il lavoro sembra finito mentre non lo è.

Gli **indici** viaggiano con le regole nello stesso comando apposta. Una query
che si appoggia a un indice non ancora pubblicato viene rifiutata dal server, e
la funzione che dipende da quella query smette di dare risultati senza che si
rompa niente di visibile: il caso peggiore, perché nessuno se ne accorge.

**L'ordine conta**, e sbagliarlo costa il lavoro due volte. Prima si pubblicano
le regole, poi si ruotano le chiavi dai pannelli dei servizi. Al contrario, le
chiavi nuove finiscono in un documento che chiunque legge ancora, e la
rotazione è da rifare da capo.

**Poi vanno ruotati i codici di scarico degli allegati vecchi.** Le regole nuove
negano il `get` sul deposito, quindi un allegato si apre solo col codice che sta
nel suo link. Quel codice è quello che serviva: gli indirizzi degli allegati
stavano dentro i documenti dei feedback, leggibili da chiunque fino a questo
audit, e chi li ha raccolti in quei mesi se li tiene. Ruotare il codice di un
file (Firebase Console → Storage → il file → «Crea nuovo token di download», e
cancella il vecchio) manda in errore i link scappati. Prima serviva a zero,
perché col `get` aperto il file si prendeva lo stesso dall'indirizzo. Vale
soprattutto per gli allegati anteriori al 25 giugno 2026, che non sono cifrati.
Dopo la rotazione i link dentro i documenti dei feedback puntano al codice
vecchio, quindi quei documenti vanno riscritti col link nuovo: è lo stesso
lavoro di migrazione dei documenti storici, e si fa insieme.

---

## 8. I percorsi condivisi dell'Aiuto

**Stato: 🔜 — la porta è chiusa, la strada nuova non è ancora aperta.** Le
regole non lasciano più scrivere nessun client, e in lettura i percorsi sono
già trattati come contenuto esterno. Manca la callable `pathSubmit`: oggi
l'indirizzo risponde che non esiste, quindi nessun percorso entra più nella
raccolta e ogni invio fallisce senza lasciare traccia fuori dalla console.
Va sciolto prima di pubblicare una versione, o la raccolta resta ferma e non
se ne accorge nessuno.

Quando l'Aiuto ti accompagna passo passo su un sito e alla fine rispondi «ha
funzionato», Filo può salvare la traccia di quella navigazione. Dentro ci sono
il dominio, la sezione di partenza, la sequenza di elementi toccati e una frase
che riassume l'obiettivo, scritta da un modello che vede solo dati
programmatici. Serve a far partire avvantaggiato chi cercherà la stessa cosa su
quel sito.

Prima di partire, da tutti e tre (elementi toccati, sezione di partenza, frase
dell'obiettivo) vengono cancellati i dati che identificano una persona:
indirizzi email, IBAN, codici fiscali, numeri lunghi, numeri scritti con spazi o
trattini (i telefoni, le carte) e i soprannomi che cominciano con la chiocciola.
Al loro posto resta un segnaposto. La stessa cancellazione si rifà in lettura,
perché nella raccolta ci sono anche documenti nati prima.

Il **nome del sito** invece non si ripulisce, e non si può: è anche l'indirizzo
sotto cui il documento va a finire, quindi riscriverlo vorrebbe dire metterlo
dove nessuno lo cercherà. O esce com'è, o il percorso non si pubblica. Quindi
due difese. La prima: i siti che non sono di nessuno non si raccolgono affatto,
e sono gli indirizzi numerici (il router di casa), i nomi di una parola sola
(`localhost`, e l'host delle pagine interne di Filo, dove l'Aiuto si apre con lo
stesso tasto), i suffissi di rete locale (`.local`, `.lan`, `.intranet`), i nomi
riservati che non esistono e non esisteranno mai su Internet (`.localhost`, cioè
il modo in cui i contenitori chiamano il servizio di prova sulla propria
macchina; `.test`, che è il progetto in lavorazione e spesso porta il nome di un
cliente; `.invalid`, `.example`) e le reti anonime (`.onion`, `.alt`, `.i2p`),
dove il nome del sito è il segreto. Il punto finale della forma assoluta si
toglie prima di guardare, o `localhost.` passerebbe dove `localhost` non passa.
Lì un percorso non serve comunque a nessun altro, e il nome direbbe come si
chiama la tua macchina o per chi lavori. Dove non si raccoglie, l'Aiuto non
chiede nemmeno «Ha funzionato?»: una promessa di condivisione che non si avvera
è peggio del silenzio. La seconda: su tutti gli altri decide il secondo
modello, che il nome del sito ce l'ha davanti insieme al resto e sa che
`mariorossi.github.io` dice di chi è il sito, non cos'è.

Dalla sezione di partenza sparisce anche il **nome utente scritto a lettere**,
quando si capisce da dove sta: dopo una parola che annuncia una persona
(`/utente/`, `/usr/`, `/profilo/`, `/in/`, `/clienti/`) e in testa all'indirizzo
sui siti dove il primo pezzo è sempre un profilo. E anche un pezzo più in là:
moltissimi siti mettono dopo la parola un numero e subito dopo il nome per
esteso della stessa persona, e di `/users/12345/mario-rossi` resta
`/users/[ID]/[ID]`. Quella zona è lunga due pezzi e si chiude al primo che non
ha la forma di un nome, così `/user/mariorossi/comments/abc` tiene «comments».

Dentro quella zona un pezzo **tiene le parole da sezione finché ne trova**, e
dalla prima parola che una sezione non è in poi resta un segnaposto. Serve
perché le sezioni delle aree personali hanno la stessa forma di un cognome:
`fatture-elettroniche` e `rossi-fatture` sono tutte e due due parole attaccate
da un trattino. Chiedere che UNA sola parola fosse da sezione faceva uscire il
cognome che le stava accanto; chiederlo a TUTTE cancellava le sezioni vere,
perché quasi tutte hanno accanto una parola che nella lista non c'è. Con la
regola sulla posizione il nome sta sempre dalla parte del segnaposto: di
`fatture-elettroniche` resta `fatture-[ID]`, di `rossi-fatture` resta `[ID]`, e
`note-spese` resta per intero. Vale anche per il primo pezzo dopo la parola che
annuncia la persona, dove prima c'era un segnaposto e basta: `/utente/ordini` e
`/utente/preferiti` arrivavano a chi legge scritti allo stesso modo.
Di `/u/mario.rossi/ordini/847362`
resta `/u/[ID]/ordini/[NUMERO]`: dice in che punto del sito si parte, che è
l'unica cosa per cui chi riusa un percorso lo legge, e non dice su quale conto.
Un nome utente è spesso lo stesso su più siti, e da solo rimetteva insieme i
percorsi di una persona. Quello che nessuna di queste regole vede lo guarda il
secondo modello, che ha davanti il nome del sito, l'indirizzo e i nomi degli
elementi **come uscirebbero** e scarta tutto il percorso se ci riconosce
qualcuno.

Nel documento **non c'è niente del mittente**: nessun identificativo, e nemmeno
lo user agent, che non serviva a chi legge e bastava — sistema, versione, lingua
— a rimettere insieme i percorsi della stessa installazione.

E non basta: su ogni documento Firestore scrive da sé l'ora di creazione, al
microsecondo, e la rimanda a chiunque legga. Non c'è regola che la tolga. Due
percorsi arrivati su due siti diversi a meno di un secondo l'uno dall'altro
sono della stessa persona nella stessa sessione — la chiave che togliere
l'identificativo doveva eliminare, rifatta con l'orologio. Quindi Filo **non
spedisce un percorso quando lo fai**: lo tiene sul tuo computer e lo manda più
tardi, a un'ora sorteggiata nelle ventiquattr'ore successive, uno alla volta.
Due percorsi della stessa sessione partono a ore di distanza, in ordine
qualsiasi, mescolati a quelli di tutti gli altri.

Una cosa da sapere, perché è il prezzo dell'anonimato: **una volta partito**, un
percorso non si può più ritrovare e cancellare, perché non porta niente che dica
chi l'ha fatto. Nessuno può farlo, noi compresi. Si cancella un sito intero,
dalla console, o niente. Prima di partire invece è ancora sul computer di chi
l'ha fatto, per ore, e lì un modo di toglierlo sarebbe possibile: oggi non c'è
e la scelta è dell'owner (segnalata con #584, sesto giro).

È l'unico dato di Filo che attraversa il confine fra utenti. Quello che salvi tu
finisce nel prompt dell'Aiuto di un altro, quindi valgono due regole insieme.

**In scrittura non scrive nessun client.** Le regole Firestore negano create,
update e delete su `paths` a chiunque. Un percorso entra solo attraverso la
Cloud Function `pathSubmit` del backend di sicurezza, che riapplica la pulizia
condivisa e tiene i limiti di frequenza. Prima bastavano dei vincoli di forma, e
la chiave web di Firebase è pubblica per design: chiunque poteva depositare un
«percorso» per il dominio che voleva, saltando i due modelli che nell'app
ripuliscono i percorsi. Nessuna regola se ne può accorgere, perché quei modelli
girano sulla macchina di chi naviga.

Il contratto della callable, per chi la implementa nel backend:

- accetta anche richieste **senza login**, così il mittente resta anonimo.
  L'identità arriva come `Authorization: Bearer <ID token>` e c'è sempre: è
  quella dell'installazione, l'account anonimo che Filo si crea da sé (lo
  stesso di crediti e portafoglio), non il login Google, che è opzionale. Il
  server la verifica. Se per un guasto non arrivasse, restano il `clientId`
  della richiesta e l'IP, ma sono ripieghi: il primo se lo dichiara il
  mittente, il secondo cambia da solo;
- riapplica `sanitizeSubmission` di `src/shared/pathsSafety.js`. È il modulo
  condiviso che il backend incorpora al deploy, e la pulizia deve restare la
  stessa dalle due parti. Una copia scritta a mano diverge in silenzio;
- tiene un **limite di frequenza per identità**, e anche per dominio di
  destinazione. Un attacco rende avvelenando lo stesso dominio molte volte;
- scrive con l'Admin SDK **sotto il dominio**: il documento va in
  `paths/<dominio>/entries/<id>`, non nella collezione piatta `paths`. Il
  dominio è un segmento del percorso e non solo un campo, ed è quello che
  permette a una lettura di chiedere un sito solo invece della raccolta intera
  (vedi sotto). Un documento scritto nella vecchia forma piatta oggi non lo
  legge più nessuno;
- mette lui il `createdAt` (timestamp), **arrotondato al giorno**. La lettura
  ordina per quel campo, e un documento senza quel campo resta invisibile.
  L'arrotondamento è voluto: a chi riusa un percorso serve sapere se è fresco,
  perché i siti cambiano e i selettori invecchiano, e il giorno risponde a
  quella domanda; l'ora risponderebbe a un'altra, che non deve avere risposta.
  Il `clientId` e lo user agent invece **non entrano nel documento**, perché la
  raccolta è leggibile da chiunque e un identificativo stabile lì dentro
  legherebbe fra loro le navigazioni di una stessa installazione;
- risponde `{ result: { saved: true, id } }` oppure `{ result: { saved: false,
  reason } }`. Un rifiuto non è un errore dell'utente e non gli viene mostrato:
  la raccolta è best-effort.

**In lettura si chiede un sito alla volta.** Prima i percorsi stavano tutti
nella stessa collezione con la lettura aperta: una sola query con la chiave web
del repo — che è pubblica per design — li scaricava tutti, e da lì si
rimettevano insieme i percorsi della stessa persona su siti diversi. Chiudere la
scrittura non toccava quella porta. Adesso il dominio è un segmento del percorso
(`paths/<dominio>/entries`), e le regole reggono su tre cose insieme: la vecchia
forma piatta è chiusa in lettura (ci stanno anche i documenti col vecchio
identificativo dentro), l'elenco dei domini raccolti non si ottiene — direbbe da
solo chi frequenta cosa — e una query di gruppo sulle sottocollezioni è negata,
perché in `firestore.rules` non esiste nessun match ricorsivo che la autorizzi.
Aggiungerlo rimetterebbe in piedi il download della raccolta intera.

**In lettura sono contenuto esterno.** I percorsi restano leggibili da chiunque,
perché servono anche all'Aiuto di chi non ha un account. Chi li mette in un
prompt però li ripulisce di nuovo e li chiude fra due marcature, sotto
un'intestazione che dice da dove vengono e che sono dati, non ordini. Il
promemoria in fondo al prompt li cita insieme alla pagina, all'outline e
all'llms.txt del sito. Questo vale anche adesso che la scrittura passa dal
server, perché un percorso mandato in buona fede può contenere il testo di una
pagina ostile.

---

## 9. Aggiornamenti automatici

**Stato: 🔜**

Filo si aggiorna da solo: a ogni avvio controlla se c'è una versione più
recente, la scarica e la applica alla chiusura. Gli aggiornamenti vengono
pubblicati come release ufficiali del progetto. Potrai disattivare gli
aggiornamenti automatici dalle impostazioni se preferisci controllarli a mano.

---

## Come segnalare un problema di sicurezza

Se pensi di aver trovato una vulnerabilità, **non aprirla come feedback
pubblico**. Scrivi direttamente al maintainer del progetto. Trattiamo le
segnalazioni di sicurezza con priorità.

---

*Ultimo aggiornamento: 2026-09-14. Questo documento evolve insieme all'app;
le voci 🔜 e 💭 verranno aggiornate a ✅ quando le misure entrano in funzione.*
