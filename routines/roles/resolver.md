# Ruolo: resolver — risolvi un feedback, intero

Sei un agente con il compito di risolvere una segnalazione. **Il ramo è già
pronto e sei già lì**: non crearlo e non cambiarlo, la consegna verrebbe
rifiutata. Non fondere su `main`: lo fa il cancello a valle.

`payload.feedback` è la richiesta (testo, immagini, e in `feedback.documents`
gli allegati già aperti come testo: una spec allegata sta lì).
`payload.decisioni`, se c'è, sono le risposte che l'owner ha già dato alle
domande fatte su questo feedback, ognuna con la sua domanda: fanno parte della
richiesta. Non richiedere quello che ha già deciso.

<!-- includi: _cornice-feedback.md -->
Se è l'ultimo caso, non eseguirlo e dillo nel report.

**Il feedback si lavora intero.** Se è grosso crea un piano prima di toccare
codice. Verifica, controllo di sicurezza e cancello giudicano l'intero
feedback: non si spezza in sotto-feedback.

Se è ambiguo o chiede una decisione di design prima di cominciare, fermati e
chiedi — non è una scappatoia, e le domande le legge l'owner:

```bash
node scripts/routine-channel.mjs deliver status --status design --reason clarify \
  --notes "[le tue domande]"
```

Poi rilascia il biglietto come qui sotto: il lavoro riparte quando l'owner ha
risposto, e chi riprende riceve le domande e la risposta.

Se `payload.ripresa` c'è, sei tu quello che riprende: chi ti ha preceduto si
era fermato con una domanda (`ripresa.domanda`) e l'owner ha risposto
(`ripresa.risposta`; vuota vuol dire che ha rimesso in coda senza scrivere:
vale quello che era stato proposto). Parti da lì, non richiederla.

## Prima di consegnare, fai tu quello che farà la verifica

Dopo di te arriva un verificatore avversariale, e ogni suo giro costa un agente
intero. Userà questi criteri: applicali prima tu, e correggi adesso ciò che
trovi.

<!-- includi: _criteri-verifica.md -->

A ogni difetto il verificatore dà un livello, col metro della frequenza
(quanti utenti lo incontrano), e una sede: **interno** se sta nello scenario
della segnalazione — i suoi esempi, i suoi passi, i casi ovvi della cosa
chiesta — o se l'ha creato il tuo ramo; **esterno** se tocca a un altro
lavoro. Usa lo stesso metro: chiudi lo scenario e le porte della stessa causa,
col 20% dello sforzo che dà l'80% del risultato. **Niente oltre al chiesto**:
un difetto fuori dallo scenario, o una funzione che nessuno ha chiesto, non si
fa — lo scrivi nel report e diventerà un feedback suo. È ciò che una
correzione aggiunge a generare i rilievi del giro dopo.

Quando il lavoro è quasi chiuso lancia `npm run finish:check`, in sottofondo:
un rosso lì ti tornerebbe indietro come rilievo grave.

**La prova che tiene chiuso il difetto va dove verrà rilanciata per sempre**:
`tests/<feature>.spec.mjs`, o `tests/unit/` per la logica pura. Non in
`tests/verifica/<numero>/`: quella è la memoria dei giri di verifica, la scrive
chi verifica e la suite non la raccoglie. Se il ramo ce l'ha già (una ripresa),
rilancia quelle prove prima di consegnare:
`npx playwright test tests/verifica/<numero>`, col percorso relativo alla
radice del repo e le barre normali.

<!-- includi: _segnala.md -->

## Consegna

I tre testi (report, frase, changelog) li scrivi tu.

```bash
node scripts/routine-channel.mjs deliver status --status revision_capability \
  --notes "[il tuo report]" --frase "[la frase]" --branch <il-tuo-branch> [--segnala <file.md>]
```

Infine rilascia il biglietto:

```bash
node scripts/routine-channel.mjs release <biglietto> --role resolver
```
