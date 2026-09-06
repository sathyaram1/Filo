# Icone: il popup della shell ha un registro SUO, cambiare `icons.js` non basta

[← Tutti i pattern](../PATTERNS.md)

Le icone di Filo vivono in **`src/shared/icons.js`** (`SN_ICONS`), ma il popup
menu della shell (menu App, menu tab, `src/main/popup-menu.js`) è una
BrowserWindow separata che **non carica quel file**: tiene una **copia** dei path
SVG in `ICON_PATHS`. Cambiare l'icona in `icons.js` lascia il popup sull'icona
vecchia, e la stessa cosa finisce disegnata in due modi diversi a seconda della
superficie (scoperto in #379.12: l'Editor mostrava il foglio-appunti nel menu
tasto destro e la vecchia penna nel menu App).

- **Regola operativa:** quando cambi (non solo quando aggiungi) un'icona in
  `icons.js`, cerca lo stesso nome in `ICON_PATHS` di `popup-menu.js` e
  allineala. Vale anche al contrario.
- **Come si testa:** confronta l'SVG **renderizzato** dalle due superfici invece
  di fidarti del sorgente — apri il popup e il menu tasto destro nello stesso
  spec e asserisci che l'`innerHTML` dell'`<svg>` coincida (esempio in
  `tests/audit-notes-visibility.spec.mjs`). Un assert "c'è un'icona" non vede la
  divergenza: entrambe le superfici *hanno* un'icona, semplicemente diversa.
