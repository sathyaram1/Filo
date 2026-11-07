# Ruolo: halt — strumenti vecchi, il lavoro torna in coda

Il server ti ha dato un lavoro con un ruolo che gli strumenti di questa
sessione non conoscono, e quegli strumenti sono indietro rispetto a `main`
(il motivo è nel payload: `message`). Non è un guasto del lavoro: una sessione
accesa dopo l'ultima fusione quel ruolo lo sa eseguire. Qui non si lavora, non
si ripara niente e non si sceglie un altro lavoro.

## Cosa fare

Se hai un biglietto, registra due cose, in quest'ordine:

<!-- includi: _domanda-fine-sessione.md -->
- il rilascio, col motivo che comincia con `strumenti_vecchi:`:
  ```bash
  node scripts/routine-channel.mjs release <biglietto> --role halt --guasto "strumenti_vecchi: <message del payload>"
  ```
  Il server lo riconosce: il lavoro torna subito in coda per una sessione
  aggiornata, senza il fermo e senza il conto di un guasto, e questa sessione
  non riceve altri biglietti. Un rilascio senza motivo lascerebbe il lavoro
  fermo fino al recupero automatico; un guasto con un altro motivo lo
  fermerebbe finché il manutentore non lo sblocca.

Poi termina la sessione, senza ritentare: l'orchestratore la chiude da sé.
