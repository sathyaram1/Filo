# Se basta l'indirizzo, l'indirizzo È la chiave — e un indirizzo non si revoca

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Quando chiudi una raccolta di dati, chiudi anche il modo di prendere
UN elemento alla volta. Se il singolo resta aperto a chi ne conosce l'indirizzo,
l'indirizzo diventa la chiave; e a differenza di una chiave vera, un indirizzo
non si cambia e non si revoca. Prima di lasciare aperto un `get`, chiediti dove
sono finiti quegli indirizzi finora.

## Il caso

Audit pre-alpha, feedback #583. I documenti dei feedback si leggevano senza
credenziali e il lavoro li ha chiusi. Nel deposito degli allegati ha chiuso
l'elenco (`list`) e ha lasciato aperto il singolo file (`get: if true`), con
questa motivazione scritta accanto alla regola:

> Get: aperto (la dashboard mostra immagini e file via link diretto, e quei link
> portano già il loro token di download).

Quella frase è esattamente il motivo per cui la regola non serviva. Se il link
porta il codice, è il codice ad aprire il file: Firebase lo valuta prima delle
regole. Il `get` aperto non dava niente a chi aveva diritto di leggere, e dava
tutto agli altri. Provato sul deposito vero: 87 KB di fotografia scaricati col
solo indirizzo, senza credenziali, e 200 anche mettendo un codice sbagliato.

Il danno non era teorico. Gli indirizzi degli allegati stavano DENTRO i
documenti dei feedback, cioè proprio le cose che fino a quel giorno leggeva
chiunque. Chi li aveva raccolti se li teneva, screenshot dei tester compresi, e
per gli allegati anteriori al 25 giugno 2026 nemmeno cifrati.

La parte peggiore è la seconda. Quando un link scappa, la cura di serie è
cambiare il codice di scarico di quel file. Con il `get` aperto quella cura non
serve a niente, perché il file si prende lo stesso dall'indirizzo: la chiusura
non era solo incompleta, rendeva impossibile ripararla dopo.

## Come si è chiusa

`allow get: if false`. Chi passa dalle regole non scarica niente; resta valido
il link col codice, che è come la dashboard ha sempre letto (l'indirizzo non
finisce mai dentro un `<img>`: lo manda al main, che scarica e decifra). Il
server dei giudici usa l'Admin SDK e le regole le bypassa.

Verificato con l'emulatore ufficiale di Storage PRIMA di chiudere, perché
chiudere alla cieca avrebbe spento tutte le immagini della dashboard senza far
diventare rossa nessuna prova: link col codice 200, solo indirizzo 403, codice
sbagliato 403. La controprova con la regola di prima mostra le stesse due righe
a 200.

## Il seguito che quasi sfuggiva

Da quel momento il codice di scarico non è un ornamento del link: è la chiave.
Il caricamento lo ometteva in silenzio quando il deposito non lo rilasciava, e
finché il file era aperto a chiunque funzionava lo stesso. Dopo la chiusura
quello sarebbe stato un allegato perso senza che nessuno lo sapesse, scoperto
settimane dopo aprendo il feedback e trovando un buco. Adesso il caricamento
rifiuta e chi invia ritrova il nome del file fra quelli non caricati.

È la parte da cercare ogni volta che si chiude una porta: cosa nel codice dava
per scontato che fosse aperta, e cosa succede a chi ci passava.

## Dove guardare

- `storage.rules`, blocco `/feedback/{file=**}`
- `src/shared/feedback.js` → `uploadImage`
- `tests/unit/firestoreRulesFeedbackRead.test.mjs` (la sentinella sempre accesa)
- `tests/unit/feedbackAllegatoSenzaCodice.test.mjs`
- `tests/verifica/583/giro8-deposito-col-motore-vero.mjs` (la prova col motore vero)
