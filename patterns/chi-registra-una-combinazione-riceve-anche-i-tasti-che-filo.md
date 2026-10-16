# Chi registra una combinazione riceve anche i tasti che Filo si prende

[← Tutti i pattern](../PATTERNS.md)

Una pagina che fa premere una combinazione per sceglierla (le scorciatoie di Spiega, Traduci, Salva per dopo e
Aiuto nelle Preferenze, #842; quella di un modulo dell'Editor, #893) deve vedere ogni tasto premuto, anche quelli che il main prende prima della pagina:
Ctrl+T, Ctrl+W, lo zoom, la barra laterale, le quattro azioni stesse. Senza, Ctrl+T apriva una scheda invece di
essere rifiutato col perché, e Alt+T faceva partire la traduzione a chi voleva solo spostarla.

- **La pagina chiede l'ascolto al main** (`MSG.REGISTRA_TASTI`, solo da `filo://` e dal frame principale) e lo
  rinnova finché ascolta. Il main lo segna sul webContents con una scadenza: una pagina che muore a metà non lascia
  le scorciatoie spente.
- **Ogni ascoltatore di `before-input-event` che si prende un tasto chiede `staRegistrandoTasti(wc)`**
  (`src/main/shortcuts.js`) e allora lascia passare: le quattro azioni, `tastoDelBrowser` e la barra laterale in
  `src/main/tabs.js`, lo zoom in `src/main/tabs/tabZoom.js`. Un ascoltatore nuovo che si prende tasti fa lo stesso.
- **Su Mac la barra dei menu vede il tasto prima di tutti**: le sue voci con un acceleratore passano da
  `oRegistra` (`src/main/menu.js`), che rigira il tasto alla pagina invece di fare la sua cosa.
- **Nella pagina** l'ascolto sta sul `keydown` di `window` in cattura, con `preventDefault`; `data-filo-ctrl-z`
  a `pagina` tiene Ctrl+Z lontano dal «torna indietro» dei content script; Esc e il fuoco che esce chiudono
  l'ascolto.
- **Lettura e controlli stanno in `SN_TASTI`** (`scorciatoiaDaEvento`, `rifiutoScorciatoiaFilo`): la stessa regola
  della chat, che il main riapplica in `applySettingsUpdate` prima di salvare.
- **Il campo dell'Editor è un campo di testo**: registra solo le combinazioni con Ctrl, Cmd o Alt, e le lettere si
  scrivono, perché la scorciatoia si può anche scrivere a mano. Salva il tasto fisico (`tastoFisicoDaEvento`,
  `rifiutoFisico`): ogni tasto di Filo si confronta col tasto che lo produce su quella tastiera.
- **Non si fermano**: i tasti del sistema operativo (Alt+Tab, il tasto Windows, Cmd+Tab) e, su Mac, le voci della
  barra dei menu fatte con un `role` (Cmd+Q, Cmd+H, Cmd+M, Cmd+C…), che `oRegistra` non vede.

Prove: `tests/scorciatoie-personalizzate.spec.mjs`, `tests/unit/scorciatoieFilo.test.mjs`,
`tests/editor-scorciatoie-tasto-fisico.spec.mjs`, `tests/unit/tastoFisico.test.mjs`. Vicino:
[Lo zoom lo tiene Filo, non la pagina](lo-zoom-lo-tiene-filo-non-la-pagina.md).
