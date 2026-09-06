# Popup menu: il "submenu" è una voce a due zone che riapre il menu

Il popup menu custom (`src/main/popup-menu.js`, una BrowserWindow frameless)
non ha submenu a comparsa: quando una voce ha bisogno di un secondo livello
(es. la lista paesi di "Apri da un altro paese"), la voce dichiara `subAction`
e viene resa **a due zone di click** — il corpo esegue l'azione di default, la
freccia `›` a destra manda `subAction` al renderer, che **riapre il popup**
nello stesso punto con le voci del secondo livello.

- **Perché:** un hover-submenu richiederebbe una seconda finestra sincronizzata
  (posizione, blur, z-order) per un beneficio minimo; riaprire lo stesso popup
  è coerente, robusto e riusa tutto (stile, selezione, chiusura su blur).
- **Dove:** rendering in `buildHTML` (`.row` + `.subarrow`); esempio d'uso in
  `openTabContextMenu` / `openProxyCountryMenu` in `src/renderer/shell.js`.
