# Quello che la shell disegna sotto le schede fa scendere la pagina

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Tutto ciò che la cornice di Filo mostra sotto la fila delle schede e
che chi naviga deve poter vedere e premere dichiara il proprio bordo basso con
`riservaTop('<nome>', fondo)`: l'area della pagina scende sotto di lui. Vale
anche a contenuto a tutto schermo. Un `position: fixed` con uno z-index alto non
basta e non dà nessun segnale che non stia funzionando.

## Il caso che l'ha fatto nascere

La domanda dei permessi dei siti (#586). Un sito chiede la fotocamera, la shell
disegna la pastiglia «esempio.it vuole usare la fotocamera» a 50 pixel dal bordo
alto, con `z-index: 1001`. Nel documento c'era: un test Playwright la trovava,
ci cliccava sopra e passava. Sullo schermo non c'era.

L'area della pagina è una `WebContentsView` nativa. Il sistema la compone SOPRA
l'HTML della finestra e lo z-index del CSS non la riguarda: sono due superfici
diverse, non due elementi dello stesso documento. Con la barra indirizzi
nascosta (che in Filo è sempre) quell'area comincia a 40 pixel, e la pastiglia
stava fra 50 e 85. Coperta per intero.

Il danno non era estetico. Il valore predefinito, quando nessuno risponde, è
negare: dopo due minuti la richiesta cadeva da sola. Per chi navigava,
fotocamera, microfono, posizione, notifiche, appunti e schermo non funzionavano
su nessun sito, e non compariva niente che lo spiegasse.

Lo stesso difetto era già in casa in altri due punti, scritti da chi credeva la
stessa cosa: l'avviso «bloccato popup da…» (a 52 pixel, con un commento che
dichiarava esplicitamente che non serviva riservare niente) e il pannello dei
download, che riservava spazio ma sbagliando il conto.

## I tentativi sbagliati

**Alzare lo z-index.** Non c'è numero che scavalchi una superficie nativa.

**Nascondere la vista mentre il riquadro è aperto** (`setActiveVisible(false)`,
che Filo usa per i menu a tendina). Per un menu che dura un secondo va bene. Per
una domanda che resta in piedi due minuti vuol dire spegnere la pagina che si
sta leggendo.

**Chiedere «tot pixel in più»** (`setTopInset`, l'API che c'era). È il conto che
il pannello dei download sbagliava: chi disegna un riquadro sa dove finisce il
proprio riquadro, non quanto è alta la cornice sotto cui sta. Il pannello
riservava la propria altezza, ma partiva più in basso della cornice, e la
differenza restava dietro la pagina. Da qui `setTopFloor`: si dichiara il bordo
basso, e il conto lo fa chi il layout lo conosce.

**Una riserva sola condivisa.** Con un numero solo, il primo riquadro che si
chiude azzera anche la riserva di quello ancora aperto. Ognuno tiene la sua in
una mappa, e al processo principale va la più alta.

**Una riserva per FASCIA, non per riquadro.** Nella fascia dei permessi
possono esserci insieme la domanda, la scelta di cosa condividere e il segno
che un sito sta vedendo lo schermo: un numero per ciascuno si scavalca a
vicenda ed è facile dimenticarne uno. La fascia tiene UNA riserva e la misura
sul proprio contenitore, saltando i nodi in uscita e quelli alti zero (una cosa
nascosta perché appartiene a un'altra scheda non deve tenere giù la pagina).

**Si misura subito, non solo al frame dopo.** La pagina deve scendere nello
stesso istante in cui la domanda compare, e il nodo è già nel documento: il
`requestAnimationFrame` serve solo a raccogliere ciò che cambia dopo il primo
disegno (le anteprime della condivisione, una frase che va a capo). Da solo non
basta: mentre i test tengono la finestra nascosta il frame può non arrivare per
un pezzo, e in quel buco la domanda finisce dietro alla pagina — con un rosso
che compare e sparisce a seconda di quanto è carica la macchina.

## Dove sta nel codice

- `riservaTop` in `src/renderer/shell.js`: la mappa delle riserve e il massimo.
  I nomi in uso sono `permessi` (tutta la fascia: domanda, scelta della fonte,
  segno della ripresa), `download`, `popup`.
- `setTopFloor` e `layout()` in `src/main/tabs.js`: il pavimento entra nel
  calcolo con un `Math.max`, e vale anche quando `contentFullscreen` è acceso —
  senza, un sito che si prende lo schermo e poi chiede la fotocamera faceva
  comparire la domanda sotto la propria pagina.
- Canale `tabs:reserve-floor` in `src/main/ipc.js` e `src/preload/shell-preload.js`.

## Come si verifica

Non basta trovare l'elemento nel documento: un test che lo trova e ci clicca
passa anche quando nessuno lo vede. Si misura il bordo basso del riquadro contro
la `y` della vista della scheda attiva, letta dal processo principale. In
`tests/permessi-siti.spec.mjs` c'è la prova, e in `tests/unit/permessiSiti.test.mjs`
la sentinella che elenca chi deve riservare.

Una fotografia non serve: durante le prove automatiche la finestra non viene
mostrata, e `capturePage()` fotografa la sola cornice saltando le viste native,
cioè mostra la pastiglia bene in vista proprio quando è coperta.
