# Grafici/chart: SVG generato a mano, niente librerie esterne

[← Tutti i pattern](../PATTERNS.md)

I grafici (es. la torta del consumo nella pagina Crediti) si disegnano come
**SVG costruito a mano nel DOM**, una `<path>`/`<circle>` per fetta — niente
librerie di charting.

- **Perché:** la CSP delle pagine filo:// è `script-src 'self' filo:` (niente CDN,
  niente eval); aggiungere una lib di chart bundlata contraddice la filosofia
  minimale. Una torta sono ~15 righe di trigonometria.
- **Testabilità:** ogni fetta porta un `data-group="<nome>"` (e l'item di legenda
  lo specchia) così uno spec Playwright può asserire *quali* fette esistono e i
  valori, non solo che "c'è un grafico". Con una sola categoria disegna un
  `<circle>` pieno (l'arco 0→2π collasserebbe).
- **Colori:** palette fissa scelta per restare distinguibile su tema chiaro E
  scuro (i token `--sn-*` da soli non bastano: servono N colori distinti). Tutto
  il resto (testo, bordi) resta su token di tema.
- **Un `hidden` su un `<svg>` non lo nasconde.** La proprietà `hidden` esiste
  solo sugli elementi HTML: `svg.hidden = true` scrive un campo qualunque, il
  grafico resta al suo posto e la frase che spiega perché non c'è si ritrova
  accanto a un buco di 220 pixel. Si mette e si toglie l'ATTRIBUTO
  (`setAttribute('hidden','')`), e nel foglio ci vuole comunque la riga
  `.grafico[hidden] { display: none }`, perché un `display: block` scritto per
  il grafico batterebbe quello di serie del browser.
- **Il colore può DIRE qualcosa.** Dove le fette sono ordinate su una scala
  (zero giri di correzione → tanti), la palette va dal verde al rosso: si legge
  se il numero è buono prima di leggere la legenda. Dove le categorie non hanno
  un ordine (i gruppi di consumo dei crediti) resta la palette neutra.
- **Dove:** `src/pages/credits/credits.js` (`drawChart`/`slicePath`/`drawLegend`),
  icona moneta in `src/shared/icons.js` (`credits`). Test `tests/credits-page.spec.mjs`.
  La torta dei giri di verifica e l'istogramma delle segnalazioni nel tempo:
  `renderStatsPie`/`renderStatsBars` in `src/pages/manage/manage.js`, test
  `tests/manage-feedback-stats.spec.mjs`.
