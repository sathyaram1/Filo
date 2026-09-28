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

// Un riquadro dentro un componente chiuso della pagina (shadow DOM) non si vede
// dal documento: glielo si chiede dal suo interno, nel mondo isolato di Filo
// (999, dove il sito non scrive), e lui si presenta al primo frame che veglia.
const MONDO_FILO = 999;
const PRESENTATI = `(() => { try {
  if (window.__filoZoomQui === true) return;
  for (let p = window.parent, prima = window; p && p !== prima; prima = p, p = p.parent) {
    if (typeof p.__filoZoomAggancia === 'function') { p.__filoZoomAggancia(window); return; }
  }
} catch (_) {} })();`;

function vegliaRiquadri(elenco, webFrame) {
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
  let ultimaRicerca = 0;
  function cercaNascosti() {
    if (!webFrame) return;
    const ora = Date.now();
    if (ora - ultimaRicerca < 200) return;
    ultimaRicerca = ora;
    const visita = (f) => {
      let c = null;
      try { c = f.firstChild; } catch (_) { return; }
      for (; c; c = c.nextSibling) {
        try {
          const p = c.executeJavaScriptInIsolatedWorld(MONDO_FILO, [{ code: PRESENTATI }]);
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (_) {}
        visita(c);
      }
    };
    visita(webFrame);
  }
  try { globalThis.__filoZoomAggancia = (w) => aggancia(w); } catch (_) {}

  // Il puntatore che entra in un riquadro passa prima dal suo elemento: è lì
  // che lo si aggancia, anche se è nato o è stato riscritto dopo. Dentro un
  // componente l'evento arriva col suo ospite: il riquadro sta nel percorso
  // se il componente è aperto, altrimenti lo si cerca fra i frame figli.
  const riquadro = (t) => !!(t && (t.tagName === 'IFRAME' || t.tagName === 'FRAME'));
  function sopra(e) {
    let t = e && e.target;
    if (!riquadro(t)) { try { t = e.composedPath()[0]; } catch (_) {} }
    if (riquadro(t)) { aggancia(t.contentWindow); return; }
    cercaNascosti();
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
  // Quando Filo ha preso l'ultima rotella: la segnalazione di Chromium che segue è un'eco.
  let rotellaPresa = 0;

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
    ricontrollaPosto();
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

  // Col campo aperto le cifre le prende il main prima di qualunque frame (src/main/tabs/tabZoom.js).
  function avvisaCampo(aperto) {
    if (!ipc || typeof ipc.send !== 'function') return;
    try { ipc.send('filo:zoom-campo', aperto); } catch (_) {}
  }

  function iniziaModifica() {
    if (!percentInput) return;
    inModifica = true;
    campo.fresco = true;
    avvisaCampo(true);
    try { percentInput.focus(); percentInput.select(); } catch (_) {}
  }

  function chiudiModifica() {
    if (inModifica) avvisaCampo(false);
    inModifica = false;
    try { if (percentInput && document.activeElement === percentInput) percentInput.blur(); } catch (_) {}
  }

  function battiNelCampo(key) {
    if (!inModifica) return;
    const r = Z ? Z.tastoCampo(campo, key) : { valore: campo.valore, fresco: false, azione: null };
    campo.valore = r.valore;
    campo.fresco = r.fresco;
    mostraCampo();
    if (r.azione === 'applica') applicaCampo();
    else if (r.azione === 'annulla') annullaCampo();
  }

  function incollaNelCampo(testo) {
    if (!inModifica) return;
    const cifre = String(testo || '').replace(/[^\d]/g, '').slice(0, Z ? Z.CIFRE_CAMPO : 6);
    if (!cifre) return;
    campo.valore = cifre;
    campo.fresco = false;
    mostraCampo();
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

  // Elementi HTML anche in un documento che HTML non è (un'immagine SVG aperta
  // da sola): lì createElement darebbe un nodo senza stile, e il riquadro non c'era.
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const crea = (tag) => document.createElementNS(XHTML, tag);

  // `all: initial` in testa: dentro il dialogo del sito, o sotto la sua radice,
  // il riquadro non eredita il testo maiuscolo, spaziato o in ombra del sito.
  function makeBadge() {
    const el = crea('div');
    el.id = '__filo-zoom-badge';
    el.setAttribute('role', 'status');
    try { el.setAttribute('popover', 'manual'); } catch (_) {}
    Object.assign(el.style, {
      all: 'initial', direction: 'ltr', unicodeBidi: 'isolate', whiteSpace: 'nowrap',
      position: 'fixed', inset: 'auto', top: '12px', right: '12px', zIndex: '2147483647',
      margin: '0', border: 'none', overflow: 'visible', width: 'auto', height: 'auto',
      maxWidth: 'none', maxHeight: 'none',
      background: 'rgba(20,20,20,0.88)', color: '#fff',
      font: '12px/1.4 system-ui, -apple-system, sans-serif',
      padding: '6px 10px', borderRadius: '8px', pointerEvents: 'auto',
      boxShadow: '0 2px 8px rgba(0,0,0,0.35)', userSelect: 'none',
      display: 'flex', alignItems: 'center', gap: '0',
    });
    el.appendChild(document.createTextNode('zoom '));

    const input = crea('input');
    input.id = '__filo-zoom-percent';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.setAttribute('aria-label', 'Percentuale zoom');
    Object.assign(input.style, {
      all: 'initial', width: '3.4em', textAlign: 'right', background: 'transparent',
      color: '#fff', border: 'none',
      borderBottom: '1px dashed rgba(255,255,255,0.55)',
      font: 'inherit', padding: '0 1px', margin: '0', outline: 'none',
    });
    el.appendChild(input);
    percentInput = input;

    el.appendChild(document.createTextNode('%, rotella per zoomare'));
    return el;
  }

  // Il riquadro sta nello strato superiore del documento, sopra frameset, dialoghi e tutto schermo;
  // col dialogo modale aperto sta DENTRO il dialogo, perché il resto della pagina diventa intoccabile.
  function ospite() {
    let modale = null;
    try { const m = document.querySelectorAll('dialog:modal'); modale = m[m.length - 1] || null; } catch (_) {}
    return modale || document.documentElement;
  }

  function mettiInCima() {
    if (!badge) return;
    const dove = ospite();
    if (!dove) return;
    try {
      if (badge.parentNode !== dove) dove.appendChild(badge);
      if (typeof badge.showPopover !== 'function') return;
      if (badge.matches(':popover-open')) badge.hidePopover();
      badge.showPopover();
    } catch (_) {}
  }

  // Nello strato superiore vince l'ultimo arrivato: una notifica del sito aperta
  // dopo il riquadro gli sta sopra. Il riquadro deve essere quello che si vede.
  function coperto() {
    try {
      const r = badge.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return false;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
      const sopra = document.elementFromPoint(x, y);
      return !!(sopra && sopra !== badge && !badge.contains(sopra));
    } catch (_) { return false; }
  }

  // Un dialogo che si apre o si chiude, un tutto schermo o un livello del sito
  // arrivato dopo, a riquadro aperto: lo controlla anche la guardia, senza gesti.
  function ricontrollaPosto() {
    if (!zoomMode || !badge) return;
    let fuori = !badge.isConnected || badge.parentNode !== ospite();
    try { if (!fuori && badge.showPopover && !badge.matches(':popover-open')) fuori = true; } catch (_) {}
    if (!fuori && coperto()) fuori = true;
    if (fuori) mettiInCima();
  }

  let guardia = null;
  function avviaGuardia() {
    if (guardia) return;
    try { guardia = setInterval(ricontrollaPosto, 250); } catch (_) { guardia = null; }
  }
  function fermaGuardia() {
    if (!guardia) return;
    try { clearInterval(guardia); } catch (_) {}
    guardia = null;
  }

  // I riquadri incorporati devono sapere se la modalità è aperta, per fermare
  // la rotella e i clic che cadono dentro di loro (src/main/tabs/tabZoom.js).
  function avvisaModalita() {
    if (!ipc || typeof ipc.send !== 'function') return;
    try { ipc.send('filo:zoom-modalita', zoomMode); } catch (_) {}
  }

  // Lo sfondo che un sito dà a ogni livello in primo piano (::backdrop) velerebbe
  // la pagina intera: la regola dell'utente con !important vince su quelle del sito.
  let veloTolto = null;
  function togliVelo() {
    if (veloTolto != null || !webFrame || typeof webFrame.insertCSS !== 'function') return;
    try {
      veloTolto = webFrame.insertCSS('#__filo-zoom-badge::backdrop{background:transparent!important;'
        + 'backdrop-filter:none!important;filter:none!important;opacity:0!important}', { cssOrigin: 'user' });
    } catch (_) { veloTolto = null; }
  }
  function rimettiVelo() {
    if (veloTolto == null) return;
    try { webFrame.removeInsertedCSS(veloTolto); } catch (_) {}
    veloTolto = null;
  }

  function enter() {
    if (zoomMode) return;
    zoomMode = true;
    try {
      if (!badge) badge = makeBadge();
      togliVelo();
      mettiInCima();
      avviaGuardia();
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
    fermaGuardia();
    try { if (badge && badge.parentNode) badge.parentNode.removeChild(badge); } catch (_) {}
    rimettiVelo();
    try { document.documentElement.style.cursor = ''; } catch (_) {}
    try { delete document.documentElement.dataset.filoZoomMode; } catch (_) {}
    avvisaModalita();
  }

  function toggle() { if (zoomMode) exit(); else enter(); }

  function isInBadge(target) {
    return !!(badge && target && (target === badge || (badge.contains && badge.contains(target))));
  }

  // Un clic vero che cade dove si VEDE il riquadro vale per il riquadro, anche se
  // la pagina lo ha reso intoccabile (dialogo modale, anche dentro un componente chiuso).
  function cadeSu(el, e) {
    if (!el || !el.isConnected) return false;
    try {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0
        && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    } catch (_) { return false; }
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
    ricontrollaPosto();
    const dentro = isInBadge(e.target);
    if (dentro || cadeSu(badge, e)) {
      const sulCampo = e.target === percentInput || cadeSu(percentInput, e);
      if (sulCampo && e.button === 0) {
        e.preventDefault();
        iniziaModifica();
      }
      if (!dentro) { e.preventDefault(); e.stopPropagation(); }
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
      battiNelCampo(e.key);
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
    incollaNelCampo(testo);
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
    ['fullscreenchange', () => { if (zoomMode) mettiInCima(); }, true],
    ['pointerover', vegliaRiquadri(gesti, webFrame), true],
  ], () => {
    // Il documento vecchio se n'è andato col riquadro e i suoi ascoltatori.
    const eraAperta = zoomMode;
    zoomMode = false;
    if (inModifica) avvisaCampo(false);
    inModifica = false;
    fermaGuardia();
    badge = null;
    percentInput = null;
    suppressContextMenu = false;
    rimettiVelo();
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

  // Ctrl+rotella visto da Chromium: vale solo se nessuno qui l'ha preso, e una
  // volta per scatto (la segnalazione può arrivare doppia nello stesso istante).
  // Il gesto di un riquadro arriva per un'altra strada e può passare dopo: si aspetta un poco.
  if (pageZoom) {
    let ultimaSegnalazione = 0;
    ipc.on('filo:zoom-rotella', (_e, verso) => {
      if (verso !== 'in' && verso !== 'out') return;
      const ora = Date.now();
      const prima = rotellaPresa;
      if (ora - prima < 1000 || ora - ultimaSegnalazione < 30) return;
      ultimaSegnalazione = ora;
      setTimeout(() => { if (rotellaPresa === prima) eseguiZoom({ verso }); }, 80);
    });
  }

  // Le cifre del campo, prese dal main prima di qualunque frame.
  ipc.on('filo:zoom-campo-tasto', (_e, t) => {
    if (!t || typeof t !== 'object') return;
    if (typeof t.incolla === 'string') incollaNelCampo(t.incolla);
    else if (typeof t.key === 'string') battiNelCampo(t.key);
  });

  // I gesti fatti dentro un riquadro incorporato, girati qui dal main.
  ipc.on('filo:zoom-gesto', (_e, g) => {
    const gesto = Z ? Z.gestoValido(g) : null;
    if (!gesto) return;
    if (gesto.tipo === 'rotella' || gesto.tipo === 'ctrl') rotellaPresa = Date.now();
    if (gesto.tipo === 'medio') toggle();
    else if (gesto.tipo === 'esci') exit();
    else if (gesto.tipo === 'rotella') { if (zoomMode) passoModalita(gesto.dy); }
    else if (gesto.tipo === 'ctrl') { if (pageZoom && !zoomMode && !pageHandlesZoom()) ctrlRotella(gesto.dy); }
    else if (gesto.tipo === 'reset') eseguiZoom({ verso: 'reset' });
    else if (gesto.tipo === 'tasto') battiNelCampo(gesto.key);
  });
};

// In un riquadro incorporato: niente zoom né riquadro propri (lo zoom è della
// scheda intera), solo i gesti veri, passati al frame principale dal main.
module.exports.riquadro = function setupRiquadro(webFrame, opts) {
  const ipc = (opts && opts.ipcRenderer) || null;
  if (!ipc || typeof ipc.send !== 'function' || typeof document === 'undefined') return;
  let modalita = false;
  let campoAperto = false;
  let suppressContextMenu = false;
  const manda = (g) => { try { ipc.send('filo:zoom-gesto', g); } catch (_) {} };

  try {
    ipc.on('filo:zoom-modalita', (_e, on) => { modalita = on === true; });
    ipc.on('filo:zoom-campo-stato', (_e, on) => { campoAperto = on === true; });
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

  // Col campo della percentuale aperto il tasto è del campo, anche se il fuoco
  // l'ha portato qui il sito (#686.1 giro 7); di solito lo prende già il main.
  function onKeyDown(e) {
    if (!gestoVero(e)) return;
    if (campoAperto) {
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'v') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = String(e.key || '');
      if (key === 'Enter' || key === 'Tab' || key === 'Escape') campoAperto = false;
      manda({ tipo: 'tasto', key });
      return;
    }
    if (!modalita) return;
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
  tieniAscoltatori([...gesti, ['pointerover', vegliaRiquadri(gesti, webFrame), true]], () => { suppressContextMenu = false; });
};
