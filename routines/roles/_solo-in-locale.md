## Se il lavoro si fa solo in locale

Da qui non puoi fare un deploy (funzioni, regole), usare un segreto o le
credenziali dell'owner, toccare le automazioni GitHub del server, né provare
qualcosa sulla sua macchina. Il codice del server si tocca solo in un lavoro
server, che riceve istruzioni sue. Sul PC dell'owner non lavora più nessuno:
non rimandarci il feedback, e non aprirne uno per una sessione locale (le
routine non ne aprono). Quando il feedback ha bisogno di una di queste cose
per stare in piedi, non aggirarla: le strade sono due, e valgono **per
regola**.

- **Serve il codice del server** e tu non hai le istruzioni del lavoro server.
  Consegna così, e il resto lo decide il server: un feedback fidato passa alla
  routine dei lavori server, che riparte dal tuo ramo con la tua nota; uno non
  fidato va davanti all'owner come richiesta di renderlo fidato.

  ```bash
  node scripts/routine-channel.mjs deliver status --status design --reason locale \
    --notes "Per regola: [cosa serve sul server e perché; cosa hai già fatto sul ramo]"
  ```

- **Serve un passo che solo l'owner può fare** (un segreto, un'automazione
  GitHub, una prova sulla sua macchina). Chiediglielo con una domanda scritta
  come dice la sezione «Una domanda per l'owner si scrive per lui», e consegnala
  con lo stesso comando, aggiungendo `--domanda <file.json>`: il lavoro aspetta
  la sua risposta e poi riparte dal ramo.

Se invece si farebbe da qui ma qualcosa è rotto (un clone, una credenziale, la
rete, uno strumento, i permessi della sessione), non è per regola: è un
guasto, e va nella domanda della sezione «Un guasto dell'ambiente si dice con
una domanda».

Poi rilascia il biglietto. Se manca solo un pezzo a margine, consegna il resto
come sempre e scrivi nel report cosa resta da fare e perché.
