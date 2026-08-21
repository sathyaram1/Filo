# Autorità delle routine: biglietti al posto della cassetta postale

Spec dell'owner, 2026-08-16. Sostituisce il trasporto delle decisioni su git
(`feedback-triage/`, la GitHub Action, l'applier locale) con un canale
autenticato verso il server, e sposta l'autorità dalle macchine che ospitano un
LLM al server.

Non è un lavoro di sicurezza teorico: nasce da tre difetti **verificati** il
15-16 agosto 2026, tutti nello stesso punto del sistema.

---

## 1. Cosa è rotto adesso

**a) La cassetta postale è pubblica.** Le decisioni sui feedback viaggiano come
file dentro il repo, che è pubblico. Le note — cioè i report scritti per l'owner
— ci passano **in chiaro**, e restano nella storia anche dopo che il file è stato
consumato. Lo stesso canale trasporterà, prima o poi, la chiusura di un fix di
sicurezza: la descrizione di cosa non funzionava, pubblicata prima che la
correzione arrivi sui computer degli utenti.

**b) La validazione dei passaggi di stato non gira.** Chi applica le decisioni
controlla che la transizione sia legale per chi la chiede. Per farlo deve leggere
lo stato attuale del feedback, che è cifrato dal 25 giugno. L'automatismo su
GitHub ha solo la credenziale per scrivere, non la chiave per leggere: non riesce
mai a sapere da dove sta partendo e, per prudenza, **applica lo stesso**. Nel
cammino automatico — l'unico che gira sempre — resta in piedi solo il controllo
di forma.

**c) I segreti stanno dove li vede chi non dovrebbe.** La chiave di lettura dei
feedback viene passata nel prompt dell'orchestratore, ma il token dell'account
robot sta nell'**ambiente**, e l'ambiente lo eredita ogni worker: con quello si
leggono le chiavi API a pagamento dell'owner. E i worker leggono tutto il giorno
testo scritto da sconosciuti.

C'è un filo comune fra (b) e la falla del feedback #476: **una scelta di
cifratura sta accecando i controlli, non gli estranei.**

---

## 2. I principi

1. **Chi legge testo non fidato non tiene segreti che valgono.** Un worker può
   essere manipolato da un feedback scritto apposta: quello che ha in mano deve
   valere il minimo indispensabile.
2. **Un segreto, un potere.** Chiavi separate per cose separate, così una fuga
   non costa tutto e si revoca una senza spegnere le altre.
3. **L'autorità sta sul server, non sulla macchina.** Qualunque programma locale
   che concede permessi può essere chiamato dall'LLM che gli sta accanto: stessa
   shell, stesso utente. Il permesso deve nascere dove l'LLM non arriva.
4. **Ognuno riceve solo il suo lavoro.** Non "gli si dice di non guardare il
   resto": il resto non gli viene proprio consegnato, e non ha la chiave per
   andarselo a prendere.
