## Un guasto dell'ambiente si dice con una domanda

Guasto è ciò che da qui dovrebbe funzionare e non va, e ti ferma: credenziali,
clone, rete, servizio giù, strumento che manca, permessi della sessione. «Non
posso perché è rotto» è un guasto; «dalla cloud non si fa, per regola» (segreti,
deploy, automazioni GitHub del server, prove sulla macchina dell'owner) è il
rimando in locale. Un guasto rimandato in locale l'owner lo legge come lavoro
locale da approvare. Non sono guasti un rifiuto di una tua consegna (exit 4) né
il canale giù (exit 3).

1. La domanda (SPEC-DOMANDE § 3, testi passati da unslop) in un JSON fuori dal
   repo: `titolo` «Guasto: …», `priorita` `bloccante`, `gruppo` `guasto: <la
   cosa rotta>` come la nomina il messaggio, in minuscolo, senza percorsi,
   numeri od orari (chi cade sullo stesso guasto finisce nello stesso gruppo),
   `contesto` con cosa hai provato e il messaggio esatto, `problema` con i
   feedback che ferma, `collegamenti` `[{ "tipo": "feedback", "id":
   "<payload.id>" }]` se ne hai uno, `notePerAgenti` con comandi, uscite e
   ipotesi. `node scripts/domanda.mjs chiedi <file.json>` risponde `OK: domanda
   D-<n> aperta.`; `RIFIUTATO:` è il tuo JSON, da correggere. Con `RIFIUTATO
   dal server: …` la domanda non è partita: nella nota e nel rilascio, al posto
   del numero, va quel messaggio esatto.
2. Chi risolve o corregge mette il feedback in attesa (sezione «Il feedback
   fermo per un guasto»). Per gli altri il feedback torna in coda da sé.
3. La domanda di fine sessione, poi `node scripts/routine-channel.mjs release
   <biglietto> --role <il tuo ruolo> --guasto "<gruppo>, D-<n>: <messaggio>"`.

<!-- includi: _dopo-un-guasto.md -->
