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
Tredici giri di verifica: le regole qui sotto sono le porte che si sono riaperte più volte.

## Il custode nasce con la sessione

`app.on('session-created')` in `main.js`, prima di qualsiasi finestra: ogni partizione, anche quelle che qualcuno
aggiungerà domani, riceve i tre gestori (richiesta, controllo, schermo) e chiude la scelta dei dispositivi (HID,
seriale, USB; il Bluetooth su `web-contents-created`, perché senza chi sceglie Electron consegna il primo trovato).
La sentinella `tests/unit/permessiSiti.test.mjs` diventa rossa se un altro file chiama `setPermissionRequestHandler`
o se l'aggancio scende sotto `app.whenReady`.

## La domanda sta dove la pagina non arriva

La striscia è della barra in alto e la pagina scende della sua altezza: il sito non la copre, non la tocca, non la
imita. Il «Consenti» si arma dopo un secondo di striscia ferma, per la stessa ragione di
[Una conferma non è un avviso sopra un fatto già compiuto](una-conferma-non-e-un-avviso-sopra-un-fatto-gia-compiuto.md).
La richiesta resta sospesa finché l'utente non risponde: «Nega» si ricorda, la × e l'Esc valgono no per quella volta,
e cambiare documento o chiudere la scheda chiude la domanda con un no. A schermo intero la domanda riporta la
cornice. Fuori da una scheda (finestre di accesso) si chiede con la finestra del sistema; nascosta, no.

## Cose che non si vedono finché non ci si sbatte

- **Filo non usa mai il permesso del sito per sé.** Incolla legge gli appunti dal main (`FILO_READ_CLIPBOARD`), Detta
  apre il microfono nella cornice e rimanda il testo al frame (`handlers/dettatura.js`). Un'esenzione «per tre
  secondi alla scheda» la prendeva anche il sito, che il clic sul menu lo vede e lo sa fabbricare.
- **Il menu di Filo vive nel documento del sito**: si apre solo con un tasto destro vero e i suoi bottoni rispondono
  solo all'input vero (`menu.js`, `onContextMenu`). Le porte del main che danno qualcosa guardano anche l'input
  vero della scheda (`gestoVeroRecente`, da `input-event`), che la pagina non può fabbricare.
- **Il controllo silenzioso non ha il «chiedi».** In Electron `setPermissionCheckHandler` risponde sì o no. Nel mondo
  della pagina (`src/preload/permessi-pagina.js`) «negato» torna «da chiedere» se l'utente non ha detto no;
  `PermissionStatus.name` porta i nomi interni di Chromium (`video_capture`). I riquadri senza indirizzo non hanno
  il preload: li copre la parte che intercetta `contentWindow`.
- **La strada vecchia per lo schermo** (`chromeMediaSource` in `getUserMedia`) salta il gestore dello schermo, e
  certe forme fanno uccidere la scheda dal browser prima di qualsiasi gestore. Si rifiuta nel mondo della pagina; nel
  main uno schermo chiesto da un documento senza indirizzo web si nega.
- **La condivisione dello schermo arriva due volte.** Prima come `media` senza tracce (qui si chiede e si sceglie
  cosa: schermo, scheda, finestra), poi al gestore dello schermo, che consegna la scelta. Non si ricorda mai.
- **Tre chiusure di fila fanno smettere di chiedere** (anche i no che non si ricordano): niente striscia, solo il
  segno sulla scheda, da cui si torna indietro.
- **Il segno sulla scheda** dice cosa il documento ha avuto o si è visto negare; togliere un permesso aperto lo dice
  da qualunque strada (menu, Sicurezza, chat) con «Ricarica». Una finestra chiusa chiude le sue pagine: una
  WebContentsView sopravvive alla finestra, microfono compreso.
- **Incognito ha la sua memoria**, condivisa con le sue schede «da un altro paese» (`segnaIncognito(ses, compagna)`).
  Parte vuota, non eredita e non scrive su disco. Una scrittura dell'ambito normale partita da una finestra incognito
  passa da `fuoriIncognito`, o finirebbe nella RAM di quella finestra.

## Dove vive

- `src/shared/permessiSiti.js`: tipi, innocui, chiusi, frasi, `decidi`, `normalizza`, le parole della chat.
- `src/main/services/permessiSiti.js`: il custode, le domande in attesa, la memoria, i segni, le fonti dello schermo.
- `src/main/services/handlers/permessi.js` e `handlers/dettatura.js`: le porte (vedi
  [Nuovo tipo di messaggio: decidi SUBITO se le pagine web possono chiamarlo](nuovo-tipo-di-messaggio-decidi-subito-se-le-pagine-web.md)).
- `src/preload/permessi-pagina.js`: quello che la pagina legge, e la strada vecchia chiusa.
- `src/renderer/shell.js` (`PERMESSI`): la striscia, la scelta dello schermo, il segno sulla scheda, il tasto destro,
  la dettatura per le pagine web.
- `src/pages/security/`: l'elenco modificabile, con l'incognito a parte. Chat: `PERMESSO_SITO`.
- Prove: `tests/unit/permessiSiti.test.mjs`, `tests/permessi-siti*.spec.mjs`.
