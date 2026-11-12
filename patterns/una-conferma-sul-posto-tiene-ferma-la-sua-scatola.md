# Una conferma sul posto tiene ferma la sua scatola

[← Tutti i pattern](../PATTERNS.md)

La conferma sul posto (il tasto diventa «Confermi?» e aspetta il secondo clic)
promette una cosa sola: il secondo clic cade dove è caduto il primo, e lì trova
lo stesso tasto. Se l'etichetta armata è più corta, il tasto si stringe; in una
fila allineata a destra il vicino scivola nel posto liberato, e il secondo clic
lo preme. Sulla card delle fusioni ferme il vicino era «Scarta», che non chiede
conferma: una fusione voluta è finita scartata (#550).

- **Il tasto armato tiene la sua scatola, larghezza e altezza.** Prima di
  cambiare l'etichetta si fissano le misure che aveva (`min-width` e
  `min-height` dalla misura vera, così vale con qualunque font scelto
  dall'utente) e le si toglie al disarmo. L'altezza conta quando l'etichetta
  di riposo va su due righe e quella armata ne occupa una (#256.3).
- **Fra due tasti va a capo la fila, non la scritta.** La fila dei tasti ha
  `flex-wrap: wrap`: con un font più largo di Segoe UI o un pannello stretto i
  tasti si mettono uno sotto l'altro invece di spezzare l'etichetta. La
  scritta va a capo solo se il tasto non ci sta nemmeno da solo.
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
- **Una conferma nuova usa l'aiuto** `SN_CONFERMA_SUL_POSTO.arma/disarma`
  (`src/shared/confermaSulPosto.js`), che la pagina carica prima del suo script.
  Un'etichetta armata più lunga in una fila allineata a destra sposta il bordo
  sinistro: si sceglie corta, e il dettaglio va nel suggerimento (cestino
  dell'editor, #256.6).
- **Dove:** l'aiuto lo usano il Cestino dell'editor, «Salta il controllo» del
  pentagono (`src/pages/manage/manage.js`) e «Togli» della parola d'ordine.
  `buildCard` e `buildSkipCard` in `src/shared/mergeApprovals.js` hanno ancora
  la loro copia, perché il modulo si copia anche nella pagina delle approvazioni
  da browser. Prove: `tests/editor-trash.spec.mjs`, `tests/livelli-forme.spec.mjs`,
  `tests/merge-approvals.spec.mjs`, `tests/approvazioni-web.spec.mjs`,
  `tests/unit/confermaSulPosto.test.mjs`.
