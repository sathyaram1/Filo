# Nuovo tipo di messaggio: decidi SUBITO se le pagine web possono chiamarlo

[← Tutti i pattern](../PATTERNS.md)

Il canale `filo:message` è **uno solo** e ci arrivano sia le pagine interne
(shell, `filo://`) sia i content script delle pagine web esterne. Registrare un
handler senza dire nulla significa **aprirlo a qualunque sito visitato**: è il
default sbagliato, e non ce ne si accorge finché qualcuno non lo cerca.

- **Domanda obbligatoria** per ogni `MSG.*` nuovo: *"ha senso che un sito
  qualsiasi lo chiami?"*. Se la risposta è no — e lo è per tutto ciò che legge
  dati dell'utente, tocca il disco, o aziona il sistema operativo — gattalo:
  ```js
  const isFilo = (origin) => String(origin || '').startsWith('filo://');
  on(MSG.X, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    …
  });
  ```
  (`origin` è il terzo argomento dell'handler; la shell è `filo://shell/shell.html`.)
- **Due bandiere rosse** che rendono il gate non negoziabile: la risposta
  contiene **percorsi assoluti su disco** (rivelano lo username e la struttura
  del computer), oppure il comando fa **aprire/eseguire qualcosa** al sistema
  (`shell.openPath`, `showItemInFolder`, spawn). Un sito che può far aprire un
  file appena scaricato, su Windows, può farlo eseguire.
- **Documentalo dove il messaggio è definito** (`src/shared/messages.js`), non
  solo nell'handler: chi aggiunge il messaggio gemello lo vede.
- **Testalo** con un dispatch di origine web: `SN_HANDLE_MESSAGE(msg, { tab: {
  url: 'http://sito-ostile.example/' }, url: '…' })` deve dare `forbidden`, e la
  stessa chiamata da `filo://` deve passare. Esempi:
  `tests/downloads-nav.spec.mjs`, `tests/clipboard-origin-gate.spec.mjs`,
  `tests/audit-quit-app-origin.spec.mjs`.

## Un canale mezzo aperto si governa con l'elenco di ciò che è LECITO

Qualche canale non è né tutto aperto né tutto chiuso: i content script ci fanno
una cosa sola e legittima, e tutto il resto non li riguarda. `update_settings` è
così: dalle pagine web serve solo per scegliere il modello di dettatura dal menu
del tasto destro.

Lì il gate non è un `forbidden`, è un filtro, e il filtro va scritto al
contrario di come viene da sé. Per un anno è stato un elenco di **divieti** —
prima le chiavi API, poi anche lo stile dell'agente — e tutto quello che nessuno
aveva ancora pensato passava: accendere la modalità terminale, cioè il permesso
che dà a Filo la shell; spegnere il rilevamento dei siti pericolosi, l'ad-block,
il blocco dei popup; mettere i cookie su «manuale»; alzare il limite di spesa;
dirottare il modello che risponde in chat (#592, giro 4). Un elenco di divieti
dice «tutto è permesso tranne quello che mi sono ricordato», e un'impostazione
nuova nasce permessa per dimenticanza.

L'elenco di ciò che è lecito è più corto, si legge tutto in una schermata, e
un'impostazione nuova nasce vietata. Il filtro tiene anche la FORMA, non solo il
nome: `models` passa, ma solo la voce della dettatura, e solo se è una stringa.
Se dopo il filtro non resta niente, non si scrive e non si annuncia niente: un
annuncio a vuoto farebbe rileggere tutte le pagine di impostazioni aperte.

Sta in `src/main/services/handlers/storage.js` (`AMMESSE_DA_WEB`), provato in
`tests/impostazioni-pagina-aperta.spec.mjs`.

## Chiudendo un messaggio, guarda quelli che c'erano già

Il gate si mette quasi sempre mentre si scrive un messaggio nuovo, e lì lo
sguardo è sul nuovo. Ma un messaggio nuovo che legge i dati dell'utente quasi
mai è il primo: di solito ce n'è uno vecchio, scritto quando la domanda non se
la faceva nessuno, che restituisce **le stesse identiche righe** con un altro
nome. Gattare solo il nuovo lascia in piedi una chiusura aggirabile chiedendo la
stessa cosa col nome di prima.

Successo così con la memoria di Filo (#592, giro 7): tre messaggi nuovi per
leggerla e cancellarla dall'utente, tutti e tre chiusi alle pagine web, con la
ragione scritta accanto. Nove righe più su, `filo_get_memory` rispondeva a
chiunque e restituiva profilo e preferenze apprese per intero.

Quindi, quando gatti un messaggio: cerca gli altri che toccano lo stesso dato
(`grep` sul nome del modulo che li serve, non sul nome del messaggio) e gattali
insieme.

E **l'elenco del test non si scrive a mano**: ricavalo dai nomi nel catalogo dei
messaggi, così un messaggio nuovo sulla stessa cosa nasce dentro la prova invece
che fuori.

```js
const nomi = Object.entries(MESSAGES)
  .filter(([k]) => /^FILO_/.test(k) && /MEMORY|LESSON/.test(k))
  .map(([, v]) => v);
```

Esempio in `tests/memoria-di-filo.spec.mjs`.