5. **In dubbio ci si ferma** (coerente con l'interruttore delle routine): se il
   server non risponde, il giro non lavora. Meglio un giro saltato che un giro
   che scrive senza controlli.

---

## 3. Chi tiene cosa

| Attore | Cosa ha | Cosa può farci |
|---|---|---|
| **Orchestratore** (sessione schedulata) | una **parola d'ordine**, solo nel prompt, mai nell'ambiente | chiedere un biglietto per il worker che sta per far partire. Nient'altro |
| **Worker** (l'istanza che lavora) | un **biglietto** monouso, opaco | ottenere il proprio lavoro, battere il cuore, consegnare, rilasciare |
| **Server** | la chiave privata dei feedback in **cassaforte** (Secret Manager) + accesso al database | scegliere il lavoro, decifrare, validare, scrivere |
| **Owner** | le sue credenziali admin, come oggi | tutto, dalla dashboard |

Una parola d'ordine **per routine schedulata**: si revoca la singola, e nel
registro del server si vede quale ha fatto cosa.

**La chiave di lettura sparisce dalle macchine delle routine.** È il cambiamento
più importante di tutta la spec: oggi vive in tante copie, su computer che
leggono testo ostile; domani in una sola, in una cassaforte.

---

## 4. Il flusso

```
orchestratore ──(parola d'ordine)──▶ server          "un biglietto, per favore"
              ◀──(biglietto opaco)──                  il server sceglie il lavoro,
                                                      prende il semaforo, lega il
                                                      biglietto a: feedback, ruolo,
                                                      ramo, semaforo
      │
      └─▶ spawna il worker, passandogli SOLO il biglietto

worker ──(biglietto)──▶ server                        "qual è il mio lavoro?"
       ◀──(payload del ruolo)──                        già decifrato, solo il suo

worker ──(biglietto + battito)──▶ server              tiene vivo il semaforo
worker ──(biglietto + intento)──▶ server              "verdetto: passa" / "fatto" / …
       ◀──(accettato | rifiutato)──                    validato dal server
worker ──(biglietto)──▶ server                        rilascio a fine lavoro
```

Punti non negoziabili del flusso:

- **L'orchestratore non sa su cosa si lavorerà.** Chiede un biglietto, non un
  feedback. È ciò che tiene il testo dei feedback fuori dal suo contesto: se lo
  vedesse, sarebbe manipolabile anche lui, e la parola d'ordine ce l'ha lui.
- **Il biglietto si lega al lavoro nel momento in cui il server sceglie**, non
  quando il worker chiede. Un biglietto vale per un semaforo solo.
- **La scelta del lavoro si sposta sul server.** Oggi è il dispatcher, che è già
  codice deterministico su uno stato leggibile: è il candidato ideale a girare
  dove nessun LLM lo può influenzare.
- **La durata sta nel semaforo, non nel biglietto.** Sessioni lunghe: il battito
  tiene vivo il semaforo. Sessione morta: il semaforo scade, il biglietto muore
  con lui. Nessun numero da indovinare sulla durata dei lavori.

---

## 5. Cosa controlla il server, a ogni consegna

1. **Il biglietto esiste ed è vivo** (semaforo ancora suo, non rilasciato, non
   scaduto).
2. **Il feedback è il suo.** Il numero del feedback non viene dal messaggio: il
   server lo legge dal biglietto. Chiedere qualcosa su un altro feedback non è
   "rifiutato", è **impossibile da esprimere**.
3. **Il ruolo permette quell'azione.** Un verificatore scrive verdetti, non
   chiude feedback; un risolutore consegna, non si auto-approva.
4. **Il ramo combacia** con quello legato al biglietto.
5. **La macchina a stati** autorizza il passaggio, letto dallo stato **vero**
   (il server la chiave ce l'ha: è il controllo che oggi non gira mai).
6. **Il tetto**: quante consegne al minuto per biglietto e per routine. Una
   routine impazzita trova una porta chiusa, non un database gonfio.

Ogni rifiuto va **registrato e visibile all'owner**: un worker che prova azioni
fuori dal suo perimetro è il segnale che qualcuno l'ha manipolato, ed è
esattamente ciò che si vuole scoprire.

---

## 6. Cosa riceve ogni ruolo

L'isolamento fra i ruoli esiste già oggi nel dispatcher, ma è una **consegna**:
il worker ha la chiave e i feedback sono leggibili da chiunque, quindi ciò che
non gli viene dato se lo può prendere. Spostando la decifratura sul server
diventa un **muro**.

| Ruolo | Riceve | NON riceve |
|---|---|---|
| `new-work` | il testo del suo feedback | — |
| `fixer` | il feedback + la critica della verifica | — |
| `verifier` | il **sintomo** (il feedback), il ramo | il diff, il report di chi ha risolto |
| `secaudit` | **solo ramo e diff** | qualunque campo del feedback |
| `prober` | niente | la coda |

La riga che conta è `secaudit`: **il controllo di sicurezza non deve leggere
testo scritto da sconosciuti**, o il testo può convincerlo. Senza chiave sulla
macchina, quel feedback per lui è un blob illeggibile — non una regola da
rispettare.

---

## 7. Cosa NON garantisce (dichiarato, non nascosto)

- **`verifier` che non guarda il diff resta una convenzione.** Ha il progetto e
  una shell: se vuole, il diff se lo calcola. È isolamento di qualità (evita che
  si ancori allo happy-path di chi ha scritto il codice), non di sicurezza.
- **Un worker manipolato può mentire sul proprio feedback**: scrivere un report
  falso, dare un verdetto sbagliato. Non si può impedire — è il lavoro che gli
  hai affidato. Si limita il *perimetro*, non la sincerità.
- **Il ramo principale non è protetto da questa spec**: continua a esserlo dal
  cancello di fusione e dalla regola che nessun salvataggio automatico ci fa
  atterrare niente.

---

## 8. Migrazione, in cinque pezzi consegnabili

Ognuno lascia il sistema funzionante e ha senso da solo.

1. **Silenzio sugli attacchi confermati** (feedback #476, indipendente da tutto
   il resto: si può fare subito).
2. **Il server sa parlare**: parola d'ordine, biglietti, semafori, battito,
   rilascio. Le routine continuano a usare la cassetta postale; il canale nuovo
   gira in parallelo e si confronta.
3. **La consegna passa dal canale nuovo**, con i controlli veri (§5). La cassetta
   postale resta come ripiego, ma non è più la strada principale.
4. **La chiave di lettura esce dalle macchine**: il payload arriva già decifrato
   dal server. Da qui l'isolamento di `secaudit` diventa un muro.
5. **Smantellamento**: via gli script della coda, la GitHub Action, l'applier
   locale, i file di triage. Con loro sparisce anche l'ultima strada per cui una
   pubblicazione può partire senza che nessuno l'abbia decisa.

In parallelo, indipendenti: togliere il token dell'account robot dall'ambiente
delle routine e rigenerarlo; separare i due testi (una frase in chiaro per
l'utente, il report cifrato per l'owner).

---

## 9. Decisioni prese, e perché

- **La chiave privata va sul server, non resta fuori.** Sembra il contrario della
  prudenza, ma il conto è: oggi esiste in una copia per ogni routine, su macchine
  che leggono testo ostile; domani in una sola, in una cassaforte gestita. Meno
  copie, meglio protette.
- **Le decisioni non si cifrano.** "Feedback 500, da *in verifica* a
  *verificato*, ruolo verificatore" non è contenuto, è metadato di lavorazione:
  cifrarlo accecherebbe di nuovo i controlli, che è il difetto (b) da cui siamo
  partiti. Si cifra il **contenuto** (testo dei feedback, report), non il
  **controllo**.
- **Niente valore nuovo per "bloccato"** in ciò che è visibile da fuori: sarebbe
  lo stesso segnale con un altro nome (vedi #476).
- **Server irraggiungibile = routine ferme**, come per l'interruttore master.

---

## 10. Aggiornamenti del 2026-08-19 (ridisegno piano Max, SPEC-RIDISEGNO-MAX.md §5 e §12)

**Il guasto si dichiara nel rilascio, non a parole.** `release` accetta
`{ ticket, fault: "motivo" }` (dal client:
`routine-channel.mjs release <biglietto> --guasto "motivo"`). Il testo di
ritorno di un worker non lo legge nessuna macchina: un guasto raccontato lì non
esiste. Il motivo è testo di worker — dato non fidato: il server lo tronca e lo
deposita, mai lo interpreta. Da quel momento l'emissione dei biglietti risponde
`fault_declared` per un **periodo di rispetto** (1h), poi il blocco scade da
solo: il paracadute giornaliero deve sempre poter lavorare. Per il client
`fault_declared` è un **guasto** (exit 3): l'orchestratore chiude senza
rispawnare — con una causa deterministica i worker morirebbero in fila — e non
lo ritenta, perché è una risposta, non un'interruzione di rete.

**I giri li accende il pacemaker.** Una funzione schedulata nel progetto
filo-security, ogni 10 minuti, con i freni in quest'ordine: interruttore
(`config/routines.enabled`) acceso? nessun **battito di sistema** fresco
(qualcuno sta già lavorando)? run giornalieri rimasti (tetto di default 12,
`config/routines.pacemakerDailyCap`)? l'ultimo giro non è **nato morto** e
nessun guasto è stato dichiarato (periodo di rispetto ≥ 1h)? c'è lavoro (stessa
domanda del sondaggio di prontezza, fatta dentro il server)? Solo se tutto dice
sì, una POST accende la routine su claude.ai (id in
`config/routines.routineId`, token nei Secret delle functions — mai negli
ambienti delle sessioni). Il battito di sistema lo scrivono gli ingressi del
canale (biglietto, heartbeat, consegna, rilascio) ed è l'**unica** definizione
di "qualcuno sta lavorando": nessun flag che una sessione morta lascia in giro.
L'orchestratore non riaccende mai il giro successivo: chiude e basta.

**I ruoli `idle` e `off` non esistono più.** Esistevano perché lo smistamento
girava dentro un worker già spawnato, che aveva bisogno di istruzioni anche per
"non fare niente". Oggi coda vuota e interruttore spento sono una risposta
`{ ok:true, work:false, reason:'idle'|'off' }` all'emissione del biglietto —
exit 2 per il client, **prima** che un worker venga spawnato. Nessun biglietto
può nascere con un ruolo senza lavoro.

## 11. Il merge lo fa il server (2026-08-19, SPEC-RIDISEGNO-MAX.md §10)

Il §7 di questa spec dichiarava il limite: "il ramo principale non è protetto
da questa spec". Il limite era reale — i controlli (verifica, secaudit, L5)
giravano solo sul **cammino onesto**: niente impediva fisicamente a un'istanza
catturata da una prompt injection di pushare dritta su `main`, saltandoli
tutti. "Difficile" non è una difesa: **l'ultimo livello deve essere non
convincibile**, cioè un posto dove non c'è nessun LLM da persuadere e nessun
ambiente da avvelenare.

Da oggi la fusione è una consegna del canale come le altre:

- **`routineMerge` `{ ticket, branch }`** — la chiede solo il controllo di
  sicurezza, a verdetto registrato. Il server, in ordine e fail-closed:
  1. biglietto vivo, ruolo `secaudit`, ramo = quello **del biglietto** (un
     messaggio che ne nomina un altro è respinto e registrato, non corretto);
  2. **stato vero**: PASS della verifica e PASS del controllo di sicurezza
     **registrati** da consegne validate — e registrati su *quel* ramo. Un
     verdetto raccontato nel corpo (il vecchio `FILO_L4_VERDICT`) non esiste
     come input: nessuno lo legge;
  3. la **punta vera** del ramo, risolta una volta sola: da qui in poi si parla
     di quello sha e mai più del nome (vedi "si esamina e si fonde lo stesso
     commit", più sotto);
  4. **L5 deterministico** sul diff `main...<sha>` che il server **scarica da
     GitHub** — mai su un diff consegnato dal chiamante. Qualunque trip →
     `blocked`, con l'elenco dei trip, e il blocco finisce nel registro dei
     rifiuti;
  5. fusione di **quello sha**, via API GitHub con l'identità del server.
     Conflitto → `conflict`, niente fusione.
- **`scripts/merge-gate.mjs` è diventato il citofono**: presenta il biglietto
  e riferisce l'esito (exit invariati: 0 fuso, 10 bloccato, 20 conflitto,
  1 errore). Il git locale, l'L5 locale e il verdetto passato via ambiente
  sono spariti da questa macchina: qui non c'è più niente da convincere.

### L'identità del server: una GitHub App (2026-08-20)

Il token di fusione era un PAT di un account macchina: l'identità di *qualcuno*,
con i suoi permessi e la sua storia. Adesso è una **GitHub App** installata sul
solo repo pubblico, con i permessi minimi (contenuti in scrittura, metadati in
lettura). Non appartiene a nessuno, si revoca senza toccare persone, e il token
con cui parla **dura un'ora e se lo rigenera da sé**: l'unico segreto di lunga
vita è la chiave privata, che vive nei Secret delle functions.

- Segreti, **due soli**: `GH_APP_ID` (l'App ID numerico **oppure** il Client ID
  — per GitHub è solo la stringa nel mittente del JWT) e `GH_APP_PRIVATE_KEY`
  (il PEM intero).
- Il **numero dell'installazione** (oggi `155205894`) **non è un segreto** e non
  è un Secret: dice solo "questa App, su questo repo", e senza la chiave privata
  non apre niente. Il server se lo scopre chiedendolo a GitHub e se lo ricorda —
  è il cammino normale. Dichiararlo come segreto costringerebbe a crearne uno in
  Secret Manager solo per far passare il deploy, e a lasciare in giro un
  segnaposto che qualcuno domani scambia per una credenziale. Chi vuole
  risparmiare quella chiamata lo inchioda con `FILO_GH_INSTALLATION_ID`
  (variabile d'ambiente normale); un valore che non è un numero viene ignorato e
  si torna a scoprire — è un'ottimizzazione, non un confine.
- Permessi dell'App: **contenuti in scrittura** (per fondere) e **metadati in
  lettura**. Nient'altro.
- `GH_MERGE_TOKEN` resta come **ripiego**. La scelta fra le due identità sta in
  un punto solo (`src/routine/github.js`): App se c'è, altrimenti PAT,
  altrimenti `github_no_token` — e nessuna fusione tentata alla cieca.

### Anche il finish locale passa dal server: `ownerMerge` (2026-08-20)

Il cancello aveva tolto alla macchina delle routine il potere di scrivere su
`main`, ma restava la **porta accanto**: `npm run finish` fondeva e pubblicava
dalla sessione locale, con le credenziali dell'owner — sulla stessa macchina
dove gira un LLM che legge testo di sconosciuti. Finché quella porta c'era, il
muro non era un muro.

- **`ownerMerge` `{ branch, sha? }`** — chiamata riservata all'owner
  autenticato (stesso perimetro di `routineKeys`/`routineStateAdmin`). Il
  server: valida il nome del ramo → risolve la **punta vera** del ramo su
  GitHub (e se lo `sha` è dichiarato pretende che combaci: diverso → `stale`,
  niente fusione, i controlli locali riguardavano un altro codice) → fa girare
  **L5** sul diff di quella punta, che scarica lui (trip → `blocked`) → fonde
  quella punta con l'identità dell'App (409 → `conflict`). Esiti e guasti nello
  stesso vocabolario di `routineMerge`.
- **Cosa NON chiede**: i verdetti registrati di verifica e sicurezza. Quelli
  sono il vocabolario delle routine; il lavoro locale ha i suoi controlli
  (logica pura, spec mirati, verifica indipendente) che girano prima. **L5
  invece gira lo stesso**: è il livello che nessuno può raccontare, e vale
  anche per l'owner.
- **`npm run finish`** non fa più `checkout`, `merge`, `push origin main`:
  spedisce il ramo, chiede la fusione, traduce l'esito. Esce con zero **solo**
  se il codice è arrivato su `main`. Lavorare direttamente su `main` non ha più
  senso e viene fermato subito.

### Si esamina e si fonde LO STESSO commit (2026-08-21, verifica avversariale)

La prima versione del cancello scaricava il diff di `main...<ramo>` e poi
chiedeva a GitHub di fondere **il ramo per nome**. Fra le due chiamate la punta
del ramo può spostarsi — e chi lavora ha per costruzione il permesso di
spingere sul proprio ramo: bastava spingere un commit in quella finestra (e
riprovare finché non riusciva) per far atterrare su `main` codice che L5 non
aveva mai visto. Il difetto valeva su entrambi i cammini, `routineMerge` e
`ownerMerge`, e lo `sha` dichiarato non lo chiudeva: veniva confrontato prima,
ma la fusione continuava a partire dal nome.

Da oggi, su **tutti e due** i cammini:

- la punta del ramo si **risolve una volta sola**, all'inizio del giro; da lì
  in poi il nome del ramo non decide più niente;
- il confronto (l'input di L5) e la fusione lavorano su **quello sha**. Le due
  chiamate a GitHub rifiutano un nome di ramo: se ne arriva uno, è un errore
  dichiarato, non una fusione alla cieca;
- il **messaggio** del commit di fusione continua a dire il nome del ramo:
  serve a leggere la storia, non a scegliere cosa fondere;
- lo `sha` **dichiarato** dal cammino owner resta, ma è solo un controllo in
  più ("i controlli locali giravano su questo"): non combacia → `stale`. La
  sicurezza non dipende dal fatto che il chiamante lo dichiari — la punta vera
  si chiede comunque.
- il cammino delle routine registra anche **quale punta è stata fusa**,
  accanto al commit di fusione: è l'unica risposta possibile a "quale contenuto
  è atterrato su `main`".

Stesso giro, dal lato locale: il nome del ramo principale in `npm run finish`
**non si prende più dall'ambiente**. Era una guardia appesa a una variabile:
impostandola, "sei sul ramo principale" diventava falso e il passo che spedisce
il ramo spediva `main` su `origin` con le credenziali della macchina, prima
ancora di parlare col server. Adesso il valore è inchiodato, e la spedizione
rifiuta esplicitamente `main`, `master` e il ramo di default del repo.

### Gli automatismi locali (2026-08-21, stessa verifica avversariale)

La stessa forma — `TARGET_BRANCH="${FILO_MAIN_BRANCH:-main}"` — era rimasta nel
file accanto, l'hook di salvataggio (`.claude/hooks/auto-commit-merge.sh`), e il
diagnostico dei limiti (`.claude/hooks/cap-observe.sh`) spediva il ramo corrente
senza chiedersi quale fosse. Chiusi entrambi:

- il nome del ramo principale è **inchiodato** nei due hook (`main`, `master`,
  più il default dichiarato da origin, che si aggiunge e non sostituisce);
- una cartella che si trova sul ramo principale non viene più **committata**:
  quel lavoro non ha modo di arrivare agli utenti (si fonde un RAMO) e intanto
  sporcava la copia locale. Le modifiche restano dove sono;
- astenersi **si dice**: entrambi gli hook scrivono su stderr perché non hanno
  toccato niente, e proseguono. Un automatismo che si ferma in silenzio è la
  classe di guasto che ha già prodotto un ramo non salvato per giorni.

La guardia riguarda **la linea principale**, non "tutto ciò che non è un ramo di
lavoro": in una cartella a HEAD staccata il salvataggio locale resta (è l'unica
rete che hanno le sessioni isolate), e a non spedire ci pensa il fatto che non
esista un ramo dove far atterrare niente. Una guardia scritta larga avrebbe
smesso di salvare anche il lavoro vero — rimedio peggiore del male.

### Dove sta il muro, per esattezza

La ruleset su `main` **c'è** (verificato sul campo il 2026-08-21: un push
diretto da questa macchina viene respinto con `push declined due to repository
rule violations`), e l'unica identità ammessa è quella della GitHub App.

Il muro sta quindi **su GitHub**, non su questa macchina: le credenziali locali
capaci di fare un push esistono ancora — servono a spedire i rami di lavoro — e
non è vero, come si è scritto altrove, che da qui non ci sia più niente in grado
di scrivere. Quello che non c'è più è un push su `main` che **riesca**.

Le guardie locali (`finish-local.mjs`, i due hook, `branch-integrity.mjs`)
restano per due motivi, entrambi indipendenti dal muro: un tentativo respinto in
silenzio è un guasto invisibile, e una difesa che dipende da un solo muro cade
con quel muro.

## 12. Anche il numero di versione lo scrive il server: `releaseBump` (2026-08-21)

Con la ruleset su `main` attiva, l'ultimo che ci scriveva senza passare dal
server era il **lavoro di pubblicazione**: ogni sei ore alzava la patch version
con `npm version patch` e faceva `git push origin HEAD:main`. Quel push adesso
verrebbe respinto — e non deve nemmeno essere tentato: quel lavoro gira su una
macchina qualunque, con un token che eredita chiunque ci passi.

Il numero **resta nel manifesto del repo** (le note di rilascio per l'utente
sono organizzate per versione: senza quel numero non lo raggiungerebbero più),
ma a scriverlo è il server.

- **`releaseBump` `{ passphrase }` → `{ ok, version, previous, sha }`** — stessa
  **parola d'ordine di scopo `build`** di `buildKeys` e `buildAlarm`, e nessun
  potere in più. Il server, in ordine e fail-closed:
  1. riconosce la parola d'ordine (scopo `build`, non il nome della chiave);
  2. **freno anti-raffica** prima di toccare GitHub: al massimo un aumento ogni
     20 minuti e 12 al giorno, con lo stato su Firestore
     (`routine-state/release`) e non in memoria — le istanze muoiono e si
     moltiplicano, e un freno che si azzera a ogni riavvio non frena. Il cron
     pubblica ogni sei ore: nessuno dei due tetti intralcia l'uso onesto;
  3. legge `package.json` **da `main`, via API**, col suo `sha` di blob;
  4. **calcola lui** il numero successivo (aumento della patch). Nessun numero
     che arrivi dal chiamante viene letto;
  5. **costruisce lui** il contenuto nuovo partendo da quello vecchio, e
     verifica due volte che cambi SOLO la versione (una riga sola diversa nel
     testo; manifesto identico una volta riletto come dati). Se una delle due
     non torna, non si scrive niente;
  6. scrive il commit `release: vX.Y.Z [skip ci]` con l'identità dell'App,
     legandolo allo `sha` del blob letto: se `main` si è mossa nel mezzo,
     GitHub risponde 409 e non si scrive.
- **Perché non si accetta il contenuto dal chiamante**: sarebbe un push diretto
  su `main` travestito da aumento di versione — cioè il buco che §11 ha chiuso,
  riaperto da un'altra porta.
- **`scripts/release-bump.mjs`** è il citofono: chiede, stampa il numero nuovo
  su stdout e basta. Exit `0` fatto · `2` rifiutato (freno, parola d'ordine,
  manifesto) · `3` server non raggiungibile o funzione assente. Il lavoro di
  pubblicazione poi **rilegge** `main` (una lettura, `git pull --rebase`) e si
  ferma se il numero non combacia: costruire col numero vecchio pubblicherebbe
  sopra una release già esistente.
- Nel lavoro di pubblicazione non è rimasto **nessun** `git push`, `git commit`
  o `npm version`, e una sentinella negli unit test diventa rossa se ci tornano.
