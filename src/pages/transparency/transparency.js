// Pagina dei documenti di trasparenza dentro Filo.
//
// Il contenuto NON vive qui: arriva da src/shared/transparency.js, generato dai
// markdown in transparency/ (vedi scripts/build-transparency.mjs). Questa pagina
// si limita a scegliere quale documento mostrare e a montare le glosse.
//
// Il documento sta nella QUERY (?doc=models), non in un pannello a schede: così
// l'indirizzo dice sempre cosa stai leggendo e un link a una sezione precisa
// (?doc=models#i-punti-deboli) porta davvero lì. È l'uso principale di queste
// pagine — vengono citate e linkate, non sfogliate.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const T = window.SN_TRANSPARENCY;
  const UI = window.SN_TRANSPARENCY_UI;

  function $(id) { return document.getElementById(id); }

  function currentId() {
    const q = new URLSearchParams(window.location.search).get('doc');
    const ids = T.ids();
    return ids.includes(q) ? q : ids[0];
  }

  function renderNav(activeId) {
    const nav = $('nav');
    nav.textContent = '';
    for (const item of T.NAV) {
      const doc = T.get(item.id);
      if (!doc) {
        // Sezione non ancora scritta: resta visibile e spenta. Farla sparire
        // darebbe l'impressione che Filo non abbia niente da dire su privacy o
        // sicurezza, che è il contrario di quello che questa pagina promette.
        const span = document.createElement('span');
        span.className = 'sn-nav-item is-soon';
        span.textContent = item.label;
        span.title = 'in arrivo';
        nav.appendChild(span);
        continue;
      }
      const a = document.createElement('a');
      a.className = 'sn-nav-item' + (item.id === activeId ? ' is-active' : '');
      a.href = '?doc=' + encodeURIComponent(item.id);
      a.textContent = item.label;
      nav.appendChild(a);
    }
  }

  function render() {
    const id = currentId();
    const doc = T.get(id);
    if (!doc) return;

    document.title = 'Filo — ' + doc.title;
    $('title').textContent = doc.title;
    $('subtitle').textContent = doc.subtitle || '';
    $('meta').textContent = doc.updated ? 'Ultima revisione: ' + doc.updated : '';

    const body = $('doc-body');
    // `doc.html` è generato in fase di build dai markdown del repo, con escape
    // applicato al testo: non è contenuto d'utente né di rete.
    body.innerHTML = doc.html;

    renderNav(id);
    UI.applyGlossary(body, T.GLOSSARY);
    UI.mountGlossaryUi(body, $('gloss-pop'));

    // Il browser non salta all'ancora se il contenuto è arrivato dopo il load.
    if (window.location.hash) {
      const target = document.getElementById(window.location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
  }

  // I link alle fonti sono verso l'esterno: aprono una scheda, non portano via
  // la pagina interna.
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[target="_blank"]');
    if (!a) return;
    const url = a.getAttribute('href');
    if (!url || !/^https?:/i.test(url)) return;
    e.preventDefault();
    chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url });
  });

  (async function init() {
    try {
      const settings = await window.SN_STORAGE.getSettings();
      window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
    } catch (_) { /* il tema di default va benissimo */ }
    render();
  })();
})();
