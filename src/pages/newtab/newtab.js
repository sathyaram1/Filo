// Newtab page logic: saluto orario + barra di ricerca.
(function () {
  'use strict';

  function greet() {
    const el = document.getElementById('greeting');
    if (!el) return;
    const h = new Date().getHours();
    let msg = 'Buonasera';
    if (h < 5) msg = 'Buonanotte';
    else if (h < 13) msg = 'Buongiorno';
    else if (h < 18) msg = 'Buon pomeriggio';
    el.textContent = msg;
  }

  // Trasforma il testo in URL navigabile: se è un indirizzo lo apre,
  // altrimenti fa una ricerca Google (stessa logica della barra indirizzi).
  function toUrl(raw) {
    const q = (raw || '').trim();
    if (!q) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(q) || q.startsWith('filo://')) return q;
    const looksLikeDomain = /^[^\s]+\.[^\s]{2,}([/?#].*)?$/.test(q) && !q.includes(' ');
    if (looksLikeDomain) return 'https://' + q;
    return 'https://www.google.com/search?q=' + encodeURIComponent(q);
  }

  function init() {
    greet();
    const form = document.getElementById('searchform');
    const input = document.getElementById('search');
    if (form && input) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const url = toUrl(input.value);
        if (url) window.location.href = url;
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
