# Liste/chat che si ricostruiscono in streaming: auto-follow SOLO se sei in fondo

[← Tutti i pattern](../PATTERNS.md)

Una lista che si **rirenderizza di continuo** mentre arriva contenuto (una chat
con risposta in streaming, un log dal vivo) non deve **strappare lo scroll**
all'utente. Il pattern anti-attrito:

- Prima di ricostruire, misura se l'utente è **vicino al fondo**
  (`scrollHeight - scrollTop - clientHeight < ~48px`). Segui il fondo
  (`scrollTop = scrollHeight`) **solo se lo era**; altrimenti **ripristina la sua
  posizione** (`scrollTop = prevTop`) — così può leggere a metà mentre genera.
- Attenzione al **clamp**: se ricostruisci svuotando e reinserendo i figli,
  all'istante in cui il contenitore è vuoto `scrollHeight` collassa e il browser
  clampa `scrollTop` a 0. Non basta "non seguire il fondo": senza ripristino
  esplicito la vista **salta in cima**. Cattura `prevTop` PRIMA di svuotare.
- Un'eccezione esplicita "vai comunque in fondo" serve quando è **l'utente** a
  produrre il nuovo contenuto (ha appena inviato un messaggio: vuole vederlo) o
  all'apertura (mostra l'ultimo scambio). Passala come flag, non come default.
- **Dove:** `renderChat`/`renderBuilder` in `src/pages/decks/decks.js` (flag
  `stickBottom`/`stickChat`). Test `tests/decks-chat-scroll.spec.mjs` (scroll su
  mentre genera → posizione conservata; resti in fondo → segue). Stessa regola
  nel riquadro della spiegazione: `scrollaConservando()` in
  `src/content/popup.js`, test `tests/popup-scroll-streaming.spec.mjs`.
