# Animazioni che coprono la pagina: vivono nel content overlay, non nella shell

Le animazioni celebrative o gli overlay che devono coprire **l'area pagina**
(es. le monete che "volano" dopo una ricompensa) si disegnano nel **content
script / overlay della pagina**, non nella shell.

- **Perché (vincolo architetturale non ovvio):** la shell (`src/renderer/`)
  renderizza **solo la barra in alto**; tutta l'area pagina è una
  **WebContentsView nativa** sovrapposta. Un elemento DOM disegnato dalla shell
  nell'area pagina sarebbe **occluso** dalla view nativa. Quindi ciò che deve
  apparire sopra la pagina va creato nel mondo del content script (che vive
  *dentro* quella view), con `position: fixed` e uno `z-index` altissimo.
- **Come:** layer transitorio appeso a `document.documentElement`, animato con
  la **Web Animations API** (`element.animate`, niente CSS keyframes da iniettare
  né lib), che si **auto-rimuove** a fine animazione. Rispetta sempre
  `prefers-reduced-motion` (salta il volo, lascia al più l'etichetta).
- **Bersaglio "profilo/account":** l'icona profilo non sta nella shell (la barra
  chrome è nascosta) ma nella home; per un'animazione che parte da una pagina
  qualsiasi, puntare all'**angolo in alto a destra** della viewport è la
  direzione coerente del profilo.
- **Testabilità:** dai al layer una classe stabile (`.sn-fb-credit-fly`) così uno
  spec può osservarne la comparsa con un `MutationObserver` anche se si rimuove
  dopo ~1s. L'effetto vero (es. saldo +5) si asserisce a parte.
- **Dove:** `src/content/feedback.js` (`flyCredits`). Test
  `tests/feedback-credit-reward.spec.mjs`.
- **Variante "home":** quando l'animazione parte da una pagina filo:// (es. il
  popup ringraziamento C5 nella dashboard), l'icona profilo è un **elemento DOM
  reale** (`accountCtrlBtn`): punta al **centro del suo `getBoundingClientRect()`**
  invece che all'angolo. Stesso resto (Web Animations API, auto-rimozione,
  `prefers-reduced-motion`). Dove: `dashboard.js` (`flyCreditsToAccount`).
