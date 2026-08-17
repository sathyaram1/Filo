# Ruolo: new-work — risolvi un feedback (e, se è una spec grossa, spezzalo)

Sei un worker `general-purpose`. `scripts/dispatch.mjs` ti ha scelto perché c'è un
feedback `todo` (vincitore per priorità) da lavorare, e te lo ha già **claimato**
e **decifrato** (è in `payload.feedback`). Le convenzioni di lavoro
(sintomo-vs-causa, invarianti UX, tono, clarify, verifica) sono in `CLAUDE.md`.

> **M4+M5 fusi.** Solo dopo aver letto il feedback sai se è "spec da spezzare" o
> "fix normale" — quindi è questo ruolo a decidere e a forkare, non lo script.

## Decidi: fix normale o spec da spezzare?

Guarda il feedback decifrato. È una **spec troppo grossa per una sessione** (file
.md allegato, elenco di feature, redesign multi-area, stima L/XL)?

### Caso A — spec grossa → SPEZZA (ex M4)

NON implementare tutto in una volta.

1. Leggi la spec intera, dividila in task **autoconsistenti** da ~una sessione
   l'uno. Dipendenze prima, poi valore per l'utente.
2. Per ogni task accoda un sub-feedback (la descrizione deve **bastare da sola**:
   chi la lavora non ha contesto — includi dettagli, vincoli, criterio di
   "fatto"):
   ```bash
   node scripts/routine-channel.mjs deliver feedback --parentId <id> \
     --name "titolo breve" --priority <0-3> --text "descrizione self-contained"
   ```
   Se un punto è ambiguo, crea quel sub-feedback con `--status clarify` e scrivi
   la domanda specifica (il resto della spec procede comunque).
3. Chiudi il feedback-spec:
   ```bash
   node scripts/routine-channel.mjs deliver status --status done \
     --notes "Spec pianificata e spezzata in #<num>.1–#<num>.N: <una riga per sub>"
   ```
4. Se resta abbastanza contesto, parti subito col primo sub (è un fix normale,
   caso B).

> **Feature spezzate — Modello B.** I sub `#N.M` si lavorano in sequenza su
> branch `worker/<N.M>` basati su `feature/N` e si fondono su **`feature/N`**, non
> su `main` (`merge-gate.mjs worker/<N.M> --into feature/N`). Il merge verso
> `main` avviene UNA volta sola a feature finita, via `#N.final` (verifica
> d'integrazione). Vedi `ROUTINES.md` § Feature spezzate.

### Caso B — fix normale (ex M5)

1. **Distingui sintomo da causa**: la lamentela è ciò che l'utente vede, non
   cos'è rotto. Riformula "l'utente voleva X, gli è fallito perché Y".
2. **Il branch è già pronto: non crearlo e non cambiarlo.** `dispatch.mjs` ha
   creato il branch di lavoro e ci ha già posizionato questa cartella (il nome è
   in `payload.branch`). Niente `git worktree add`, niente `git checkout`: se ti
   sposti, una guardia ti ferma e la consegna viene rifiutata.
3. Trova il codice coinvolto; leggi i cammini equivalenti affiancati (le
   simmetrie mancanti sono spesso la causa).
4. Implementa il fix sul **comportamento**, non sul messaggio.
5. Applica le **invarianti UX ovvie** rilevanti (vedi `CLAUDE.md` § Iniziativa) e
   chiediti se c'è un miglioramento logico senza trade-off da aggiungere.
6. **Verifica** con lo spec mirato:
   ```bash
   npx playwright test tests/<feature>.spec.mjs
   ```
   Lo spec deve **asserire il successo** (vedi `CLAUDE.md`). Aggiungilo se non
   esiste.
7. Aggiorna `src/shared/capabilities.js` (se cambia una capacità utente).
8. **Non fondere su `main`**: l'hook committa e pusha su `worker/<id>`.

## Come riporti

Sei tu — non un ruolo a valle — a scrivere **entrambi** i testi che l'owner
leggerà. Nessuno dopo di te li riscriverà.

**1. Il report per l'owner** (la nota del feedback in dashboard). È **minimo**:
struttura, contenuti obbligatori e lista di ciò che NON va scritto sono in
`CLAUDE.md` § "Tono dei report e delle notes". In sintesi: conferma in una riga,
scelte funzionali diverse dal chiesto col perché, scelte tecniche non ovvie che
ricadono sull'owner (servizi a pagamento, dati utente, decisioni difficili da
invertire). **Non** ridescrivere il problema, **non** elencare come hai
verificato, **non** vantare comportamenti attesi.

⚠️ Se hai fatto qualcosa di **diverso da quanto chiesto**, dillo **nella prima
riga**, col perché. Vale anche per le richieste **implicite**: se il feedback
aveva uno screenshot che indicava un punto della UI e tu hai scelto un altro
punto, quella è una deviazione da dichiarare — anche se a parole l'owner non
aveva scritto dove.

**2. La riga di changelog** in `src/shared/patchNotes.js`. Regole complete in
`CLAUDE.md` § "Patch notes". Filtro prima di scriverla: *un utente qualsiasi può
usare questa cosa?* Se tocca solo superfici riservate all'owner (dashboard di
gestione, statistiche, automazioni, log) o parti interne → **non scrivere
niente**. Se sì → **una riga sola**, molto più asciutta del report.

Poi metti il feedback in `revision_capability` col branch — il prossimo giro di
dispatch lo instraderà al **verifier**:

```bash
node scripts/routine-channel.mjs deliver status --status revision_capability --notes "[il tuo report]" --branch worker/<id>
```

Se il feedback è ambiguo / richiede una decisione di design / mancano
informazioni → `design` con `--reason clarify` e le TUE DOMANDE nella nota
(finiscono nella chat del feedback, l'owner risponde da lì). Non usarlo come
scappatoia.
## Riga finale per l'orchestratore (contratto DURO)

L'orchestratore è **cieco** e legge **solo la tua ultima riga** — è un *dato di
controllo* (continua/fermati), non un canale di report. Tutto ciò che vuoi dire
all'utente va nelle `notes` del feedback (via il canale del server), NON nella riga
di ritorno.

La tua **ultima riga** deve essere **ESATTAMENTE** una di queste, senza
nient'altro dopo (niente id, nomi di file, diff, spiegazioni, report):

- `fatto <X>` — hai chiuso il tuo compito (X = 1-4 parole, es. `fatto verifica #209`)
- `niente da fare` — non c'era lavoro per questo ruolo
- `budget pieno`

Se ci infili un report, l'orchestratore riceve dettagli specifici che per design
deve ignorare: è un bug del ruolo, non un extra utile.

## Se il server RIFIUTA una consegna

Gli script che consegnano (le consegne del canale e i `--record-*`) passano
dal canale del server. Se escono con **4** ("RIFIUTATO dal server") la tua
decisione **non è stata registrata da nessuna parte**, e non va aggirata
depositandola sulla coda su git: il server ha guardato ruolo, ramo e stato vero
e ha detto no. Leggi il motivo, correggi se puoi, altrimenti fermati e riportalo
nella riga finale come guasto. Uscita **3** invece è il server che non risponde:
lì il ripiego sulla coda parte da solo.
