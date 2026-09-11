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

## Il potere di proprietario passa da UNA porta, non da nove

`isAdmin()` da solo non è un gate. Sul computer di chiunque altro la risposta è
no e non succede niente; su quello dell'owner è sempre sì, ed è l'unico dove c'è
qualcosa da prendere. Il controllo che conta è l'ORIGINE, e va chiesto **prima**
dell'identità.

Il caso (#583, tre giri di verifica). L'audit ha dato il controllo di
provenienza alla porta che legge i feedback. Il secondo giro ha trovato che le
porte che li SCRIVONO non ce l'avevano, e le ha chiuse. Il terzo giro ha trovato
che nello stesso file restavano cinque porte con lo stesso potere e senza
controllo: cambiare i modelli predefiniti (che valgono per tutte le
installazioni di Filo), accendere e spegnere l'automazione, i bilanci dei giri
di correzione, i modelli dei giudici, i registri del lavoro e delle routine. Tre
giri, una porta alla volta.

La cura non è ricordarsi il gate a ogni handler:

- **Una funzione sola** che avvolge l'handler e fa i due controlli in ordine
  (origine, poi amministratore), e **ogni** handler con potere di proprietario
  ci passa. In Filo è `ownerOnly` in
  `src/main/services/handlers/auth.js`. Un handler che non ci passa si vede a
  occhio nell'elenco dei `on(MSG.…)`: `async (` invece di `ownerOnly(async (`.
- **Il rifiuto per provenienza porta il motivo in una parola** (`code:
  'forbidden'`), diverso da quello per identità (`code: 'not_admin'`). Senza,
  una pagina di Filo traduce il rifiuto in «controlla la connessione» e manda a
  guardare la cosa sbagliata.
- **Una prova che bussa a TUTTE le porte della famiglia** da un sito visitato,
  in un elenco solo: è lì che si aggiunge la porta nuova, e diventa rossa se una
  risponde qualcosa di diverso.
  (`tests/feedback-canali-origine.spec.mjs`.)
