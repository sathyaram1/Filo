## Un guasto dell'ambiente si dice con una domanda

Un **guasto** è qualcosa che da qui dovrebbe funzionare e non funziona, e ti
impedisce il lavoro: una credenziale respinta, un clone che fallisce, la rete,
un servizio giù, uno strumento che manca, un comando fermato dai permessi della
sessione. Se il tuo ruolo dice come andare avanti senza quella cosa, vale
quello. I due casi da non confondere:

- «non posso perché è rotto» → guasto: la domanda qui sotto;
- «dalla cloud non si fa, per regola» (segreti, deploy, automazioni GitHub del
  server, prove sulla macchina dell'owner) → il rimando in locale, dove il tuo
  ruolo lo prevede.

Un guasto rimandato in locale arriva all'owner come una richiesta di approvare
un lavoro locale, e nessuno lo legge come guasto. Non sono guasti un rifiuto
del server a una tua consegna (exit 4: si legge e si corregge) né il canale
giù (exit 3: lì non parte nemmeno la domanda, e ti fermi).

Davanti a un guasto, in quest'ordine:

1. **La domanda all'owner**, in un file JSON fuori dal repo
   (`../guasto-<numero>.json`), nella forma di SPEC-DOMANDE § 3. I testi per
   l'owner passano da `.claude/skills/unslop/SKILL.md`, senza nomi di file o
   di funzioni.

   ```json
   {
     "titolo": "Guasto: <cosa non funziona, in una riga>",
     "priorita": "bloccante",
     "gruppo": "guasto: <la cosa rotta>",
     "contesto": "<cosa stavi facendo e cosa hai provato>. Il messaggio: «<esatto>».",
     "problema": "<quali feedback ferma e cosa vuol dire in pratica>",
     "opzioni": [
       { "testo": "Riprendere quando il guasto è riparato", "pro": "<…>", "contro": "<…>",
         "azione": { "tipo": "riprendi", "feedbackId": "<payload.id>" } },
       { "testo": "Farlo in locale", "pro": "<…>", "contro": "<…>",
         "azione": { "tipo": "approva_locale", "feedbackId": "<payload.id>" } },
       { "testo": "Archiviare il feedback", "pro": "<…>", "contro": "<…>",
         "azione": { "tipo": "archivia", "feedbackId": "<payload.id>" } }
     ],
     "consiglio": { "opzione": 0, "perche": "<perché questa>" },
     "collegamenti": [{ "tipo": "feedback", "id": "<payload.id>" }],
     "notePerAgenti": "<i comandi provati con l'uscita intera, le ipotesi sulla causa, cosa resta sul ramo>"
   }
   ```

   - `gruppo` è il nome del guasto: `guasto: ` e la cosa rotta come la nomina
     il messaggio (il repo, l'host, il servizio, il comando), in minuscolo,
     senza percorsi, numeri od orari. Chi cade sullo stesso guasto scrive lo
     stesso gruppo, e le domande stanno insieme.
   - Nel `problema`, il feedback che ferma è il tuo (`payload.num`); gli
     identificativi delle azioni e del collegamento sono `payload.id`.
   - Le opzioni valgono per chi mette il feedback in attesa (passo 2). Per gli
     altri ruoli il feedback torna in coda da sé quando il guasto passa: togli
     opzioni e consiglio e tieni il collegamento. Senza un feedback
     (l'esplorazione) togli anche quello. L'owner archivia la domanda quando
     il guasto è riparato.

   ```bash
   node scripts/domanda.mjs chiedi ../guasto-<numero>.json
   ```

   Risponde `OK: domanda D-<n> aperta.`. Un `RIFIUTATO:` senza «dal server» è
   il tuo JSON: correggilo e rilancia. Con `RIFIUTATO dal server: …` la domanda
   non è partita: nella nota e nel rilascio, al posto del numero, va quel
   messaggio esatto.
2. **Il feedback in attesa**: chi risolve o corregge ha la ricetta nelle sue
   istruzioni, nella sezione «Il feedback fermo per un guasto».
3. La domanda di fine sessione, poi **il rilascio col guasto**:

   ```bash
   node scripts/routine-channel.mjs release <biglietto> --role <il tuo ruolo> \
     --guasto "<gruppo>, D-<n>: <il messaggio, accorciato>"
   ```

<!-- includi: _dopo-un-guasto.md -->
