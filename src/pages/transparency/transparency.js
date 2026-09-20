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

  // Il documento chiesto nell'indirizzo, così com'è scritto. Serve anche quando
  // non esiste: chi arriva da un link che prometteva la privacy deve leggere
  // che quella sezione non è scritta, non trovarsi un altro documento al suo
  // posto mentre l'indirizzo continua a dire «privacy» (#515).
  function requestedId() {
    const q = new URLSearchParams(window.location.search).get('doc');
    return String(q == null ? '' : q).trim().slice(0, 60);
  }

  function currentId() {
    const q = requestedId();
    const ids = T.ids();
    if (ids.includes(q)) return q;
    return q ? '' : ids[0];
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
        span.className = 'sn-nav-item is-soon' + (item.id === activeId ? ' is-active' : '');
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

  // La sezione chiesta non c'è: lo si dice, e si dice cosa c'è. Mostrare al suo
  // posto un altro documento senza avvisare è la stessa promessa a vuoto che
  // questa pagina esiste per non fare.
  function renderMissing(chiesto) {
    const voce = T.NAV.find((n) => n.id === chiesto);
    const nome = chiesto ? (voce ? voce.label : chiesto) : 'Trasparenza';
    document.title = 'Filo — ' + nome;
    $('title').textContent = nome;
    // Senza niente nell'indirizzo non c'è nessuna sezione da negare: qui non
    // c'è proprio ancora niente di scritto, e lo dice il corpo della pagina.
    $('subtitle').textContent = !chiesto ? ''
      : (voce ? 'Questa sezione non è ancora scritta.' : 'Questa sezione non esiste.');
    $('meta').textContent = '';

    const body = $('doc-body');
    body.textContent = '';
    const p = document.createElement('p');
    const docs = T.all();
    if (!docs.length) {
      p.textContent = 'Non c’è ancora nessun documento di trasparenza.';
    } else {
      p.appendChild(document.createTextNode('Quello che c’è scritto: '));
      docs.forEach((d, i) => {
        if (i) p.appendChild(document.createTextNode(', '));
        const a = document.createElement('a');
        a.href = '?doc=' + encodeURIComponent(d.id);
        a.textContent = d.title;
        p.appendChild(a);
      });
      p.appendChild(document.createTextNode('.'));
    }
    body.appendChild(p);
    renderNav(chiesto);
  }

  function render() {
    const id = currentId();
    const doc = id ? T.get(id) : null;
    if (!doc) { renderMissing(requestedId()); return; }

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
