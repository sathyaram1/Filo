# Controlli UI custom: tema di Filo, non default del browser

[← Tutti i pattern](../PATTERNS.md)

I controlli dell'interfaccia (menu a tendina, select, ecc.) devono usare la
**palette e il comportamento del tema di Filo**, non i default del browser/OS (es. il
blu di selezione nativo). Devono essere **coerenti tra loro**: un menu a tendina nuovo
deve sembrare e comportarsi come gli altri menu a tendina già presenti in Filo.

- **Perché:** i default nativi (blu di sistema, font, hover) spezzano l'identità
  visiva e fanno sembrare l'elemento "incollato" e non parte dell'app.
- **Dove:** i token di tema vivono in `src/styles/` (theme). Prima di stilare un
  controllo nuovo, guarda come è fatto un controllo equivalente esistente e riusane
  variabili/classi invece di reinventare i colori.
- **Combobox editabili → `SN_COMBOBOX`, mai `<datalist>` nativa.** Il popup della
  `<datalist>` è renderizzato dall'OS (colori di sistema, non tematizzabile): è
  l'esatto opposto di "coerente con Filo". Per un campo a tendina editabile (input
  + lista filtrabile) usa `SN_COMBOBOX.attach(host, input, { readOptions, onPick, … })`
  (`src/shared/comboBox.js`): riusa le classi `.sn-select-pop`/`.sn-select-option`
  (theme.css) come gli altri menu. `host` dev'essere `position:relative` (il popup
  si ancora lì). La `<datalist>` può restare come **sorgente dati** (popolata
  altrove), ma togli l'attributo `list=` dall'input così il popup nativo non
  appare. Usato dal campo "stringa modello" delle Opzioni/admin e dall'editor a
  segmenti (`modelChainEditor.js`).
- **`::selection` NON entra in uno shadow root: va ridichiarata dentro (#414).**
  La regola del tema (`[data-sn-theme] ::selection` in `theme.css`) sta nel foglio
  del DOCUMENTO e non si applica ai nodi di uno shadow tree: dentro un componente
  in Shadow DOM (il popup di conferma, `src/shared/confirmUi.js`) selezionare il
  testo tornava al **blu di sistema** — l'unico punto fuori palette di tutta la UI.
  Chi crea un componente in Shadow DOM ripete le regole `::selection` /
  `::-moz-selection` nel `<style>` del root, con `var(--sn-selection-bg)` (i custom
  properties, quelli sì, attraversano il confine: gli override estetici dell'utente
  continuano a valere) e un letterale come ripiego.
