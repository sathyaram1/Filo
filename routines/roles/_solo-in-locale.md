## Se il lavoro si fa solo in locale

Da qui non puoi fare un deploy (funzioni, regole), usare un segreto o le
credenziali dell'owner, toccare le automazioni GitHub del server, né provare
qualcosa sulla sua macchina. Non lo fa nemmeno una sessione sul suo PC: lì non
si lavora, e le routine non ne aprono. Quello che manca prende una di due
strade, e in tutte e due non si aggira niente.

- **Il codice del server** lo fa la routine dei lavori server, che riceve
  istruzioni sue. Se il feedback ne ha bisogno e il tuo biglietto non le ha,
  consegna quello che hai fatto sul ramo così:

  ```bash
  node scripts/routine-channel.mjs deliver status --status design --reason locale \
    --notes "Per regola: [cosa serve sul server e perché; cosa hai già fatto sul ramo]"
  ```

  Su un feedback fidato il server lo segna come lavoro server e lo rimette in
  coda: lo riprende quella routine, dal tuo ramo. Su uno non fidato chiede
  all'owner di renderlo fidato.
- **Un passo che solo l'owner può fare** (un segreto, un deploy, un'automazione
  di GitHub, una prova sulla sua macchina) è una domanda: la stessa consegna
  con `--domanda <file.json>` (il formato della sezione «Un trade-off vero non
  lo decidi tu: lo chiedi»), con l'opzione `riprendi` per quando l'ha fatto e
  `archivia` per lasciar stare.

È il caso di un lavoro che dalla cloud non si fa **per regola**. Se invece si
farebbe da qui ma qualcosa è rotto (un clone, una credenziale, la rete, uno
strumento, i permessi della sessione), è un guasto, e va nella domanda della
sezione «Un guasto dell'ambiente si dice con una domanda». La nota comincia
dicendo quale regola lo tiene fuori dalla cloud, così l'owner non lo scambia
per un guasto.

Poi rilascia il biglietto: il ramo resta, e chi riprende riparte da lì. Se
invece manca solo un pezzo a margine, consegna il resto come sempre e chiedi
quel pezzo con una domanda a sé (`node scripts/domanda.mjs chiedi <file.json>`).
