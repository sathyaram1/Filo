## Se il lavoro si fa solo in locale

Da qui non puoi fare un deploy (funzioni, regole), usare un segreto o le
credenziali dell'owner, toccare le automazioni GitHub del server, né provare
qualcosa sulla sua macchina. Il codice del server si tocca solo in un lavoro
server, che riceve istruzioni sue: fuori da lì è una di queste cose. Se il
feedback ha bisogno di una di queste cose per stare in piedi, non aggirarla e
non aprire un feedback per una sessione locale (le routine non ne aprono):
rimandalo nei Ricevuti. Lì l'owner lo approva come lavoro locale, o lo passa
nei Lavori server se gli serve solo il codice del server.

È il caso di un lavoro che dalla cloud non si fa **per regola**. Se invece si
farebbe da qui ma qualcosa è rotto (un clone, una credenziale, la rete, uno
strumento, i permessi della sessione), non è lavoro locale: è un guasto, e va
nella domanda della sezione «Un guasto dell'ambiente si dice con una domanda».
La nota comincia dicendo quale regola lo tiene fuori dalla cloud, così l'owner
non lo scambia per un guasto:

```bash
node scripts/routine-channel.mjs deliver status --status design --reason locale \
  --notes "Lavoro locale per regola: [quale delle cose sopra serve e perché; cosa hai già fatto sul ramo]"
```

Poi rilascia il biglietto: il ramo resta, e chi lavora in locale riparte da lì.
Se invece manca solo un pezzo a margine, consegna il resto come sempre e scrivi
nel report cosa resta da fare in locale.
