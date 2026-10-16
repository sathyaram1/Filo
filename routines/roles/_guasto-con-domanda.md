## Un guasto dell'ambiente si dice con una domanda

Guasto è ciò che da qui dovrebbe funzionare e non va, e ti ferma: credenziali,
clone, rete, servizio giù, strumento che manca, permessi della sessione. «Non
posso perché è rotto» è un guasto; «dalla cloud non si fa, per regola»
(segreti, deploy, automazioni GitHub del server, prove sulla macchina
dell'owner) è il rimando in locale, che l'owner legge come lavoro da approvare.
Un rifiuto di una tua consegna (exit 4) o il canale giù (exit 3) non lo sono.

1. La domanda (SPEC-DOMANDE § 3, testi passati da unslop) in un JSON fuori dal
   repo: `titolo` «Guasto: …», `priorita` `bloccante`, `gruppo` `guasto: <la
   cosa rotta>` come la nomina il messaggio, minuscolo, senza percorsi, numeri
   od orari (chi cade sullo stesso guasto finisce nello stesso gruppo),
   `contesto` (cosa hai provato, il messaggio esatto), `problema` (i feedback
   che ferma), `collegamenti` `[{ "tipo": "feedback", "id": "<payload.id>" }]`,
   `notePerAgenti` (comandi, uscite, ipotesi). Poi `node scripts/domanda.mjs
   chiedi <file.json>` → `OK: domanda D-<n> aperta.` `RIFIUTATO:` è il tuo
   JSON, da correggere; con `RIFIUTATO dal server: …` nella nota e nel rilascio
   va quel messaggio esatto, al posto del numero.
2. Chi risolve o corregge mette il feedback in attesa (sezione «Il feedback
   fermo per un guasto»); per gli altri torna in coda da sé.
3. La domanda di fine sessione, poi `node scripts/routine-channel.mjs release
   <biglietto> --role <il tuo ruolo> --guasto "<gruppo>, D-<n>: <messaggio>"`.

<!-- includi: _dopo-un-guasto.md -->
