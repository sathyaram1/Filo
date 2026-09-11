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

### I percorsi dell'assistente di pagina

**Stato: ✅ (attivo)**

Quando l'assistente ti aiuta su un sito e alla fine rispondi «ha funzionato»,
Filo salva il percorso che avete fatto insieme, così la volta dopo — a te o a
chiunque altro — l'assistente sa già come si fa. Di quel percorso viene
condiviso questo: **il sito**, la **pagina di partenza**, una frase che dice
**cosa si voleva ottenere** e la **sequenza di elementi** su cui si è cliccato.
La frase non la scrivi tu: la propone un modello che vede solo il sito e i
clic, e un secondo modello la scarta se somiglia a qualcosa che hai scritto.

Cosa **non** viene salvato: niente che dica chi sei. Nessun identificativo del
dispositivo, nessuno user agent, e l'orario è arrotondato all'ora — perché
anche solo un codice uguale su due percorsi diversi basterebbe a capire che
sono della stessa persona. I percorsi si chiedono **un sito alla volta**: non
esiste un elenco di tutti da scaricare, e quindi nemmeno l'elenco dei siti su
cui qualcuno ha chiesto aiuto.

---

## 7. Permessi: chi può fare cosa sui feedback

**Stato: 🔜 (regole pronte, attivazione subordinata ai prerequisiti sotto)**

I server applicano regole precise (Firebase Security Rules):

- **Chiunque** può **inviare** un nuovo feedback (in forma anonima). Non serve
  loggarsi: vogliamo abbassare al massimo l'attrito per ricevere segnalazioni.
- **Solo gli amministratori** (un elenco ristretto di email autorizzate)
  possono **gestire** i feedback: cambiarne lo stato, la priorità, le note, o
  cancellarli. Un utente normale non può toccare i feedback altrui né mettere
  in coda lavoro.
- La lista degli amministratori è una raccolta dedicata sul server: per
  aggiungere un collaboratore basta aggiungere la sua email, senza modificare
  il codice dell'app.

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
firebase deploy --only firestore:rules     # e --only storage:rules per storage.rules
```

Finché quel comando non gira, una regola stretta nel repo è una porta ancora
aperta in produzione, e il lavoro sembra finito mentre non lo è.

**L'ordine conta**, e sbagliarlo costa il lavoro due volte. Prima si pubblicano
le regole, poi si ruotano le chiavi dai pannelli dei servizi. Al contrario, le
chiavi nuove finiscono in un documento che chiunque legge ancora, e la
rotazione è da rifare da capo.

---

## 8. Aggiornamenti automatici

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

*Ultimo aggiornamento: 2026-05-29. Questo documento evolve insieme all'app;
le voci 🔜 e 💭 verranno aggiornate a ✅ quando le misure entrano in funzione.*
