# «Sei loggato» non è un permesso

[← Tutti i pattern](../PATTERNS.md)

Nelle regole Firestore `request.auth != null && email_verified` sembra una
condizione forte. Non lo è. Il login di Filo accetta **qualunque** account
Google, e la chiave web di Firebase sta in un repo pubblico: chiunque, senza
nemmeno scaricare l'app, si autentica con quella chiave e fa una GET REST. Dove
iscriversi costa zero, «loggato» descrive il mondo intero.

Il caso (audit pre-alpha, #581). `config/secrets` era leggibile a quella
condizione, e dentro c'erano le chiavi OpenRouter e Tavily che pagano le
chiamate di **tutti**, più la chiave Google Safe Browsing. Il documento gemello
`config/judgeSecrets` era già `isAdmin()`. **L'asimmetria fra due documenti che
contengono la stessa cosa era la spia**, ed è il segnale da cercare quando si
leggono delle regole.

La regola ha due metà, e vanno scritte insieme.

**Chi legge un segreto condiviso è chi lo gestisce.** Un documento con dentro
credenziali si chiude a `isAdmin()`, oppure lo serve una funzione server che
consegna a ogni richiedente solo il pezzo che gli serve. I livelli veri sono
tre: chiunque, questo utente qui (`request.auth.uid == uid`), admin.
«Autenticato» non è un livello, è il primo travestito da terzo.

**Chiudere la porta senza aprire la strada non è un fix.** Se l'app leggeva quel
documento per funzionare, il cammino va sostituito, non tolto: le chiavi devono
continuare ad arrivare a chi usa Filo senza che debba metterne di proprie. In
Filo la strada è la distribuzione del build. L'admin scrive il documento,
`scripts/bake-default-config.mjs` lo rilegge dal server e lo incastona
nell'installer, l'auto-update lo consegna. È la stessa che serviva già chi non
fa login, cioè la maggioranza. Quando una chiave viveva SOLO nel documento
remoto, come la Safe Browsing, darle quella strada è parte del lavoro:
altrimenti la funzione si spegne in silenzio, e un rilevamento che non trova
niente somiglia molto a uno che funziona.

**Una regola stretta nel repo non è una porta chiusa.** Le regole le pubblica
una mano, non un automatismo: finché non gira `firebase deploy --only
firestore:rules` il confine in produzione è ancora quello di prima, e il lavoro
sembra finito mentre non lo è. E l'ordine conta: **prima si pubblicano le
regole, poi si ruotano le chiavi**. Al contrario le chiavi nuove nascono dentro
un documento che chiunque legge ancora, e la rotazione è da rifare. Chi chiude
una porta così scrive nel report tutti e due i passi, con l'ordine: sono
dell'owner, e nessuno li farà al posto suo.

Dove vive: `firestore.rules` (i blocchi `match /config/…`),
`src/main/services/defaultsStore.js` (legge il documento solo da admin),
`src/main/config/default-keys.js` e `scripts/bake-default-config.mjs` (la strada
del build). La sentinella `tests/unit/firestoreRulesConfigSecrets.test.mjs`
rilegge le regole e diventa rossa se un documento di config nasce con la lettura
aperta a chi è soltanto loggato, così la prossima chiave condivisa non può
ripetere la storia.
