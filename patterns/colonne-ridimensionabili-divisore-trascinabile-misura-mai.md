# Colonne ridimensionabili: divisore trascinabile, misura persistita, mai auto-resize

I layout a pannelli affiancati (banco di lavoro dei Mazzi, dashboard di
gestione) si ridimensionano **solo** trascinando i divisori: le due colonne
esterne hanno larghezza fissa decisa dall'utente, quella centrale assorbe il
resto. È l'applicazione diretta di "la GUI è personalizzabile" (`filo_filosofia`).

- **Struttura:** un grid a 5 tracce — `Lpx | divisore | minmax(0,1fr) | divisore
  | Rpx` con `gap: 0`; sono i divisori a fare anche da spaziatura fra le colonne
  (niente doppio spazio). `min-width: 0` sulle colonne, altrimenti il contenuto
  impedisce di stringerle.
- **Aspetto del divisore:** trasparente a riposo se le colonne hanno già un
  bordo proprio (una terza linea sarebbe rumore), **tinto d'accento su hover e
  durante il trascinamento** — l'hover deve sempre dare un segnale che è una
  presa. Se le colonne non hanno bordo, la linea sottile fissa va bene (Mazzi).
- **Persistenza:** le misure finiscono in `chrome.storage.local` (una chiave UI
  per pagina in `STORAGE_KEYS`) e si riapplicano all'apertura. Mai un resize
  automatico non richiesto.
- **Rientro nello spazio disponibile:** le misure salvate possono non entrare
  (finestra più piccola, altro schermo). Il calcolo — restringere le esterne in
  proporzione a quanto possono cedere, mai sotto i loro minimi, preservando il
  minimo della centrale, **senza toccare le preferenze salvate** — è UNO e vive
  in `src/shared/paneLayout.js` (`SN_PANE_LAYOUT.fitWidths`, logica pura con
  unit test). Riapplicalo anche sul `resize` della finestra.
- **Invarianti da completare sempre:** doppio clic sul divisore = ritorno alla
  misura iniziale (se si può cambiare, si deve poter tornare indietro);
  `role="separator"` + `tabindex="0"` e frecce ←/→ per farlo da tastiera.
- **Dove:** `src/pages/decks/decks.js`, `src/pages/manage/manage.js`. Test
  `tests/decks-layout.spec.mjs`, `tests/manage-layout.spec.mjs`,
  `tests/unit/paneLayout.test.mjs`.
