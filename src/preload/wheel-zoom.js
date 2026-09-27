// Zoom della pagina nel preload: la modalità rotella (clic centrale), Ctrl+rotella e il riquadro con la percentuale.
// Qui si ascoltano solo gesti VERI, e il campo vale i tasti battuti, mai il valore che ha nel documento: lì arriva anche il sito.
// Chi prende i tasti e i riquadri: src/main/tabs/tabZoom.js. Regole: patterns/lo-zoom-lo-tiene-filo-non-la-pagina.md.

const path = require('node:path');

function caricaRegole() {
  try { require(path.join(__dirname, '..', 'shared', 'zoomPagina.js')); } catch (_) {}
  return (typeof globalThis !== 'undefined' && globalThis.SN_ZOOM) || null;
}

// Un evento che la pagina si scrive da sola arriva identico a questi
// ascoltatori: lo zoom si muove solo per quelli del browser (#686).
function gestoVero(e) { return !!(e && e.isTrusted); }

function isOnLink(target) {
  return !!(target && target.closest && target.closest('a[href], area[href]'));
}

// Sulla FINESTRA, in cattura, e dal preload: prima di qualunque script della
// pagina, che quindi non può zittirli (#686). Un documento riscritto
// (document.open) li cancella con i suoi: si rimettono, gli stessi, appena la
// radice cambia; `alCambio` butta lo stato che viveva nel documento vecchio.
function tieniAscoltatori(elenco, alCambio) {
  const metti = () => {
    for (const [tipo, fn, o] of elenco) {
      try { window.addEventListener(tipo, fn, o); } catch (_) {}
    }
  };
  metti();
  let radice = document.documentElement;
  try {
    new MutationObserver(() => {
      if (document.documentElement === radice) return;
      radice = document.documentElement;
      try { if (alCambio) alCambio(); } catch (_) {}
      metti();
    }).observe(document, { childList: true });
  } catch (_) {}
}

// Un riquadro che la pagina riempie da sé (about:blank scritto, come negli
// editor di testo ricco) non ha un preload suo: i suoi gesti li ascolta il
// frame che lo contiene, con gli stessi ascoltatori (#686.1). Chi ha un preload
// suo lo dice con `__filoZoomQui`, nel mondo isolato dove il sito non scrive.
function haPreload(w) {
  try { return w.__filoZoomQui === true; } catch (_) { return true; }
}

function vegliaRiquadri(elenco) {
  const agganciati = new WeakMap();
  function aggancia(w) {
    if (!w || w === window) return;
    let doc = null;
    try { doc = w.document; } catch (_) { return; }
    if (!doc || haPreload(w)) return;
    let stato = agganciati.get(w);
    if (!stato) {
      const avvolti = elenco.map(([tipo, fn, o]) => [tipo, (e) => { if (!haPreload(w)) fn(e); }, o]);
      avvolti.push(['pointerover', sopra, true]);
      stato = { avvolti, doc: null, radice: null };
      agganciati.set(w, stato);
    }
    for (const [tipo, fn, o] of stato.avvolti) {
      try { w.addEventListener(tipo, fn, o); } catch (_) {}
    }
    if (stato.doc === doc) return;
    stato.doc = doc;
    stato.radice = doc.documentElement;
    try {
      new MutationObserver(() => {
        if (doc.documentElement === stato.radice) return;
        stato.radice = doc.documentElement;
        aggancia(w);
      }).observe(doc, { childList: true });
    } catch (_) {}
    try { for (const f of doc.querySelectorAll('iframe, frame')) guarda(f); } catch (_) {}
  }
  function guarda(el) {
    try {
      el.addEventListener('load', () => aggancia(el.contentWindow));
      aggancia(el.contentWindow);
    } catch (_) {}
  }
  // Il puntatore che entra in un riquadro passa prima dal suo elemento: è lì
  // che lo si aggancia, anche se è nato o è stato riscritto dopo.
  function sopra(e) {
    const t = e && e.target;
    if (t && (t.tagName === 'IFRAME' || t.tagName === 'FRAME')) aggancia(t.contentWindow);
  }
  return sopra;
}

