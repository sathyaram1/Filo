# Evidenziare testo sulla pagina: CSS Custom Highlight API, mai wrappare in `<span>`

Per evidenziare testo su una pagina ESTERNA (es. la parola letta dalla lettura
ad alta voce) si usa la **CSS Custom Highlight API** (`CSS.highlights` + `Highlight`
+ Range, stilati via `::highlight(nome)`), **non** si avvolgono le parole in
`<span>`. Avvolgere muterebbe il DOM della pagina ospite: rompe il layout, scatena
reflow e si scontra con i framework (React rigenera i nodi). La Highlight API
dipinge sopra senza toccare l'albero.

- **Funziona dal mondo isolato del content script:** un `CSS.highlights.set(...)`
  fatto nel mondo isolato del preload **viene dipinto sul documento** ed è visibile
  anche dal mondo principale della pagina (il registro è a livello documento, non
  per-realm) — verificato in `tests/tts-highlight.spec.mjs`. Lo `::highlight()`
  però va in uno stylesheet del documento: lo si inietta come `<style>` con un
  fallback letterale sul token (`var(--sn-accent,#c45a3b)`) così rende anche su
  pagine senza il theme.css di Filo.
- **Disponibilità:** Electron 33 (Chromium ~130) la supporta; fai comunque
  feature-detect (`CSS.highlights && typeof window.Highlight === 'function'`) e
  degrada silenziosamente (la feature audio resta, salta solo l'evidenziazione).
- **Dove:** controller in `src/content/tts.js` (`ensureReadStyle`, `setHighlight`,
  `buildReadModel` tokenizza la selezione in Range-parola).
