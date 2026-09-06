# Popup d'avvio della home: incatenali, non sovrapporli

La dashboard può avere **più popup all'avvio** (recap aggiornamento C4,
ringraziamento feedback risolto C5). Mostrarli insieme li impila e confonde.

- **Sequenza, non stack:** il primo popup riceve un callback `onClose`; il
  secondo parte **alla chiusura** del primo, o **subito** se il primo non compare.
  In `dashboard.js`: `maybeShowUpdateRecap(onClose)` ritorna `true`/`false` (se ha
  mostrato il recap) e invoca `onClose` quando l'utente lo chiude; l'init fa
  `if (!shown) await maybeShowFeedbackRewards()`.
- **Side-effect una volta sola:** un popup che *accredita crediti* va calcolato
  lato main con un anti-doppio-premio persistente (`rewardedFeedback` nel doc
  credits), non lato UI. Così se l'init rigira (reload, seconda apertura) non
  ripaga. Attenzione nei test: l'`init` chiama l'handler in modo asincrono — se
  semini lo stato *durante* quel volo, premi prima del previsto. Lascia decantare
  l'init iniziale (es. `waitForTimeout`) prima di seminare, poi `reload`.
- **Dove:** `dashboard.js` (`renderFeedbackRewards`, `maybeShowFeedbackRewards`).
  Test `tests/feedback-resolved-reward.spec.mjs`.
