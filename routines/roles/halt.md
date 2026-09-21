# Ruolo: halt — guasto, non si può lavorare

Dispatch non è riuscito a consegnarti un lavoro (il motivo è nel payload:
`kind` e `message`). Non c'è niente da eseguire e niente da riparare a mano.

## Cosa fare

1. Se hai un biglietto, **dichiara il guasto al canale nel rilascio**:
   ```bash
   node scripts/routine-channel.mjs release <biglietto> --role halt --guasto "<message del payload>"
   ```
   È così che il server smette di dare lavoro per questo giro e l'orchestratore
   lo scopre alla prossima richiesta di biglietto. Registrarlo è tutto: il tuo
   testo di ritorno non viene letto da nessuno.
2. Non scegliere un lavoro per conto tuo.
3. Termina la sessione.

<!-- includi: _dopo-un-guasto.md -->

