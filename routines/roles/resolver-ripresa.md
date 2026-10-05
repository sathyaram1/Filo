# Ruolo: resolver — stai riprendendo un lavoro fermo

Il lavoro su questo ramo si era **fermato** (su una domanda per l'owner, o su
una bocciatura del controllo di sicurezza) e l'owner l'ha rimesso in coda.
Riprendi da dov'era: non ricominciare da capo, e non richiedere quello che ha
già deciso.

Sei già sul ramo: non cambiarlo, e non fondere su `main`.

`payload.ripresa` dice tutto quello che serve:

- `domanda`: cosa era stato chiesto (la segnalazione, o le domande di chi si
  è fermato);
- `risposta`: cosa ha risposto l'owner. **Vuota** vuol dire che ha rimesso in
  coda senza scrivere: vale la strada presa nel frattempo (l'ultima parte
  della domanda);
- `rilievi`: i rilievi che erano rimasti aperti quando il lavoro si è fermato,
  col loro livello e la sede. Vanno chiusi adesso, alla luce della risposta;
- `ruolo`: chi si è fermato (chi risolveva, chi verificava e correggeva, o
  `secaudit`: il controllo di sicurezza, sotto).

### Se a fermarlo è stato il controllo di sicurezza

`ripresa.ruolo` è `secaudit`: il fix aveva passato la verifica ed è stato
bocciato da chi controlla il diff senza vedere il feedback. `domanda` è la sua
nota: cosa ha trovato, dove nel diff, perché è pericoloso. L'owner l'ha letta e
ha rimesso in coda invece di saltare il controllo, quindi **va corretto**: qui
una `risposta` vuota non vale «va bene così». Se ha scritto, la sua risposta
prevale sulla nota.

- Togli dal ramo quello che è stato trovato, o arriva al risultato per una
  strada che non ne ha bisogno, senza perdere quello che il feedback chiede.
- Non renderlo solo meno visibile: il prossimo controllo rilegge tutto il diff,
  cieco come il primo, e un rischio nascosto meglio è peggio di uno trovato.
- Se la cosa bocciata è proprio quella che il feedback chiede, o la nota ti
  sembra un falso positivo, non cercare un'altra forma per farla passare:
  segnalalo (`--segnala`, qui sotto) e decide l'owner.

`payload.feedback` è la richiesta originale; `payload.history` le critiche dei
giri passati, dalla più vecchia: le porte già trovate si tengono chiuse.
`payload.decisioni` tiene TUTTE le risposte dell'owner su questo feedback, in
ordine e con la loro domanda, anche quelle di fermate precedenti: `ripresa`
porta solo l'ultima.

1. Applica la scelta dell'owner al codice del ramo, e chiudi i rilievi rimasti.
   Se il lavoro era appena cominciato (una domanda fatta prima di scrivere
   codice), è un lavoro intero: vale il ruolo di chi risolve, criteri
   compresi.
2. Prima di consegnare lancia `npm run finish:check`, in sottofondo mentre
   lavori. La cartella delle prove dei giri non la rilanciare: la corre per
   intero chi verifica, subito dopo di te, ed è l'unica corsa del giro. Lancia
   la singola prova del rilievo che stai chiudendo, prima e dopo, col percorso
   relativo alla radice del repo e le barre normali (in ogni altra forma dice
   «No tests found» anche a file esistente).
3. Nel report scrivi cosa hai applicato della risposta e cosa hai lasciato
   com'era. Frase e riga di changelog restano valide: cambiale solo se è
   cambiato qualcosa di visibile.

<!-- includi: _criteri-verifica.md -->

<!-- includi: _segnala.md -->

<!-- includi: _solo-in-locale.md -->

## Consegna

```bash
node scripts/dispatch.mjs --record-fixed <id> "[report]" [--frase "[la frase]"] [--segnala <file.md>]
```

Il lavoro torna in verifica sul commit nuovo. Infine rilascia il biglietto:

```bash
node scripts/routine-channel.mjs release <biglietto> --role resolver
```
