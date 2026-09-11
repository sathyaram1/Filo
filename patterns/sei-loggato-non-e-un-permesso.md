# «Sei loggato» non è un permesso

[← Tutti i pattern](../PATTERNS.md)

Nelle regole Firestore, `request.auth != null && email_verified` sembra una
condizione forte e non lo è. Il login di Filo accetta **qualunque** account
Google, e la chiave web di Firebase sta in un repo pubblico: chiunque, senza
nemmeno scaricare l'app, si autentica con quella chiave e fa una GET REST. Dove
iscriversi costa zero, «loggato» descrive il mondo intero.

Il caso (audit pre-alpha, #581). `config/secrets` — le chiavi OpenRouter e
Tavily che pagano le chiamate di **tutti**, più la chiave Google Safe Browsing —
era leggibile a quella condizione. Il documento gemello `config/judgeSecrets`
era già `isAdmin()`: **l'asimmetria fra due documenti che contengono la stessa
cosa era la spia**, ed è il segnale da cercare quando si leggono delle regole.

La regola, in due metà che vanno scritte insieme:

- **Chi legge un segreto condiviso è chi lo gestisce.** Un documento con dentro
  credenziali si chiude a `isAdmin()` (o si serve da una funzione server che
  consegna solo il pezzo che serve a quel richiedente). I livelli veri sono
  tre: *chiunque*, *questo utente qui* (`request.auth.uid == uid`), *admin*.
  «Autenticato» non è un livello, è il primo travestito da terzo.
- **Chiudere la porta senza aprire la strada non è un fix.** Se l'app leggeva
  quel documento per funzionare, va sostituito il cammino, non tolto: le chiavi
  devono continuare ad arrivare a chi usa Filo senza che debba metterne di
  proprie. In Filo la strada è la **distribuzione del build** — l'admin scrive
  il documento, `scripts/bake-default-config.mjs` lo rilegge dal server e lo
  incastona nell'installer, l'auto-update lo consegna — ed è la stessa che
  serviva già chi non fa login, cioè la maggioranza. Quando una chiave viveva
  SOLO nel documento remoto (era il caso della Safe Browsing), darle quella
  strada è parte del lavoro: altrimenti la funzione si spegne in silenzio, e un
  rilevamento che non trova niente somiglia molto a uno che funziona.

Dove vive: `firestore.rules` (i blocchi `match /config/…`),
`src/main/services/defaultsStore.js` (legge il documento solo da admin),
`src/main/config/default-keys.js` e `scripts/bake-default-config.mjs` (la
strada del build). La sentinella
`tests/unit/firestoreRulesConfigSecrets.test.mjs` rilegge le regole e diventa
rossa se un documento di config nasce con la lettura aperta a chi è soltanto
loggato — così la prossima chiave condivisa non può ripetere la storia.
