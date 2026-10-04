# Una conferma sul posto tiene ferma la sua scatola

[← Tutti i pattern](../PATTERNS.md)

La conferma sul posto (il tasto diventa «Confermi?» e aspetta il secondo clic)
promette una cosa sola: il secondo clic cade dove è caduto il primo, e lì trova
lo stesso tasto. Se l'etichetta armata è più corta, il tasto si stringe; in una
fila allineata a destra il vicino scivola nel posto liberato, e il secondo clic
lo preme. Sulla card delle fusioni ferme il vicino era «Scarta», che non chiede
conferma: una fusione voluta è finita scartata (#550).

- **Il tasto armato tiene la sua larghezza.** Prima di cambiare l'etichetta si
  fissa la larghezza che aveva (`min-width` dalla misura vera, così vale con
  qualunque font scelto dall'utente) e la si toglie al disarmo.
- **Un esito che compare non spinge i tasti.** La riga di stato («Chiedo al
  server…», un errore) sta sotto la fila dei tasti, non sopra: dopo un guasto il
  clic per riprovare cade di nuovo sul tasto giusto.
- **Niente ridisegni sotto una conferma a metà.** Una rilettura automatica che
  arriva mentre il tasto è armato o la richiesta è in volo aspetta che si
  liberi (`occupata`/`quandoLibera` del modulo delle fusioni), poi ridisegna lo
  stato di quel momento; l'esito già detto resta scritto sulla card rifatta.
- **La coda di un doppio clic non conferma** (`detail > 1`), come nel cestino
  dell'editor (#415).
- **La prova clicca dove sbaglia l'utente**: col mouse sul bordo del tasto dalla
  parte del vicino, non al centro (dove `locator.click()` resta verde anche col
  difetto), e asserisce che la scatola del tasto armato coincide con quella di
  prima.
- Vicino: [Un clic, una scheda: nessuna azione ricompone la lista sotto il cursore](un-clic-una-scheda-nessuna-azione-ricompone-la-lista.md),
  la stessa trappola quando a muoversi è la lista intera.
- **Dove:** `buildCard` in `src/shared/mergeApprovals.js` (copiato nella pagina
  delle approvazioni da browser). Prove: `tests/livelli-forme.spec.mjs`,
  `tests/merge-approvals.spec.mjs`.
