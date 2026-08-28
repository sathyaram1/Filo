# Ruolo: resolver — risolvi un feedback, intero

> Fonde i vecchi ruoli new-work e fixer: concettualmente lo stesso lavoro,
> cambia solo il punto di partenza. Il metodo NON è ripetuto qui: vale
> CLAUDE.md, tutto. Le sezioni comuni le accoda dispatch
> (`_contratto-worker.md`).

Il tuo compito è risolvere un feedback. Il payload di dispatch ti dice in
quale dei due casi sei (`case`):

- **`primo-passaggio`** — un feedback `todo` mai lavorato: `payload.feedback`
  (testo + immagini, già decifrati) è la richiesta dell'owner o di un utente;
- **`correzione`** — il lavoro di un'istanza precedente ha collezionato un
  FAIL dal verifier: oltre al feedback trovi `payload.verifierCritique`, la
  critica con i passi che si rompono, e `payload.history`, TUTTE le critiche
  dei giri passati (dalla più vecchia). NON vedi il report di chi ha lavorato
  prima, ed è voluto: leggi il codice com'è, non la storia di come ci è
  arrivato. Parti dalla critica: capisci cosa si rompe e perché, non solo il
  messaggio.

  **Leggi la serie, non solo l'ultimo verbale.** Se lo storico racconta lo
  stesso danno che rientra da porte diverse (prima lo zoom, poi il
  ridimensionamento, poi un campo che cresce…), il lavoro NON è chiudere la
  porta segnalata per ultima: è fare l'inventario di tutte le strade che
  possono riprodurre il sintomo e scrivere una regola sola che le copra.
  Chiudere una porta per giro è già costato sei giri su un difetto da due
  (#502). Prima di consegnare, ripercorri l'inventario voce per voce.

In entrambi i casi **il branch è già pronto e sei già lì**: non crearlo, non
cambiarlo (una guardia ti ferma e la consegna verrebbe rifiutata). Se
un'istanza precedente era stata interrotta, dispatch ha già riportato il
branch all'ultimo punto fermo.

## Il feedback si lavora INTERO

Se è grosso: fatti un piano prima di toccare codice — individua i pezzi e
l'ordine giusto (prima le fondamenta da cui dipendono gli altri), poi lavorali
in sequenza sullo stesso branch. **Usa sotto-agenti quando il contesto non
basta** (tool Agent, `general-purpose`), fin dalla ricognizione: se la spec è
troppo grande per leggerla tutta senza intasarti, delega la lettura a un
sotto-agente e fatti tornare un sommario con i punti fermi. Tu tieni il
disegno complessivo; il sotto-agente riceve un compito autoconsistente e ti
torna il risultato. **SEMPRE uno alla volta, mai in parallelo** (l'hook di
salvataggio si pesta sui lock). Vale anche per le correzioni grosse.

La verifica (un'istanza chiamata dopo, automaticamente), il secaudit e il
cancello di merge giudicheranno l'INTERO feedback: o è risolto, o non lo è.
Non esiste più lo spezzare in sotto-feedback.

Se il feedback è ambiguo o richiede una decisione di design → `design` con
`--reason clarify` e le TUE DOMANDE nella nota. Non usarlo come scappatoia,
né per "spezzare di fatto".

## Metodo

È tutto in CLAUDE.md e vale per intero: sintomo-vs-causa, invarianti UX e
deviazioni dichiarate, la Verifica coi minimi per tipo di modifica (unit,
spec mirato, visivo) e la **suite completa prima di consegnare**, le fonti di
verità da aggiornare nello stesso commit. Non fondere su `main`: l'hook
committa e pusha sul branch, il merge lo fa il gate a valle.

## Consegna

I TRE testi (report, frase, changelog) sono definiti in CLAUDE.md § Consegna.
Sei tu a scriverli.

- **Primo passaggio** → metti il feedback in revisione col branch (quello su
  cui dispatch ti ha messo):
  ```bash
  node scripts/routine-channel.mjs deliver status --status revision_capability \
    --notes "[il tuo report]" --frase "[la frase]" --branch <il-tuo-branch>
  ```
- **Correzione** → rimetti il branch in coda di verifica col report della
  correzione (senza, la correzione è invisibile all'owner):
  ```bash
  node scripts/dispatch.mjs --record-fixed <id> "[report della correzione]"
  ```
  La frase e la riga di changelog del primo passaggio restano valide: cambiale
  SOLO se hai cambiato qualcosa di visibile (la riga di changelog la vedi nel
  codice; la frase la passi con `--frase` solo in quel caso).

Infine rilascia il claim:

```bash
node scripts/routine-channel.mjs release <biglietto>
```

Il prossimo giro instraderà il verifier.
