## Se il lavoro si fa solo in locale

Da qui non puoi toccare il codice del server, fare un deploy (funzioni,
regole), usare un segreto o le credenziali dell'owner, né provare qualcosa
sulla sua macchina. Se il feedback ha bisogno di una di queste per stare in
piedi, non aggirarla e non aprire un feedback per una sessione locale (le
routine non ne aprono): rimandalo nei Ricevuti. Lì l'owner lo approva come
lavoro locale, e lo prende una sessione sulla sua macchina.

```bash
node scripts/routine-channel.mjs deliver status --status design --reason locale \
  --notes "[cosa va fatto in locale e perché; cosa hai già fatto sul ramo]"
```

Poi rilascia il biglietto: il ramo resta, e chi lavora in locale riparte da lì.
Se invece manca solo un pezzo a margine, consegna il resto come sempre e scrivi
nel report cosa resta da fare in locale.
