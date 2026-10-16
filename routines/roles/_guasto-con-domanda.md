## Un guasto dell'ambiente si dice con una domanda

Guasto è ciò che da qui dovrebbe funzionare e non va, e ti ferma: credenziali,
clone, rete, servizio giù, strumento che manca, permessi della sessione. «Non
posso perché è rotto» è un guasto; «dalla cloud non si fa, per regola»
(segreti, deploy, automazioni GitHub del server, prove sulla macchina
dell'owner) è il rimando in locale, dove l'owner legge un lavoro da approvare.
Un rifiuto di una tua consegna (exit 4) o il canale giù (exit 3) non lo sono.

1. La domanda, coi campi di SPEC-DOMANDE § 3.1 in un JSON fuori dal repo:
   `priorita` `bloccante`; nel `contesto` cosa hai provato e il messaggio
   esatto; il feedback che ferma (`payload.id`) nei `collegamenti`. Il `gruppo`
   è un nome fisso, perché chi cade sullo stesso guasto finisca nello stesso
   gruppo anche se lo descrive con altre parole. I guasti noti:
   - il clone o il token di filo-security: `guasto: filo-security`;
   - GitHub (fetch, push, API): `guasto: github`;
   - l'installazione dei pacchetti: `guasto: npm`;
   - Electron o lo schermo virtuale che non partono: `guasto: electron`.

   Per ogni altro, `guasto: <causa> <nome>`: la causa è una di `credenziali`,
   `clone`, `rete`, `servizio`, `strumento`, `permessi`; il nome è il programma
   che ha fallito (la prima parola del comando) o l'host che non risponde,
   minuscolo, senza percorsi, porte, numeri od orari (`guasto: rete
   registry.npmjs.org`, `guasto: strumento xvfb-run`).
   `node scripts/domanda.mjs chiedi <file.json>` risponde `OK: domanda D-<n>
   aperta.`; con `RIFIUTATO dal server: …`, al posto del numero va quel
   messaggio esatto.
2. Chi risolve o corregge mette il feedback in attesa (sezione «Il feedback
   fermo per un guasto»); per gli altri torna in coda da sé.
3. La domanda di fine sessione, poi `node scripts/routine-channel.mjs release
   <biglietto> --role <il tuo ruolo> --guasto "<gruppo>, D-<n>: <messaggio>"`.

<!-- includi: _dopo-un-guasto.md -->
