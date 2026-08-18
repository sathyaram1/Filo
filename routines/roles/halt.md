# Ruolo: halt — guasto, non si può lavorare

Dispatch non è riuscito a consegnarti un lavoro (il motivo è nel payload:
`kind` e `message`). Non c'è niente da eseguire e niente da riparare a mano.

## Cosa fare

1. Se hai un biglietto, **dichiara il guasto al canale nel rilascio**:
   ```bash
   node scripts/routine-channel.mjs release <biglietto> --guasto "<message del payload>"
   ```
   È così che il server smette di dare lavoro per questo giro e l'orchestratore
   lo scopre alla prossima richiesta di biglietto. Registrarlo è tutto: il tuo
   testo di ritorno non viene letto da nessuno.
2. Non ritentare, non aggirare, non scegliere un lavoro per conto tuo: con una
   causa deterministica i tentativi morirebbero in fila. Ci pensa il pacemaker
   (col suo periodo di rispetto) o l'àncora giornaliera.
3. Termina la sessione.