module.exports = function setupWheelZoom(webFrame, opts) {
  if (!webFrame || typeof document === 'undefined') return;
  const pageZoom = !!(opts && opts.pageZoom);
  const ipc = (opts && opts.ipcRenderer) || null;
  // Solo le pagine di Filo possono dire «lo zoom me lo faccio io»: il marcatore
  // sta nel documento, e su un sito lo scriverebbe il sito (#686).
  const interna = !!(opts && opts.interna);

  const Z = caricaRegole();
  const ZOOM_STEP = Z ? Z.PASSO : 0.5;
  const MIN_LEVEL = Z ? Z.MIN_LIVELLO : -5;
  const MAX_LEVEL = Z ? Z.MAX_LIVELLO : 5;

  let zoomMode = false;
  let badge = null;
  let percentInput = null;
  let suppressContextMenu = false;
  // Il numero nel riquadro: lo scrivono solo i tasti veri, dopo un clic vero
  // nel campo (#686.1: col comando di inserimento testo del browser il sito
  // scriveva un «25» che valeva come battuto, e poi toglieva il fuoco).
  const campo = { valore: '100', fresco: false };
  let inModifica = false;

  function currentPercent() {
    try { return Math.round(webFrame.getZoomFactor() * 100); }
    catch (_) { return 100; }
  }

  function letturaLivello() {
    try { return webFrame.getZoomLevel(); } catch (_) { return 0; }
  }

  function mostraCampo() {
    if (!percentInput) return;
    percentInput.value = campo.valore;
    try { percentInput.setSelectionRange(campo.valore.length, campo.valore.length); } catch (_) {}
  }

  function mostraPercentuale() {
    campo.valore = String(currentPercent());
    campo.fresco = false;
    mostraCampo();
  }

  function refreshPercent() {
    if (!inModifica) mostraPercentuale();
  }

  // Il tasto destro chiede e azzera lo zoom da QUI, non con un evento sul
  // documento che userebbe anche il sito (#686). Su una pagina che scala il
  // proprio contenuto il numero è il suo, non il 100% fermo della finestra.
  try {
    globalThis.SN_ZOOM_PAGINA = {
      percentuale: () => {
        const p = percentualePropria();
        return p == null ? currentPercent() : p;
      },
      azzera: () => { eseguiZoom({ verso: 'reset' }); },
    };
  } catch (_) {}

  // Unico punto che scrive lo zoom del webFrame, dentro i limiti condivisi.
  function setLevel(level) {
    const clamped = Z ? Z.limita(level) : Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level));
    try { webFrame.setZoomLevel(clamped); } catch (_) {}
    refreshPercent();
  }

  function iniziaModifica() {
    if (!percentInput) return;
    inModifica = true;
    campo.fresco = true;
    try { percentInput.focus(); percentInput.select(); } catch (_) {}
  }

  function chiudiModifica() {
    inModifica = false;
    try { if (percentInput && document.activeElement === percentInput) percentInput.blur(); } catch (_) {}
  }

  function applicaCampo() {
    if (!inModifica) return;
    const battuto = campo.valore;
    chiudiModifica();
    const esito = Z ? Z.risolvi(letturaLivello(), { percentuale: battuto }) : null;
    if (esito) setLevel(esito.livello);
    mostraPercentuale();
  }

  function annullaCampo() {
    chiudiModifica();
    mostraPercentuale();
  }

  function makeBadge() {
    const el = document.createElement('div');
    el.id = '__filo-zoom-badge';
    el.setAttribute('role', 'status');
    Object.assign(el.style, {
      position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
      background: 'rgba(20,20,20,0.88)', color: '#fff',
      font: '12px/1.4 system-ui, -apple-system, sans-serif',
      padding: '6px 10px', borderRadius: '8px', pointerEvents: 'auto',
      boxShadow: '0 2px 8px rgba(0,0,0,0.35)', userSelect: 'none',
      display: 'flex', alignItems: 'center', gap: '0',
    });
    el.appendChild(document.createTextNode('zoom '));

    const input = document.createElement('input');
    input.id = '__filo-zoom-percent';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.setAttribute('aria-label', 'Percentuale zoom');
    Object.assign(input.style, {
      width: '3.4em', textAlign: 'right', background: 'transparent',
      color: '#fff', border: 'none',
      borderBottom: '1px dashed rgba(255,255,255,0.55)',
      font: 'inherit', padding: '0 1px', margin: '0', outline: 'none',
    });
    el.appendChild(input);
    percentInput = input;

    el.appendChild(document.createTextNode('%, rotella per zoomare'));
    return el;
  }

  // I riquadri incorporati devono sapere se la modalità è aperta, per fermare
  // la rotella e i clic che cadono dentro di loro (src/main/tabs/tabZoom.js).
  function avvisaModalita() {
    if (!ipc || typeof ipc.send !== 'function') return;
    try { ipc.send('filo:zoom-modalita', zoomMode); } catch (_) {}
  }

  function enter() {
    if (zoomMode) return;
    zoomMode = true;
    try {
      if (!badge) badge = makeBadge();
      (document.body || document.documentElement).appendChild(badge);
      inModifica = false;
      mostraPercentuale();
      document.documentElement.style.cursor = 'zoom-in';
    } catch (_) {}
    try { document.documentElement.dataset.filoZoomMode = '1'; } catch (_) {}
    avvisaModalita();
  }

  // Uscire NON azzera lo zoom raggiunto; un numero battuto e non ancora
  // confermato vale, come quando si esce dal campo con un clic.
  function exit() {
    if (!zoomMode) return;
    applicaCampo();
    zoomMode = false;
    try { if (badge && badge.parentNode) badge.parentNode.removeChild(badge); } catch (_) {}
    try { document.documentElement.style.cursor = ''; } catch (_) {}
    try { delete document.documentElement.dataset.filoZoomMode; } catch (_) {}
    avvisaModalita();
  }

  function toggle() { if (zoomMode) exit(); else enter(); }

  function isInBadge(target) {
    return !!(badge && target && (target === badge || (badge.contains && badge.contains(target))));
  }

  function passoModalita(deltaY) {
    const dir = deltaY < 0 ? 1 : -1; // rotella su = zoom in
    setLevel(letturaLivello() + dir * ZOOM_STEP);
  }

  // ~0.005/unità: un notch di rotella (deltaY≈100) vale un passo di Ctrl +/-,
  // e il pinch del trackpad (delta piccoli) resta fluido.
  function ctrlRotella(deltaY) {
    setLevel(letturaLivello() - deltaY * 0.005);
  }

  function pageHandlesZoom() {
    if (!interna) return false;
    try { return document.documentElement.dataset.filoOwnZoom === '1'; }
    catch (_) { return false; }
  }

  // Una pagina che zooma da sé tiene la finestra al 100%: il numero lo dice lei.
  function percentualePropria() {
    if (!pageHandlesZoom()) return null;
    try {
      const p = Z ? Z.leggiPercentuale(document.documentElement.dataset.filoOwnZoomPercent) : null;
      return p == null ? null : Math.round(p);
    } catch (_) { return null; }
  }

  // Porta UNICA dello zoom: tasti, rotella, riquadro, menu del tasto destro e
  // chat passano di qui. Ritorna l'esito da riferire, o null quando una pagina
  // che zooma da sé non dichiara il proprio numero: meglio tacere che inventarlo.
  function eseguiZoom(spec) {
    // L'editor scala il foglio: il comando gli si CONSEGNA (su Mac questa è
    // l'unica strada del tasto). Il verso sta nel nome dell'evento, perché un
    // `detail` non passa fra i due mondi; la percentuale passa dal dataset.
    if (pageHandlesZoom()) {
      const chiesto = Z ? Z.leggiPercentuale(spec && spec.percentuale) : null;
      try {
        if (chiesto != null) {
          document.documentElement.dataset.filoZoomTarget = String(chiesto);
          document.dispatchEvent(new Event('filo:zoom-set'));
        } else {
          const nomi = { in: 'filo:zoom-in', out: 'filo:zoom-out', reset: 'filo:zoom-reset' };
          const verso = spec && nomi[spec.verso];
          if (verso) document.dispatchEvent(new Event(verso));
        }
      } catch (_) {}
      const p = percentualePropria();
      if (p == null) return null;
      return {
        percentuale: p,
        richiesto: chiesto == null ? null : Math.round(chiesto),
        limitato: chiesto != null && Math.round(chiesto) !== p,
      };
    }
    const esito = Z ? Z.risolvi(letturaLivello(), spec) : null;
    if (!esito) return null;
    setLevel(esito.livello);
    return { percentuale: currentPercent(), richiesto: esito.richiesto, limitato: esito.limitato, min: esito.min, max: esito.max };
  }

  // ── Ascoltatori ─────────────────────────────────────────────────────────
  // Il centrale apre e chiude la modalità (e ferma l'autoscroll nativo); sui
  // link, fuori dalla modalità, resta nativo. In modalità QUALSIASI clic fuori
  // dal riquadro la chiude; il clic nel campo apre la modifica del numero.
  function onMouseDown(e) {
    if (!gestoVero(e)) return;
    if (e.button === 1) {
      if (!zoomMode && isOnLink(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      toggle();
      return;
    }
    if (!zoomMode) return;
    if (isInBadge(e.target)) {
      if (e.target === percentInput && e.button === 0) {
        e.preventDefault();
        iniziaModifica();
      }
      return;
    }
    if (e.button === 2) suppressContextMenu = true; // il destro chiude e basta
    e.preventDefault();
    e.stopPropagation();
    exit();
  }

  function onContextMenu(e) {
    if (!suppressContextMenu) return;
    suppressContextMenu = false;
    e.preventDefault();
    e.stopPropagation();
  }

  function onWheel(e) {
    if (!gestoVero(e)) return;
    if (zoomMode) {
      e.preventDefault();
      e.stopPropagation();
      rotellaPresa = Date.now();
      passoModalita(e.deltaY);
      return;
    }
    if (!pageZoom || !(e.ctrlKey || e.metaKey) || pageHandlesZoom()) return;
    e.preventDefault();
    e.stopPropagation();
    rotellaPresa = Date.now();
    ctrlRotella(e.deltaY);
  }

  function onKeyDown(e) {
    if (!gestoVero(e)) return;
    // Il numero si sta battendo: i tasti restano suoi anche se il fuoco se n'è
    // andato, perché toglierlo a metà numero lo può fare anche il sito.
    if (inModifica && percentInput) {
      e.stopPropagation();
      try { if (document.activeElement !== percentInput) percentInput.focus(); } catch (_) {}
      // Ctrl+V incolla (lo prende onPaste); le altre combinazioni non scrivono.
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'v') return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const r = Z ? Z.tastoCampo(campo, e.key) : { valore: campo.valore, fresco: false, azione: null };
      campo.valore = r.valore;
      campo.fresco = r.fresco;
      mostraCampo();
      if (r.azione === 'applica') applicaCampo();
      else if (r.azione === 'annulla') annullaCampo();
      return;
    }
    // In modalità un tasto qualsiasi esce. I tasti dello zoom qui non arrivano
    // da una scheda (li prende il main): questa strada serve alle finestre
    // di login, che di scheda non hanno niente.
    if (zoomMode) {
      e.preventDefault();
      e.stopPropagation();
      exit();
      return;
    }
    if (!pageZoom) return;
    const verso = Z ? Z.tastoZoom(e) : null;
    if (!verso) return;
    e.preventDefault();
    e.stopPropagation();
    eseguiZoom({ verso });
  }

  function onPaste(e) {
    if (!gestoVero(e) || !inModifica || !percentInput || e.target !== percentInput) return;
    e.preventDefault();
    e.stopPropagation();
    let testo = '';
    try { testo = String(e.clipboardData.getData('text') || ''); } catch (_) {}
    const cifre = testo.replace(/[^\d]/g, '').slice(0, Z ? Z.CIFRE_CAMPO : 6);
    if (!cifre) return;
    campo.valore = cifre;
    campo.fresco = false;
    mostraCampo();
  }

  // Quello che il campo mostra lo decide Filo: un testo messo dentro da altri
  // (anche col comando di inserimento del browser) si rimette com'era.
  function onInput(e) {
    if (percentInput && e.target === percentInput && percentInput.value !== campo.valore) mostraCampo();
  }

  try { globalThis.__filoZoomQui = true; } catch (_) {}
  const gesti = [
    ['mousedown', onMouseDown, true],
    ['contextmenu', onContextMenu, true],
    ['wheel', onWheel, { capture: true, passive: false }],
    ['keydown', onKeyDown, true],
  ];
  tieniAscoltatori([
    ...gesti,
    ['paste', onPaste, true],
    ['input', onInput, true],
    ['pointerover', vegliaRiquadri(gesti), true],
  ], () => {
    // Il documento vecchio se n'è andato col riquadro e i suoi ascoltatori.
    const eraAperta = zoomMode;
    zoomMode = false;
    inModifica = false;
    badge = null;
    percentInput = null;
    suppressContextMenu = false;
    if (eraAperta) avvisaModalita();
  });

  if (pageZoom && interna && ipc && typeof ipc.send === 'function') {
    // Il numero di una pagina che zooma da sé lo deve sapere anche il main,
    // che altrimenti riferirebbe in chat il 100% della finestra (#686).
    document.addEventListener('filo:zoom-proprio', () => {
      const p = percentualePropria();
      if (p != null) { try { ipc.send('filo:zoom-proprio', p); } catch (_) {} }
    });
  }

  if (!ipc || typeof ipc.on !== 'function') return;

  // I tasti (presi dal main prima della pagina, anche col focus sulla barra o
  // in un riquadro), la barra dei menu e la chat. La chat porta anche una
  // percentuale esatta e un `rid`: chi ha chiesto «al 900%» deve sapere dove
  // è finito.
  if (pageZoom) {
    ipc.on('filo:zoom-key', (_e, payload) => {
      const spec = (payload && typeof payload === 'object') ? payload : { verso: payload };
      const rid = spec.rid ? String(spec.rid) : '';
      const esito = eseguiZoom(spec);
      if (!rid || typeof ipc.send !== 'function') return;
      try { ipc.send('filo:zoom-applicato', { rid, ...(esito || { sconosciuto: true }) }); } catch (_) {}
    });
  }

  // I gesti fatti dentro un riquadro incorporato, girati qui dal main.
  ipc.on('filo:zoom-gesto', (_e, g) => {
    const gesto = Z ? Z.gestoValido(g) : null;
    if (!gesto) return;
    if (gesto.tipo === 'medio') toggle();
    else if (gesto.tipo === 'esci') exit();
    else if (gesto.tipo === 'rotella') { if (zoomMode) passoModalita(gesto.dy); }
    else if (gesto.tipo === 'ctrl') { if (pageZoom && !zoomMode && !pageHandlesZoom()) ctrlRotella(gesto.dy); }
    else if (gesto.tipo === 'reset') eseguiZoom({ verso: 'reset' });
  });
};

