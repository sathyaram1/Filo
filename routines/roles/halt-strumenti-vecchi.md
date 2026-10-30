# Ruolo: halt — strumenti vecchi, il lavoro torna in coda

Il server ti ha dato un lavoro con un ruolo che gli strumenti di questa
sessione non conoscono, e quegli strumenti sono indietro rispetto a `main`
(il motivo è nel payload: `message`). Non è un guasto: una sessione accesa
dopo l'ultima fusione quel ruolo lo sa eseguire. Non c'è niente da eseguire e
niente da riparare a mano, e non scegli un lavoro per conto tuo.

## Cosa fare

Se hai un biglietto, registra due cose, in quest'ordine:

<!-- includi: _domanda-fine-sessione.md -->
- il rilascio, **senza `--guasto`**:
  ```bash
  node scripts/routine-channel.mjs release <biglietto> --role halt
  ```
  Così il lavoro torna subito in coda per una sessione aggiornata. Un guasto
  dichiarato qui fermerebbe per un'ora le accensioni di tutte le routine, per
  un difetto che non c'è. L'orchestratore chiude la sessione da sé: alla sua
  prossima richiesta di biglietto trova gli strumenti vecchi.

Poi termina la sessione, senza ritentare.
