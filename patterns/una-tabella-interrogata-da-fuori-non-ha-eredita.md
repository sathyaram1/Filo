# Una tabella interrogata con una chiave scelta da fuori non ha eredità

**Regola.** Se la chiave con cui si interroga una tabella la sceglie qualcuno
che non sei tu, la tabella si costruisce con `Object.create(null)`. E chi legge
il risultato controlla che sia della forma che si aspetta, invece di fidarsi del
fatto che sia diverso da vuoto.

## Il caso

Verifica #582, giro 7. Due tabelle, due file lontani, la stessa causa.

La prima decide se un indirizzo è un allegato del deposito di Filo. È una
tabella indicizzata per nome di dominio, e il nome di dominio sta dentro la
segnalazione, cioè lo sceglie chi la manda, che può essere chiunque e senza
account. Quella risposta decide due cose: se scaricare, e se firmare la
richiesta col gettone di chi riceve le segnalazioni.

```js
const PREFISSI_ALLEGATO = { 'firebasestorage.googleapis.com': [...], ... };
const prefissi = PREFISSI_ALLEGATO[u.hostname];
return !!prefissi && prefissi.some((p) => u.pathname.startsWith(p));
```

In una tabella normale alcuni nomi ci sono già senza che nessuno ce li abbia
messi. `PREFISSI_ALLEGATO['__proto__']` torna il prototipo degli oggetti;
`['constructor']` torna una funzione. Tutti e due passano il `!!`, e poi il
`.some()` esplode, perché quella roba un elenco non è. La domanda non rispondeva
più: lanciava.

La seconda tabella dà il tipo di un allegato dall'estensione del nome del file
(`scripts/claude-feedback.mjs`). Stessa forma, danno diverso: un file chiamato
`note.__proto__` si faceva dare un «tipo» che non è una stringa, passava il
controllo «è un tipo ammesso?» perché quell'oggetto è vero, e partiva verso il
deposito con `data:[object Object]` al posto del tipo.

## Perché non bastava che cadesse dal lato chiuso

Il primo caso non apriva niente: il gettone non partiva e l'allegato non si
scaricava. È il motivo per cui è stato classificato in fondo alla scala. Ma una
domanda di sicurezza che al posto di «no» tira un'eccezione smette di essere una
risposta e diventa un guasto, e chi guardava un allegato leggeva un errore
generico invece della frase che dice che quello non è un allegato di Filo. La
differenza fra «no» e «si è rotto qualcosa» è tutta per chi legge.

E la garanzia non è stabile: cade dal lato chiuso per come è scritto il codice
attorno, non per una proprietà della tabella. Il secondo caso, con la stessa
identica causa, cadeva dal lato aperto.

## La cura

```js
const PREFISSI_ALLEGATO = Object.assign(Object.create(null), { … });
…
return Array.isArray(prefissi) && prefissi.some((p) => u.pathname.startsWith(p));
```

Le due metà servono tutte e due. `Object.create(null)` toglie i nomi che nessuno
ha messo. `Array.isArray` (o `typeof === 'string'`, secondo cosa la tabella
contiene) tiene la risposta giusta anche il giorno in cui qualcuno riscrive la
tabella come un oggetto normale senza sapere perché non lo era.

Un `Set` o una `Map` non hanno questo problema: se quello che ti serve è
«appartiene a questo elenco?», sono la struttura giusta e la domanda non si pone
(`SN_FEEDBACK_ATTACH` usa dei `Set` proprio per questo).

## Dove guardarlo

- `src/shared/feedback.js` → `PREFISSI_ALLEGATO`, `isAttachmentUrl`
- `scripts/claude-feedback.mjs` → `MIME_PER_ESTENSIONE`, `mimeDiAllegato`
- Le guardie: `tests/unit/storageRulesAllegati.test.mjs`, le due prove sui nomi
  di dominio e sui tipi «di serie».
