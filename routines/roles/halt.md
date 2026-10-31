# Ruolo: halt — guasto, non si può lavorare

Dispatch non è riuscito a consegnarti un lavoro (il motivo è nel payload:
`kind` e `message`). Non c'è niente da eseguire e niente da riparare a mano,
e non scegli un lavoro per conto tuo.

## Cosa fare

Se hai un biglietto, registra due cose, in quest'ordine:

<!-- includi: _domanda-fine-sessione.md -->
- il guasto → **dichiaralo al canale nel rilascio**:
  ```bash
  node scripts/routine-channel.mjs release <biglietto> --role halt --guasto "<message del payload>"
  ```
  È così che il server ferma questo lavoro, e solo questo, finché una nota
  del manutentore o la correzione della causa non lo sblocca. Il tuo testo di
  ritorno non viene letto da nessuno: quello che non hai registrato non esiste.

Poi termina la sessione.

<!-- includi: _dopo-un-guasto.md -->
