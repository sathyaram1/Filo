# Una raccolta condivisa si affetta nel percorso, non in un filtro

[← Tutti i pattern](../PATTERNS.md)

Se di una raccolta il client deve poter leggere **una fetta alla volta**, la
chiave della fetta va nel PERCORSO del documento, non in un campo. Una regola
Firestore non può pretendere che una query abbia un certo `where`: vede chi
chiede e cosa c'è scritto nel documento, non il filtro. Quindi «l'app chiede
solo i suoi» non è un confine — è una buona abitudine del client, e il client
lo scrive chiunque abbia la chiave web (che è pubblica per progetto e sta nel
repo).

Il caso (#584, audit pre-alpha). I percorsi dell'assistente di pagina stavano
in `paths/{doc}` con `allow read: if true`, e il client filtrava per dominio.
Chi filtra può anche non filtrare: una `runQuery` senza `where` scaricava la
collezione intera, e in ogni documento c'erano `clientId` e user agent in
chiaro — con sei tester che si conoscono, il profilo di navigazione di ognuno,
ricucito su tutti i domini. Il campo `domain` è diventato un segmento:
`paths/<dominio>/entries`. Adesso «chiedere» vuol dire nominare un dominio, e
l'elenco completo non è una cosa che esista.

Le tre condizioni reggono **insieme**, e vanno scritte insieme:

- **Il livello di sopra si chiude in lettura.** `match /paths/{domain}` con
  `allow read: if false`: lì vivono i documenti della vecchia forma piatta (che
  restano, e che nessuno deve più poter scaricare) e, soprattutto, elencarlo
  darebbe l'elenco delle chiavi — i domini su cui qualcuno ha chiesto aiuto
  sono già un'informazione.
- **Niente match ricorsivo nel file.** Una collection group query su `entries`
  rimetterebbe insieme tutti i domini in un colpo solo, e il motore la accetta
  se e solo se esiste un `match /{p=**}/entries/{doc}`. Non averlo è la difesa:
  per questo la sentinella controlla l'ASSENZA di `=**` in tutto il file, non
  la presenza di una riga.
- **Il documento non porta identificativi del mittente.** Affettare serve a
  non far scaricare tutto in una volta, ma chi conosce i domini li chiede uno
  per uno. La fetta regge solo se dentro non c'è niente da ricucire: via
  `clientId` e user agent (nessuno dei due serviva a chi RIUSA un percorso), e
  l'ora arrotondata, perché due scritture a quaranta secondi di distanza su
  domini diversi sono quasi una firma.

La regola vale anche a rovescio: **se la fetta non basta** — cioè se il
documento contiene qualcosa che chi legge non deve vedere — il percorso non è
la strada, e la lettura va dietro una funzione server-side che filtra i campi,
come per `redteam-attempts`.

Dove vive: `firestore.rules`, blocco `match /paths/{domain}`;
`src/shared/paths.js` (la lettura per dominio e la scrittura senza mittente);
`tests/unit/pathsRegoleLettura.test.mjs` (la sentinella sempre accesa) e
`tests/unit/pathsRegole.motore-vero.mjs` (le stesse regole provate con
l'emulatore).
