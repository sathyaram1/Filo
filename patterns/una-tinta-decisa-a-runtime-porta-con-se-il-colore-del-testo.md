# Una tinta decisa a runtime porta con sé il colore del testo

[← Tutti i pattern](../PATTERNS.md)

Quando il fondo di un elemento smette di essere un token del tema e diventa un
colore deciso mentre l'app gira (il colore della pagina aperta, il marchio del
sito, una tinta scelta dall'utente), il **colore del testo sopra non può più
restare un token del tema**. I due si scelgono insieme, o prima o poi si
incontrano: fondo chiaro con testo chiaro, e la scritta sparisce.

È successo in #429. Le schede in secondo piano prendevano la tinta del marchio
del sito, il nome restava `--fg-soft`. Al buio, la scheda di un sito dal marchio
chiaro (Wikipedia, GitHub, X, e ogni pagina interna di Filo, che ha un favicon
monocromatico) diventava un rettangolo grigio chiaro col nome scritto nel grigio
caldo del tema scuro: **1,08 a 1 di contrasto**, cioè invisibile. Al chiaro non
si vedeva niente di strano, ed è per questo che è durato.

- **Regola operativa:** ogni superficie tinta a runtime calcola il colore del
  testo dal colore che avrà DAVVERO, con la scala WCAG, e si dà un minimo (4,5 a
  1 per il testo normale). Vale anche per le icone dentro quella superficie:
  `color: inherit`, mai un token del tema. La stessa cosa per gli sfondi degli
  hover, che si ricavano da `currentColor` invece che da `--border`/`--fg`.
- **Fra chiaro e scuro si misura, non si soglia.** Una soglia secca di luminanza
  ("se il fondo è più chiaro di 0.45 metti testo scuro") sbaglia proprio le
  tinte di mezzo, dove i due candidati sono vicini ed è lì che il testo si
  perde. Si calcola il contrasto con entrambi e si tiene il maggiore: su un
  grigio a metà nessuno dei due arriva a 4,5, ma il migliore dà 4,06 invece di
  2,8. In Filo lo fa `SN_TAB_COLOR.readableOn` (`src/shared/tabColor.js`),
  logica pura unit-testata in `tests/unit/tabColor.test.mjs` su tutta la scala
  dei grigi.
- **Il testo attenuato si attenua fin dove può.** Un nome "spento" si ottiene
  avvicinando il colore leggibile al fondo, non scegliendo un grigio a caso:
  `SN_TAB_COLOR.softOn` prova l'attenuazione più marcata e molla di un gradino
  alla volta finché il contrasto non risale sopra 4,5. Se nessun gradino ci
  arriva resta il colore pieno: meglio un nome poco spento che un nome che non
  si legge.
- **Il mix va fatto dove si decide il testo.** Se il fondo nasce da un
  `color-mix()` scritto nel CSS, il colore finale lo conosce solo il motore di
  stile e chi sceglie il testo tira a indovinare. Il mix si calcola in JS
  (`SN_TAB_COLOR.mixSrgb` replica `color-mix(in srgb, a p%, b)`) e si scrive il
  risultato: così la stessa funzione che tinge sceglie anche la scritta.
- **Come si verifica:** il test misura il contrasto vero fra il colore calcolato
  dello sfondo e quello del testo, sul tema chiaro E su quello scuro, e dichiara
  la pre-condizione (la scheda è davvero tinta). Senza quella, un test passa
  anche quando la tinta non è mai arrivata. Vedi
  `tests/tab-bar-leggibilita.spec.mjs`.
- **Dove:** `src/shared/tabColor.js` (`readableOn`, `softOn`, `mixSrgb`,
  `contrastRatio`), applicazione in `src/renderer/shell.js` (`render`), CSS in
  `src/renderer/shell.css` (`.tab .close`, `.tab .mute-ind`). La scelta di QUALE
  tinta usare è un'altra regola:
  [Colore identità delle tab: brand del sito, mai chrome neutra](colore-identita-delle-tab-brand-del-sito-mai-chrome-neutra.md).
