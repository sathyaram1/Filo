## Se il lavoro ha bisogno del server

Il lavoro tocca filo-security, le regole del database o i segreti? Chi ha aperto
il feedback non lo deve sapere: lo scopri tu, e il server lo chiedi tu, appena lo
sai e prima di consegnare altro. Tutto quello che hai fatto deve essere
committato sul ramo:

```bash
node scripts/routine-channel.mjs deliver server --motivo "[cosa serve del server e perché, in due o tre righe]"
```

Decide il server, e in tutti e due i casi chiude il tuo biglietto:

- **concesso** (biglietto pulito, feedback fidato): il lavoro passa alla routine
  dei lavori server dal tuo ramo, e chi riprende riceve il tuo motivo;
- **fermo** (biglietto o feedback non fidati): il feedback va nei Ricevuti come
  «chiede di diventare fidato», senza il tuo testo, perché lì l'owner legge
  l'originale. Se dice sì, il lavoro riparte da capo.

Poi rilascia il biglietto come sempre, senza `--guasto`. Se la risposta è «è già
un lavoro server», hai già l'ambito `server`: continua. Deploy, segreti e prove
sulla macchina dell'owner non si chiedono così: stanno nella sezione qui sotto.