// In un riquadro incorporato: niente zoom né riquadro propri (lo zoom è della
// scheda intera), solo i gesti veri, passati al frame principale dal main.
module.exports.riquadro = function setupRiquadro(webFrame, opts) {
  const ipc = (opts && opts.ipcRenderer) || null;
  if (!ipc || typeof ipc.send !== 'function' || typeof document === 'undefined') return;
  let modalita = false;
  let suppressContextMenu = false;
  const manda = (g) => { try { ipc.send('filo:zoom-gesto', g); } catch (_) {} };

  try {
    ipc.on('filo:zoom-modalita', (_e, on) => { modalita = on === true; });
    ipc.send('filo:zoom-ciao');
  } catch (_) {}

  // Il tasto destro dentro il riquadro offre la stessa «Dimensione reale».
  try {
    globalThis.SN_ZOOM_PAGINA = {
      percentuale: () => {
        try { return Math.round(webFrame.getZoomFactor() * 100); } catch (_) { return 100; }
      },
      azzera: () => manda({ tipo: 'reset' }),
    };
  } catch (_) {}

  function onMouseDown(e) {
    if (!gestoVero(e)) return;
    if (e.button === 1) {
      if (!modalita && isOnLink(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      modalita = !modalita;
      manda({ tipo: 'medio' });
      return;
    }
    if (!modalita) return;
    if (e.button === 2) suppressContextMenu = true;
    e.preventDefault();
    e.stopPropagation();
    modalita = false;
    manda({ tipo: 'esci' });
  }

  function onContextMenu(e) {
    if (!suppressContextMenu) return;
    suppressContextMenu = false;
    e.preventDefault();
    e.stopPropagation();
  }

  function onWheel(e) {
    if (!gestoVero(e)) return;
    if (modalita) {
      e.preventDefault();
      e.stopPropagation();
      manda({ tipo: 'rotella', dy: e.deltaY });
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    manda({ tipo: 'ctrl', dy: e.deltaY });
  }

  function onKeyDown(e) {
    if (!gestoVero(e) || !modalita) return;
    e.preventDefault();
    e.stopPropagation();
    modalita = false;
    manda({ tipo: 'esci' });
  }

  try { globalThis.__filoZoomQui = true; } catch (_) {}
  const gesti = [
    ['mousedown', onMouseDown, true],
    ['contextmenu', onContextMenu, true],
    ['wheel', onWheel, { capture: true, passive: false }],
    ['keydown', onKeyDown, true],
  ];
  tieniAscoltatori([...gesti, ['pointerover', vegliaRiquadri(gesti), true]], () => { suppressContextMenu = false; });
};
