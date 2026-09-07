# Ripristini e annullamenti: riportano indietro SOLO ciò che il pannello mostra

[← Tutti i pattern](../PATTERNS.md)

Un "ripristina"/"annulla" che rimette in piedi uno **snapshot intero** riporta
indietro anche cose che l'utente non stava chiedendo di annullare e che non ha
modo di vedere prima di premere (nell'editor: il nome del documento, la
conversazione con Filo nel riquadro chat, la disposizione dei riquadri — #384).
È perdita silenziosa, ed è peggio dell'attrito che si voleva evitare.

- **Regola:** il confine di ciò che torna indietro deve coincidere con ciò che
  l'affordance mostra e promette. Lo storico versioni dell'editor mostra
  un'anteprima di TESTO → ripristina testo e commenti (ancorati al testo:
  separarli lascerebbe note appese a frasi inesistenti) e lascia com'è adesso il
  "contenitore" (nome, metadati, moduli con i loro dati). Il resto dello
  snapshot si continua a salvare: è la ricomposizione a scegliere cosa applicare.
- **Dillo comunque, una riga:** dove il pannello non può mostrare tutto, una
  frase tenue accanto al bottone dice cosa torna indietro e cosa no. Non è
  "spiegare la UI": è dichiarare la portata di un'azione distruttiva.
- **Uno snapshot è una COPIA PROFONDA, mai un alias del modello vivo.** Se il
  serializzato condivide oggetti col documento aperto, lo snapshot continua a
  cambiare insieme a lui: in memoria sembra "aggiornato", su disco è la
  fotografia vera → la stessa azione dà due risultati diversi prima e dopo un
  riavvio, che è il modo più rapido per far perdere fiducia in una funzione di
  ripristino. Clona alla frontiera della serializzazione, una volta sola.
- **Dove:** `composeRestored` in `src/shared/editorVersions.js` (logica pura),
  `serializeDocModel`/`restoreVersion` in `src/pages/editor/editor.js`. Test
  `tests/unit/editorVersions.test.mjs`, `tests/editor-versions.spec.mjs`.
