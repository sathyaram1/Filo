- **Un conto, un posto.** Una regola che il lavoro aggiunge o cambia (un
  calcolo, una soglia, un elenco, un formato, una decisione) vive in un punto
  solo, e chi ne ha bisogno la chiama. Se la stessa regola sta anche altrove,
  nel diff o nel resto del codice, chi domani ne corregge una lascia indietro
  l'altra, e il difetto torna dalla metà non toccata. La copia che resta
  indietro di solito sta FUORI dal diff: si cerca nel codice.
- **Prove che bastano.** Ogni comportamento che il lavoro aggiunge o cambia ha
  una prova che ne asserisce il successo, rossa senza il lavoro, sul codice che
  l'app usa davvero: una prova che chiama un pezzo che l'app non usa non tiene
  niente. Il numero non decide: molte prove su una strada e nessuna sull'altra
  non bastano. Le conta `node scripts/conta-prove.mjs` (con `--base <commit>`
  per una parte sola del lavoro; in un lavoro server, con `--server <clone>`,
  anche quelle del server, come le conta la lettura del diff).
