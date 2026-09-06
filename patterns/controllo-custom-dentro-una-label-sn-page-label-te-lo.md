# Controllo custom dentro una `<label>`: `.sn-page label` te lo appiattisce

`pages.css` ha `.sn-page label { display: block; margin: …; color: var(--sn-muted) }`
per TUTTE le pagine `filo://`. Specificità **0-1-1**: una classe sola (`.mio-switch`,
`.mia-scelta`) non basta a batterla, e non conta che il tuo `<style>` venga dopo.

Il guasto è silenzioso e ingannevole: la label diventa `display: block`, i figli
`<span>` tornano `inline`, e **`width`/`height` smettono di applicarsi**. Un pill di
40×22 collassa a larghezza 0 — ma la pallina interna, che è `position: absolute`,
resta al suo posto: sullo schermo vedi "mezzo controllo" e sembra un problema di
colore, non di layout. È rimasto in produzione per settimane sullo switch della
tab Automazioni (#446/#447: l'owner l'ha fotografato due volte senza che nessuno lo
riconoscesse).

- **Regola:** un controllo custom costruito dentro una `<label>` si stila con
  `.sn-page label.<classe>` (0-2-1), e ci si rimette `margin: 0` e il colore, che
  `.sn-page label` aveva già deciso per te.
- Dai al pezzo interno un `display` **esplicito** (`inline-block`/`flex`): così non
  dipende dal fatto che il genitore sia rimasto flex.
- **Non** rilassare la regola in `pages.css`: serve a tutte le altre pagine.
- **Un test che legge solo `getComputedStyle(...).backgroundColor` non se ne
  accorge**: il colore è giusto anche su una scatola 0×0. Se asserisci su un
  controllo custom, asserisci sulla **geometria** (`getBoundingClientRect()`, o
  `toBeVisible()` sul pezzo visibile — mai sull'`<input>`, che è nascosto per
  costruzione).
