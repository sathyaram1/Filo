# Classificare per decidere cosa si vede, mai cosa si conserva

[← Tutti i pattern](../PATTERNS.md)

Quando un modello smista roba dell'utente — chat, schede, appunti, file, avvisi —
il suo giudizio può decidere **cosa si mostra per primo**. Non può decidere **cosa
si butta**. Si salva tutto, sempre; la classificazione sposta le cose in vista o
sotto un filtro, e l'utente può sempre arrivare a quello che è stato messo da
parte.

## Perché

Le due direzioni dell'errore non si somigliano nemmeno:

- se il classificatore sbaglia e nasconde qualcosa di buono, costa **un clic**:
  l'utente accende il filtro e la ritrova;
- se sbaglia e butta qualcosa di buono, costa **la cosa, per sempre**, e lo si
  scopre il giorno in cui serviva.

Un classificatore economico sbaglia spesso abbastanza da rendere la seconda
colonna cara. E il costo di tenere è quasi sempre trascurabile: una chat pesa
qualche KB.

Il corollario che si dimentica: **"non classificato" si comporta come
"interessante"**, non come "da nascondere". Una classificazione che non è
riuscita (niente chiave, limite di spesa, rete assente) non deve far sparire
niente — e va tenuta distinta da una classificazione andata a buon fine, così si
può riprovare più tardi invece di credere che il tipo sia già stato deciso.

## Dove vive

L'archivio delle chat con Filo (#525) è il caso di riferimento:

- `src/main/services/filoChats.js` scrive ogni chat per intero, turno per turno,
  e **non ha nessun cap che ruoti via le più vecchie**: un cap È la cancellazione
  automatica, scritta in modo che non si veda;
- `src/shared/chatArchive.js` → `normalizeKind` manda a «conversazione» tutto ciò
  che non è riconoscibile come «comando», e `isVisibleByDefault` tratta il tipo
  mancante come visibile;
- `setTriage` distingue «tipo ignoto» (null, si riproverà: `listUntriaged`) da
  «tipo deciso», e `filo://archive` mostra in vista tutto ciò che non è un
  comando.

Il gemello con il verso opposto è il livello di sicurezza delle azioni
([Azioni di Filo: livello di sicurezza statico nel registro](azioni-di-filo-livello-di-sicurezza-statico-nel-registro.md)):
lì l'incertezza costa ATTRITO (si chiede conferma), non perdita, e infatti il
default è il massimo attrito. La regola sotto è la stessa: si sbaglia dalla parte
in cui l'errore si ripara.
