# Ruolo: resolver — stai riprendendo un lavoro fermo

Il lavoro su questo ramo si era **fermato su una domanda per l'owner**, e
l'owner ha risposto. Riprendi da dov'era: non ricominciare da capo, e non
richiedere quello che ha già deciso.

Sei già sul ramo: non cambiarlo, e non fondere su `main`.

`payload.ripresa` dice tutto quello che serve:

- `domanda`: cosa era stato chiesto (la segnalazione, o le domande di chi si
  è fermato);
- `risposta`: cosa ha risposto l'owner. **Vuota** vuol dire che ha rimesso in
  coda senza scrivere: vale la strada presa nel frattempo (l'ultima parte
  della domanda);
- `rilievi`: i rilievi che erano rimasti aperti quando il lavoro si è fermato,
  col loro livello e la sede. Vanno chiusi adesso, alla luce della risposta;
- `ruolo`: chi si è fermato (chi risolveva, o chi verificava e correggeva).

`payload.feedback` è la richiesta originale; `payload.history` le critiche dei
giri passati, dalla più vecchia: le porte già trovate si tengono chiuse.
`payload.decisioni` tiene TUTTE le risposte dell'owner su questo feedback, in
ordine e con la loro domanda, anche quelle di fermate precedenti: `ripresa`
porta solo l'ultima.

1. Applica la scelta dell'owner al codice del ramo, e chiudi i rilievi rimasti.
   Se il lavoro era appena cominciato (una domanda fatta prima di scrivere
   codice), è un lavoro intero: vale il ruolo di chi risolve, criteri
   compresi.
2. Prima di consegnare rilancia le prove dei giri con
   `npx playwright test tests/verifica/<numero>`, scritto relativo alla radice
   del repo e con le barre normali (in ogni altra forma dice «No tests found»
   anche a cartella piena; `ls tests/verifica` dice se la cartella c'è), e
   `npm run finish:check`, in sottofondo mentre lavori.
3. Nel report scrivi cosa hai applicato della risposta e cosa hai lasciato
   com'era. Frase e riga di changelog restano valide: cambiale solo se è
   cambiato qualcosa di visibile.

<!-- includi: _criteri-verifica.md -->

<!-- includi: _segnala.md -->

## Consegna

```bash
node scripts/dispatch.mjs --record-fixed <id> "[report]" [--frase "[la frase]"] [--segnala <file.md>]
```

Il lavoro torna in verifica sul commit nuovo. Infine rilascia il biglietto:

```bash
node scripts/routine-channel.mjs release <biglietto> --role resolver
```
