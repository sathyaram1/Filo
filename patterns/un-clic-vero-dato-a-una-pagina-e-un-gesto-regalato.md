# Un clic vero dato a una pagina è un gesto regalato

[← Tutti i pattern](../PATTERNS.md)

Quando Filo preme qualcosa al posto dell'utente può farlo in due modi. Il clic
dello script (`el.click()` dal content script) è finto: la pagina lo riconosce
(`isTrusted` è falso) e non le dà niente che non abbia già. Il clic del main
(`webContents.sendInputEvent`) è identico a quello del mouse: la pagina ci vede
un gesto dell'utente, e con un gesto può aprire finestre, andare a schermo
pieno, far suonare, chiedere permessi che Filo concede solo dopo un clic.

Il caso (#737). YouTube ignora il clic dello script sul «Salta» della
pubblicità, quindi serve il clic vero. Ma il content script trova il pulsante
dalla sua classe, e la classe la può scrivere qualunque sito: un sito che si
disegna un `.ytp-skip-ad-button` avrebbe ricevuto un gesto vero ogni volta che
voleva.

## La regola

- **Il clic vero lo decide il main, su un elenco di siti dove serve**, mai il
  content script: la sua richiesta porta solo un punto, il main ricontrolla
  interruttore, scheda, frame principale e sito (`src/main/services/adSkip.js`).
  Altrove resta il clic dello script.
- **Il punto si controlla nella pagina prima di chiederlo**: lì sopra deve
  esserci proprio il pulsante (`elementFromPoint`), perché un clic vero nel
  punto sbagliato apre la pubblicità. Coperto o fuori dalla vista: si aspetta.
- **Non interrompe l'utente**: se sta scrivendo in un campo o tiene premuto il
  mouse, il clic vero sposterebbe il fuoco o romperebbe il trascinamento, e
  aspetta. Dopo il clic il puntatore torna dov'è davvero.
- **Un tetto di frequenza nel main** (uno ogni 800 ms per scheda): un content
  script che sbaglia non diventa una raffica di clic.
- **Lo zoom della scheda** moltiplica il punto: `sendInputEvent` parla in pixel
  della vista, la pagina in pixel CSS. Una scheda in secondo piano ha la vista
  grande zero ma la pagina tiene la sua misura, e il clic le arriva lo stesso.

- **Un riquadro di un altro sito vive in un processo suo**: `sendInputEvent`
  arriva solo al frame principale, e il gesto vero lo riceve la pagina che
  ospita il riquadro, non il riquadro. Per il lettore di YouTube incorporato il
  clic passa dal protocollo di debug (`Input.dispatchMouseEvent`), che lo
  instrada come il mouse fino al riquadro sotto il punto. Il punto lo conferma
  la pagina ospite (il suo content script, legato alla richiesta da un gettone
  monouso): dove sta il riquadro, e che sopra non ci sia un elemento del sito.

Prove: `tests/unit/adSkip.test.mjs`, `tests/ad-skip.spec.mjs` (il «Salta» finto
di YouTube su un sito qualunque non riceve mai un clic vero; il sito che ospita
il lettore incorporato non riceve gesti, nemmeno con un suo elemento sopra).
