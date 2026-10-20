# Una prova che guarda un momento lo tiene aperto lei

[← Tutti i pattern](../PATTERNS.md)

Una prova che deve vedere uno stato di passaggio (la risposta scritta a metà, il ragionamento in
corso, la riga di un'azione prima dei suoi argomenti) non lo insegue dentro una finestra di
millisecondi: il modello finto si ferma su una promessa e riparte quando la prova chiama
`globalThis.__…()`. E un'azione che apre un sito apre una pagina del server di prova
(`testServer.html(…, { pubblico: true })`), mai un sito vero.

## Il caso (#1321)

Sotto carico (quattro esecuzioni in parallelo) le prove della chat della home cadevano a caso.

- La risposta in streaming usciva in tre pezzi a 500 ms l'uno dall'altro, e la prova doveva vedere
  la testa senza la coda in quel mezzo secondo. In più l'azione apriva example.com. Il turno aspetta
  fino a 5 s che la scheda aperta arrivi (`esitoApertura`), e la prova ne concedeva 3: con la rete
  lenta, o senza rete come nei contenitori, il rosso era sicuro.
- Il ragionamento in corso durava 3,6 s, e la prova doveva cliccarci due volte e fare una foto prima
  che arrivasse la risposta.
- La riga «Avvio un timer…» restava in testa 2,5 s.

Con la macchina scarica bastavano. Con la macchina carica no, e il rosso non diceva niente del codice.

## La regola

- Il modello finto si ferma dove la prova deve guardare: `const vista = new Promise((r) => {
  globalThis.__metaVista = r; })`, poi `await vista` prima del pezzo successivo. La prova guarda,
  poi `await app.evaluate(() => globalThis.__metaVista())`. Senza il comportamento provato la prova
  resta rossa lo stesso: lo stato atteso non arriva mai.
- La fine del turno si aspetta su un segno della pagina (il tasto d'invio che torna al posto del
  quadrato, il bottone dell'azione), con un tetto che copre le attese che l'app fa apposta. Un tetto
  stretto sopra un'attesa voluta è un rosso a caso.
- Un'attesa che prova un'assenza nel tempo («nessuna scritta, nemmeno dopo un secondo») resta:
  guarda che non succeda niente, non scommette che qualcosa arrivi prima di un orologio.

## Dove vive

`tests/dashboard-chat-streaming.spec.mjs`, `tests/dashboard-chat-attivita.spec.mjs` (A e B),
`tests/dashboard-chat-strumenti.spec.mjs` (C).

Vicini: [Un test chiede al sistema, non presume quello su cui è nato](un-test-chiede-al-sistema-non-presume-quello-su-cui-e-nato.md),
[La risposta di un invoke sorpassa gli eventi in diretta](la-risposta-di-un-invoke-sorpassa-gli-eventi-in-diretta.md).
