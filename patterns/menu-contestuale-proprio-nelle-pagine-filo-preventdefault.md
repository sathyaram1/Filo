# Menu contestuale proprio nelle pagine filo://: `preventDefault` e il menu di Filo si fa da parte

[← Tutti i pattern](../PATTERNS.md)

Una pagina interna può avere un **menu contestuale proprio** su certi elementi
(chip dell'archivio, card dei mazzi): l'handler `contextmenu` dell'elemento
chiama `e.preventDefault()` e apre il suo popup (classi `.sn-select-pop`/
`.sn-select-option`, posizionato `fixed` alle coordinate del click). Il menu
generale di Filo, sulle pagine filo://, ascolta in **bubble** su window e cede
il passo se `e.defaultPrevented` è già vero.

- **Perché:** sulle pagine web ESTERNE Filo intercetta il tasto destro in
  capture aggressiva (deve battere gli handler di siti ostili come YouTube);
  sulle pagine INTERNE gli handler sono nostri e più specifici → vince la
  pagina, il menu di Filo è il fallback sul resto della superficie.
- **Regola operativa:** in una pagina filo:// basta `preventDefault()`
  nell'handler dell'elemento; NON serve `stopPropagation`. Se non chiami
  `preventDefault`, il tasto destro apre il normale menu di Filo.
- **Dove:** registrazione in `src/content/content.js` (ramo pagine interne);
  esempio in `src/pages/decks/decks.js`. Chi vuole le sue voci DENTRO il menu di Filo
  (il quaderno delle memorie, la home) le dà a `SN_VOCI_PAGINA` invece di aprirne uno suo.
- **Da tastiera** (#1295): Shift+F10 e il tasto Menu aprono il menu di Filo anche con Shift premuto, e il
  fuoco parte dalla prima voce che riguarda l'elemento (`primaDaTastiera`). Dentro valgono frecce, Tab,
  Home e Fine, Invio e la prima lettera della scritta; chiuso, il fuoco torna dov'era. Un elemento che ha
  voci sue deve potersi raggiungere col Tab: una lista lunga è una fermata sola, con le frecce dentro
  (le bolle del filo della home). Prove: `tests/chat-nascoste.spec.mjs`.
