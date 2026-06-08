# Filo — Sistema Tab: avanzamento implementazione

Tracking dell'implementazione di `../filo-tab-system-spec.md`. La spec va fatta
**tutta**, a fasi. Si parte dalle cose **autonome e senza decisioni di design**
(es. Duplica), si lascia per ultimo ciò che richiede scelte o nuovi componenti
pesanti (vetro smerigliato, ricerca semantica, decisione LLM di archiviazione).

**Regola:** non lasciare mai una feature a metà. Quando il contesto di una
sessione si riempie, fermarsi a un punto pulito e annotare qui lo stato, così la
sessione successiva riparte senza ambiguità.

---

## Legenda stato
- ✅ fatto e verificato
- 🟡 in corso (NON lasciare così a fine sessione)
- ⏳ da fare — autonomo, senza decisioni
- 🔵 da fare — richiede decisione di design / chiarimento utente
- 🔴 da fare — progetto a sé / nuovo componente pesante

---

## §4 — Menu tasto destro su tab
- ✅ **Duplica** — apre una copia della tab (stesso URL). Autonomo.
- ✅ **Muta** — silenzia/riattiva l'audio della tab (`setAudioMuted`), con
  indicatore visivo sulla tab mutata e label che diventa "Riattiva audio".
- ✅ **Chiudi** — chiude la tab. (Nota: la spec dice "Chiudi = archivia"; oggi
  chiude soltanto. Diventerà "archivia" quando esisterà lo store archivio §3.1.)
- 🔵 **Aiuto** — apre chat con Filo sulla tab. RIMANDATO: richiede decidere
  quale superficie chat usare (home/newtab? sidebar?) e come passarle il
  contesto della tab (url/titolo). Da definire con l'utente.

## §1 — Aspetto visivo
- 🔵 §1.1 Tab bar "vetro smerigliato" con campionamento live — progetto a sé,
  attriti con l'architettura WebContentsView (composizione sopra la shell).
- ⏳ §1.2 Colore identità attenuato sulle tab inattive (theme-color → favicon →
  fallback, cache per dominio).
- ⏳ §1.3 Ordinamento cromatico (dipende da §1.2).

## §2 — Gestione automatica
- 🔴 §2.1 Auto-archiviazione (trigger inattività/chiusura) — il cuore è
  fattibile; la **decisione LLM** è il pezzo costoso.
- 🔵 §2.2 Protezione/Pin (intuizione/apprendimento/istruzione esplicita).
- ⏳ §2.3 Toast "Tab riordinate e salvate in cronologia" (no pulsante annulla).

## §3 — Archivio e cronologia
- ⏳ §3.1 Storage per tab archiviata (metadati). Riassunto/embedding = step dopo.
- 🔴 §3.2 Ricerca semantica (embedding locali, indice vettoriale) — nuovo componente.
- ⏳ §3.3 UI archivio (cronologia → tab, raggruppata per giorno, ordine cromatico).

## §5 — Privacy
- ✅ (preesistente) Incognito non archivia.
- 🔴 §5 Pulizia retroattiva via linguaggio naturale — dipende da §2/§3 + agente.

## §6 — Overflow UI (30+ tab attive)
- ⏳ Scroll della tab bar + suggerimento di pulizia.

---

## Note tecniche per la prossima sessione
- Menu contestuale tab implementato in `src/renderer/shell.js` (handler
  `contextmenu` su ogni `.tab`), che riusa `filoShell.popupMenu` →
  `src/main/popup-menu.js`. Le azioni custom tornano via `shell:menu-action`
  (prefisso `tab-…`). Il target tab id è in `ctxTabId` (closure nello shell.js).
- Backend tab: `setMuted/toggleMute/duplicateTab` in `src/main/tabs.js`; IPC
  `tabs:set-muted` / `tabs:duplicate` in `src/main/ipc.js`; preload
  `setMuted/duplicate` in `src/preload/shell-preload.js`. `muted` è nello
  snapshot e viene riapplicato in `_recreateView`.
- Icone menu: aggiunte `duplicate`/`mute`/`sound` in `ICON_PATHS` di
  `popup-menu.js`.
</content>
</invoke>
