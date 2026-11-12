**Il motivo va nella consegna**, con `--motivo`: senza, la correzione non parte
e il biglietto non si chiude. È il perché sei stato chiamato, come l'hai
trovato tu, e serve a capire da dove vengono i riallineamenti. Una forma sola:

- `--motivo "conflitto: <file>, <file>"`: tutti i file che il rebase ha messo in
  conflitto; `--motivo "conflitto: nessuno"` se il rebase è andato liscio e la
  critica non elenca unit rossi;
- `--motivo "prove rosse: <prova>, <prova>"`: rebase liscio, e la fusione si era
  fermata per gli unit rossi che la critica elenca;
- `--motivo ripresa`: riprendi dopo una risposta dell'owner;
- `--motivo "altro: <cosa è successo>"` per tutto il resto.
