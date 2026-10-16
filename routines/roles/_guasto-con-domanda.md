## Un guasto dell'ambiente si dice con una domanda

Guasto è ciò che da qui dovrebbe funzionare e non va, e ti ferma: credenziali,
clone, rete, servizio giù, strumento che manca, permessi della sessione. «Non
posso perché è rotto» è un guasto; «dalla cloud non si fa, per regola»
(segreti, deploy, automazioni GitHub del server, prove sulla macchina
dell'owner) è il rimando in locale, che l'owner legge come lavoro da approvare.
Un rifiuto di una tua consegna (exit 4) o il canale giù (exit 3) non lo sono.

1. La domanda, coi campi di SPEC-DOMANDE § 3.1 in un JSON fuori dal repo:
   `priorita` `bloccante`; nel `contesto` cosa hai provato e il messaggio
   esatto; il feedback che ferma (`payload.id`) nei `collegamenti`. Il `gruppo`
   è `guasto: ` e la cosa rotta come la nomina il messaggio, minuscolo, senza
   percorsi, numeri od orari: chi cade sullo stesso guasto finisce nello stesso
   gruppo. `node scripts/domanda.mjs chiedi <file.json>` risponde `OK: domanda
   D-<n> aperta.`; con `RIFIUTATO dal server: …`, al posto del numero va quel
   messaggio esatto.
2. Chi risolve o corregge mette il feedback in attesa (sezione «Il feedback
   fermo per un guasto»); per gli altri torna in coda da sé.
3. La domanda di fine sessione, poi `node scripts/routine-channel.mjs release
   <biglietto> --role <il tuo ruolo> --guasto "<gruppo>, D-<n>: <messaggio>"`.

<!-- includi: _dopo-un-guasto.md -->
