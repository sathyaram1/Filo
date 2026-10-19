// Fogli di stile dei pezzi di UI di Filo disegnati dentro le pagine (menu, popup, feedback, red-team…).
// Elenco unico per i due preload (<link>) e per tabs.js (insertCSS, che passa la CSP dei siti):
// un foglio che manca a uno solo arriva senza stile su WhatsApp e simili (#600). Sentinella: tests/unit/contentStyles.test.mjs.

(function (global) {
  'use strict';
  global.SN_CONTENT_STYLES = Object.freeze([
    'theme.css', 'menu.css', 'popup.css', 'sidebar.css',
    'highlight.css', 'spellcheck.css', 'feedback.css', 'redteam-attack.css',
  ]);
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.SN_CONTENT_STYLES;
}
