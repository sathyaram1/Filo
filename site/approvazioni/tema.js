// Tema chiaro o scuro come il sistema, prima che la pagina si disegni: i colori sono quelli di filo/theme.css.
(function () {
  'use strict';
  var scuro = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function applica() { document.documentElement.dataset.snTheme = scuro && scuro.matches ? 'dark' : 'light'; }
  applica();
  if (scuro && scuro.addEventListener) scuro.addEventListener('change', applica);
})();
