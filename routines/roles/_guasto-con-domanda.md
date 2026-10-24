## Un guasto dell'ambiente si dice con una domanda

Guasto è ciò che da qui dovrebbe funzionare e non va, e ti ferma. «Non posso
perché è rotto» è un guasto; «dalla cloud non si fa, per regola»
(segreti, deploy, automazioni GitHub del server, prove sulla macchina
dell'owner) non lo è: è un passo dell'owner, che si chiede con una domanda.
Un rifiuto di una tua consegna (exit 4) o il canale giù (exit 3) non lo sono.

**Il controllo di sicurezza salta il passo 1**: il server prende domande solo
da chi risolve, corregge o verifica, e a lui risponderebbe sempre di no. Per lui
basta il rilascio del passo 3, con `--guasto "<gruppo>: <messaggio>"` e il
gruppo scritto come al passo 1.

1. La domanda, coi campi di SPEC-DOMANDE § 3.1 in un JSON fuori dal repo,
   scritta come dice la sezione «Una domanda per l'owner si scrive per lui»:
   `priorita` `bloccante`; nel `contesto` cosa hai provato e cosa vuol dire
   l'errore, in parole tue; il messaggio esatto in `notePerAgenti`; il feedback
   che ferma (`payload.id`) nei `collegamenti`. Il `gruppo`
   è un nome fisso, così chi cade sullo stesso guasto finisce nello stesso:
   `guasto: filo-security` (clone o token), `guasto: github`, `guasto: npm`,
   `guasto: electron` (anche lo schermo virtuale); per gli altri `guasto:
   <causa> <nome>`, la causa fra `credenziali` `clone` `rete` `servizio`
   `strumento` `permessi`, il nome il programma fallito o l'host che non
   risponde, minuscolo (`guasto: rete openrouter.ai`).
   Chi risolve o corregge la consegna insieme alla fermata (passo 2), e il
   numero `D-<n>` lo stampa la risposta della consegna. Gli altri la aprono con
   `node scripts/domanda.mjs chiedi <file.json>`, con `"blocca": false` (il
   lavoro torna in coda da sé), che risponde `OK: domanda D-<n> aperta.`; con
   `RIFIUTATO dal server: …`, al posto del numero va quel messaggio esatto.
2. Chi risolve o corregge mette il feedback in attesa con la domanda (sezione
   «Il feedback fermo per un guasto»); per gli altri torna in coda da sé.
3. La domanda di fine sessione, poi `node scripts/routine-channel.mjs release
   <biglietto> --role <il tuo ruolo> --guasto "<gruppo>, D-<n>: <messaggio>"`.

<!-- includi: _dopo-un-guasto.md -->

<!-- includi: _domanda-per-owner.md -->
