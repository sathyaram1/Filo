# Estetica: ogni variabile visiva è un token del registro, mai un valore sparso

[← Tutti i pattern](../PATTERNS.md)

Ogni variabile estetica (colori, font, raggio angoli, opacità…) deve passare dal
**registro dei token** in `src/shared/themeTokens.js` (#146.1): nome stabile →
tipo → default → eventuale categoria da cui eredita. Gli override dell'utente
vivono in `settings.themeTokens` e si applicano **live** su tutte le superfici
(shell, pagine filo://, popup/menu/sidebar su pagine esterne) via il broadcast
`SETTINGS_UPDATED`.

- **Gerarchia a due livelli:** i token specifici (es. `selection.color`)
  ereditano dalla categoria (es. `accent`). Nel CSS l'eredità è la catena
  `var()` nativa (`--sn-selection-color: var(--sn-accent)` in theme.css); in JS
  la replica `effectiveValue()` per la UI delle preferenze e i test.
- **Regola operativa:** quando aggiungi un elemento UI, usa le variabili
  `--sn-*` esistenti (o aggiungi un token al registro se serve una nuova "manopola"
  utente) — mai colori hardcoded. Un override emesso dall'utente vince perché
  esce a specificità `html[data-sn-theme]` (0,1,1) sopra i blocchi di theme.css.
- **Sicurezza:** i valori degli override finiscono in `<style>` iniettati anche
  nelle pagine esterne → la whitelist per tipo (`validate`) è obbligatoria e il
  choke point è `applySettingsUpdate` nel main. Non aggiungere percorsi di
  scrittura che la saltino.
- **Durate (#837):** ogni transition/animation scrive `calc(<durata> * var(--sn-motion, 1))`, anche
  nel CSS dentro i .js; le `.animate()` e i timer che aspettano un'animazione usano
  `SN_THEME_TOKENS.motionMs()`/`motionFactor()`, lo scorrimento morbido `scrollBehavior()`, il main
  `src/main/movimento.js`. A 0 non si anima niente. Fa eccezione solo un'animazione che misura un tempo
  vero (l'anello per annullare la voce): sta fra le eccezioni della sentinella
  `tests/unit/motionSentinella.test.mjs`.
- **Ombre:** l'alfa di un'ombra scura scritta a mano si moltiplica per `var(--sn-ombra, 1)`, il rapporto
  fra il token `shadow` e il suo 0.18; `--sn-shadow` lo usa già.
- **Viste che non caricano theme.css** (barra laterale, avvisi, anteprima delle schede, avviso del sito,
  menu a comparsa): `--sn-motion` e `--sn-ombra` arrivano dalla shell (`VAR_BARRA`, `VAR_TEMA`) o dal main
  (`movimento.variabili()`). Una variabile nuova che deve arrivare lì va aggiunta a quelle liste.
- **Un token che non basta come variabile** (il font dei link: senza override i link devono ereditare)
  porta una `regola`, emessa da `pageCss` solo quando è sovrascritto. Le regole che valgono solo per le
  pagine di Filo usano `html[data-sn-pagina]`: `[data-sn-theme]` sta anche sull'`<html>` dei siti.
- **Dove:** registro `src/shared/themeTokens.js`; default CSS `src/styles/theme.css`
  (+ gemelli shell in `src/renderer/shell.css`); applicazione in `pageBootstrap.js`
  (filo://), `content.js` (pagine esterne), `shell.js` (shell). Test:
  `tests/unit/themeTokens.test.mjs`, `tests/theme-tokens.spec.mjs`.
