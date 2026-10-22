# Una pagina agganciata da Playwright non è mai nascosta

[← Tutti i pattern](../PATTERNS.md)

Ciò che cambia quando una pagina è nascosta (scheda dietro, finestra ridotta a icona
o coperta) non si prova con la fixture di Playwright: lì ogni pagina resta visibile.
Si prova con Filo aperto da `tests/helpers/filoSenzaPlaywright.mjs`, e la prova
asserisce prima che la pagina sia davvero `hidden`.

## Il caso (#1494)

«Salta le pubblicità dei video» riconosce il «Salta» da un'animazione CSS muta: il
motore la fa partire quando disegna il pulsante, e il content script ascolta
`animationstart`. Un utente ha chiesto se le pubblicità si saltano anche con il video
in sottofondo. Il manifesto diceva di sì, e lo spec aveva la sua prova verde
(«in una scheda in secondo piano salta lo stesso»).

Non era vero. Una pagina nascosta non disegna: `requestAnimationFrame` si ferma e le
animazioni non partono. Il «Salta» compariva, la pubblicità suonava per intero, e il
content script non lo sapeva.

La prova era verde perché Playwright, per ogni pagina che aggancia, chiede a Chromium
di emulare il fuoco (`Emulation.setFocusEmulationEnabled`), e Chromium tratta come
visibile una pagina con il fuoco emulato. Con la vista grande zero, nascosta con
`setVisible(false)`, e anche con la finestra nascosta, la pagina sotto Playwright
risponde `visibilityState === 'visible'` e disegna a 60 fotogrammi al secondo. Lo
stesso Electron senza Playwright, con la vista nascosta, risponde `hidden` e i
fotogrammi vanno a zero.

## La regola

- Un comportamento che dipende dalla pagina nascosta (animazioni, `rAF`,
  `IntersectionObserver`, `ResizeObserver`, `visibilitychange`, timer rallentati) si
  prova con `apriFiloSenzaPlaywright()`. Guida il main dal suo ispettore, come
  `app.evaluate`, e lascia le pagine senza nessun client del protocollo di debug.
- La prova asserisce la precondizione: `document.visibilityState === 'hidden'` nella
  pagina, prima di fare la cosa. Senza, una prova che crede di guardare una scheda
  dietro ne guarda una visibile.
- Le anteprime delle schede svegliano per un attimo una scheda dietro che cambia
  (`src/main/tabs/anteprime.js`): se la prova deve vedere cosa succede a pagina
  nascosta, le spegne (`anteprime.chiudi()`), o il risultato dipende da quando
  scatta la foto.
- La finestra dei test, parcheggiata fuori schermo e trasparente, tiene nascoste
  anche le schede davanti. Per la differenza fra davanti e dietro serve la finestra
  vera (`FILO_HIDE_WINDOW: '0'`), e la si apre solo su Linux, dove lo schermo è
  virtuale: altrove comparirebbe sullo schermo di chi prova.

## Cosa fa una pagina nascosta (misurato su Electron 44, Linux)

- Tiene la misura che aveva, e `getBoundingClientRect`, `checkVisibility` ed
  `elementFromPoint` rispondono giusto.
- I timer girano al passo di un secondo, `MutationObserver` funziona.
- `sendInputEvent` arriva al frame principale come clic vero.
- Il clic del protocollo di debug instradato a un riquadro d'altro sito può non
  arrivargli, e nel caso peggiore lo riceve la pagina che lo ospita: in una pagina
  nascosta il lettore incorporato aspetta di tornare a schermo
  (`src/content/adSkip.js`).
- Lo spostamento del mouse del protocollo di debug non risponde finché la pagina non
  disegna: chi lo aspetta resta appeso (`src/main/services/adSkip.js`).
