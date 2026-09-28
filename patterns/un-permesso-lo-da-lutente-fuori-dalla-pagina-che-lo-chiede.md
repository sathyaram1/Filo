# Un permesso lo dà l'utente, fuori dalla pagina che lo chiede

[← Tutti i pattern](../PATTERNS.md)

Fotocamera, microfono, posizione, notifiche, appunti, schermo e tutto ciò che non è sicuramente innocuo passano da
un «Consenti» che l'utente dà nella striscia sotto le schede. Il custode si monta sulla sessione quando nasce, in un
posto solo, e il silenzio vale no.

## Il caso che l'ha fatto nascere

Feedback #586, audit di sicurezza prima dell'alpha. Senza gestori Electron concede tutto: un sito qualunque
accendeva la webcam, leggeva la posizione e mandava notifiche senza che comparisse niente. L'unico gestore che
c'era (#514, lo schermo pieno dopo un Esc) finiva con `callback(true)` e si montava a mano da `_makeView`, quindi
una sessione nata per un'altra strada (incognito, scheda da un altro paese, finestra di prova) partiva scoperta.

## Il custode nasce con la sessione

`app.on('session-created')` in `main.js`, prima di qualsiasi finestra: ogni partizione, anche quelle che qualcuno
aggiungerà domani, riceve i tre gestori (richiesta, controllo, schermo). La sentinella
`tests/unit/permessiSiti.test.mjs` diventa rossa se un altro file chiama `setPermissionRequestHandler` o se
l'aggancio scende sotto `app.whenReady`.

## La domanda sta dove la pagina non arriva

La striscia è della barra in alto e la pagina scende della sua altezza: il sito non la copre, non la tocca, non la
imita. Il «Consenti» si arma dopo un secondo di striscia ferma, per la stessa ragione di
[Una conferma non è un avviso sopra un fatto già compiuto](una-conferma-non-e-un-avviso-sopra-un-fatto-gia-compiuto.md):
la striscia nasce dove la pagina ha appena mandato il cursore. La richiesta resta sospesa finché l'utente non
risponde: «Nega» si ricorda, la × vale no per quella volta, e cambiare documento o chiudere la scheda chiude la
domanda con un no.

## Cose che non si vedono finché non ci si sbatte

- **Il controllo silenzioso non ha il «chiedi».** In Electron `setPermissionCheckHandler` risponde sì o no: un sito
  senza scelta legge `Notification.permission === 'denied'`. Chi guarda prima di chiedere non chiede più; per quei
  siti la strada è Sicurezza o il tasto destro sulla scheda.
- **Filo e il sito condividono la sessione.** «Incolla» e «Detta» leggono appunti e microfono dal content script, e
  la richiesta arriva col nome del sito. Prima di chiedere mandano `PERMESSO_FILO`: vale tre secondi, tre usi, e
  solo per quella scheda. Senza, l'utente vedrebbe il sito chiedere una cosa che ha chiesto lui, e un «Consenti»
  lì regalerebbe il permesso al sito.
- **La condivisione dello schermo arriva due volte.** Prima come `media` senza tracce (qui si chiede), poi al
  gestore dello schermo, che trova la scelta lasciata dal «Consenti». Non si ricorda mai: ogni volta si sceglie.
- **Incognito ha la sua memoria.** Parte vuota, non eredita e non scrive su disco. Una scrittura dell'ambito
  normale partita da una finestra incognito passa da `fuoriIncognito`, o finirebbe nella RAM di quella finestra.
- **Fuori da una scheda non c'è dove chiedere** (popup di login, finestre nascoste): vale il no, salvo un sì già dato.

## Dove vive

- `src/shared/permessiSiti.js`: tipi, innocui, frasi, `decidi`, `normalizza`.
- `src/main/services/permessiSiti.js`: il custode, le domande in attesa, la memoria.
- `src/main/services/handlers/permessi.js`: le porte (tutte `soloFilo` tranne `PERMESSO_FILO`, vedi
  [Nuovo tipo di messaggio: decidi SUBITO se le pagine web possono chiamarlo](nuovo-tipo-di-messaggio-decidi-subito-se-le-pagine-web.md)).
- `src/renderer/shell.js` (`PERMESSI`): la striscia, l'icona sulla scheda in sottofondo, il tasto destro.
- `src/pages/security/`: l'elenco modificabile.
- Prove: `tests/unit/permessiSiti.test.mjs`, `tests/permessi-siti.spec.mjs`.
