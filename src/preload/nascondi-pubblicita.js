// Nasconde i riquadri pubblicitari che il blocco di rete lascia in pagina, con le regole delle liste (services/adblock.js).
// Foglio di stile dell'utente: batte gli !important del sito e la CSP non lo ferma. Le regole solo nel frame principale;
// la chiusura di ciò che il blocco ha fermato in ogni frame, perché l'annuncio può stare dentro un riquadro.

const CHIUSO = 'data-filo-pub-chiuso';
const ELEMENTI = 'img,iframe,frame,embed,object';
const MEDIA = 'img,video,canvas,svg,iframe,frame,embed,object';
const MAX_BLOCCATI = 500;
const RIQUADRO_FERMATO = 'filo:adblock-riquadro-fermato';

const area = (r) => (r.width > 0 && r.height > 0 ? r.width * r.height : 0);

// Un riquadro che mostra solo l'annuncio fermato è un rettangolo bianco. Senza testo né immagini visibili lo è.
function vuoto(doc) {
  const b = doc && doc.body;
  if (!b || (b.innerText || '').trim()) return false;
  let media = [];
  try { media = b.querySelectorAll(MEDIA); } catch (_) {}
  for (const n of media) if (area(n.getBoundingClientRect())) return false;
  return true;
}

// Un'immagine o un riquadro che il blocco ha fermato si chiude, o resta il buco grande quanto l'annuncio.
function chiudiBloccati({ ipcRenderer, webFrame }) {
  // Electron non toglie un foglio dell'utente: la regola vale finché la radice non porta questo attributo (blocco spento).
  const GATE = 'data-filo-' + Math.random().toString(36).slice(2, 10);
  let regola = false;
  let acceso = true;
  let observer = null;
  const bloccati = new Set();
  // Dentro i riquadri scritti dalla pagina il preload non gira: lì si chiude da qui, con lo stile sull'elemento.
  const dentro = new Set();

  let inRiquadro = false;
  try { inRiquadro = window.parent !== window; } catch (_) { inRiquadro = true; }
  // Solo un elemento che copriva almeno metà del riquadro ne fa un annuncio: un pixel di tracciamento non chiude un riquadro vero.
  let annuncio = false;
  let avvisato = false;
  const avvisaIlPadre = () => {
    if (avvisato || !annuncio) return;
    if (document.readyState !== 'complete') { window.addEventListener('load', avvisaIlPadre, { once: true }); return; }
    if (!vuoto(document)) return;
    avvisato = true;
    try { window.parent.postMessage(RIQUADRO_FERMATO, '*'); } catch (_) {}
  };

  const chiudi = (el) => {
    if (!regola) {
      regola = true;
      try { webFrame.insertCSS(`:root:not([${GATE}]) [${CHIUSO}]{display:none!important}`, { cssOrigin: 'user' }); } catch (_) {}
    }
    if (inRiquadro && !annuncio) {
      try { annuncio = area(el.getBoundingClientRect()) >= 0.5 * window.innerWidth * window.innerHeight; } catch (_) {}
    }
    el.setAttribute(CHIUSO, '');
    if (inRiquadro) avvisaIlPadre();
  };
  const srcDi = (el) => [el.currentSrc, el.src, el.data].filter((s) => typeof s === 'string' && s);
  const fermato = (el) => !!el && el.nodeType === 1 && srcDi(el).some((s) => bloccati.has(s));
  const segna = (el) => { if (fermato(el)) chiudi(el); };

  const nascondiDentro = (n, si) => {
    try {
      if (si) n.style.setProperty('display', 'none', 'important');
      else n.style.removeProperty('display');
    } catch (_) {}
  };
  const giroDentro = (frame, doc, livello) => {
    let copre = false;
    let nodes = [];
    try { nodes = doc.querySelectorAll(ELEMENTI); } catch (_) {}
    for (const n of nodes) {
      if (!fermato(n) || dentro.has(n)) continue;
      try { copre = copre || area(n.getBoundingClientRect()) >= 0.5 * area(frame.getBoundingClientRect()); } catch (_) {}
      dentro.add(n);
      if (dentro.size > MAX_BLOCCATI) dentro.delete(dentro.values().next().value);
      if (acceso) nascondiDentro(n, true);
    }
    if (copre && vuoto(doc)) chiudi(frame);
    if (livello < 3) cercaDentro(doc, livello + 1);
  };
  const cercaDentro = (root, livello) => {
    let frames = [];
    try { frames = root.querySelectorAll('iframe,frame'); } catch (_) {}
    for (const f of frames) {
      let doc = null;
      try { doc = f.contentDocument; } catch (_) {}
      if (doc && doc.documentElement) giroDentro(f, doc, livello);
    }
  };
  const giro = (root) => {
    if (!root || root.nodeType !== 1) return;
    segna(root);
    let nodes = [];
    try { nodes = root.querySelectorAll(ELEMENTI); } catch (_) {}
    for (const n of nodes) segna(n);
    cercaDentro(root, 0);
  };

  ipcRenderer.on('filo:adblock-chiudi', (_e, urls) => {
    for (const u of Array.isArray(urls) ? urls : [urls]) {
      if (typeof u !== 'string' || !u) continue;
      bloccati.add(u);
      if (bloccati.size > MAX_BLOCCATI) bloccati.delete(bloccati.values().next().value);
    }
    giro(document.documentElement);
    if (observer) return;
    observer = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) giro(n);
    });
    try { observer.observe(document, { childList: true, subtree: true }); } catch (_) {}
  });
  // Un riquadro mandato da uno script a un indirizzo in lista non lo porta scritto: si fa riconoscere lui.
  // Chi manda il segnale può chiudere solo il proprio riquadro.
  window.addEventListener('message', (e) => {
    if (e.data !== RIQUADRO_FERMATO || !e.source) return;
    let frames = [];
    try { frames = document.querySelectorAll('iframe,frame'); } catch (_) {}
    for (const f of frames) if (f.contentWindow === e.source) chiudi(f);
  });
  // L'errore di un'immagine arriva prima o dopo l'avviso del main: chi arriva secondo chiude.
  window.addEventListener('error', (e) => { if (bloccati.size) segna(e.target); }, true);
  // Un'immagine che poi carica una sorgente buona (banner a rotazione) torna visibile.
  window.addEventListener('load', (e) => {
    const t = e.target;
    if (t && t.nodeType === 1 && t.tagName === 'IMG' && t.hasAttribute(CHIUSO) && !fermato(t)) t.removeAttribute(CHIUSO);
  }, true);
  ipcRenderer.on('filo:adblock-stato', (_e, stato) => {
    acceso = stato !== false;
    try {
      if (acceso) document.documentElement.removeAttribute(GATE);
      else document.documentElement.setAttribute(GATE, '');
    } catch (_) {}
    for (const n of dentro) nascondiDentro(n, acceso);
  });
}

function nascondiPubblicita({ ipcRenderer, webFrame, href }) {
  // Electron non toglie un foglio dell'utente: le regole valgono finché la radice non porta questo attributo (blocco spento).
  // Il nome cambia a ogni pagina, così un sito non lo mette da sé per tenersi la pubblicità.
  const GATE = 'data-filo-' + Math.random().toString(36).slice(2, 10);
  let inserite = false;
  let attivo = false;
  let generiche = false;
  let observer = null;

  const insert = (css) => {
    if (typeof css !== 'string' || !css) return;
    try { webFrame.insertCSS(css, { cssOrigin: 'user' }); } catch (_) {}
  };

  const asked = new Set();
  let ids = [];
  let classes = [];
  let timer = null;

  const collect = (el) => {
    const id = el.id;
    if (id && typeof id === 'string' && id.length <= 120 && !asked.has('#' + id)) {
      asked.add('#' + id);
      ids.push(id);
    }
    const cl = el.classList;
    if (!cl) return;
    for (const c of cl) {
      if (c.length > 120 || asked.has('.' + c)) continue;
      asked.add('.' + c);
      classes.push(c);
    }
  };

  // Il main ne guarda 5000 per tipo a richiesta: una pagina che ne crea di più li manda a pezzi.
  const flush = () => {
    timer = null;
    if (!attivo || !generiche || (!ids.length && !classes.length)) return;
    const msg = { ids: ids.splice(0, 5000), classes: classes.splice(0, 5000), gate: GATE };
    ipcRenderer.invoke('filo:adblock-tokens', msg).then(insert).catch(() => {});
    schedule();
  };

  const survey = (root) => {
    if (!generiche || !root || root.nodeType !== 1) return;
    collect(root);
    let nodes = [];
    try { nodes = root.querySelectorAll('[id],[class]'); } catch (_) {}
    for (const n of nodes) collect(n);
  };

  const schedule = () => {
    if (!timer && (ids.length || classes.length)) timer = setTimeout(flush, 30);
  };

  // Durante il caricamento un giro solo, a pagina pronta: seguire il parser nodo per nodo lo rallenta (come uBlock).
  // Dopo, l'osservatore vede quello che arriva; a pagina caricata un altro giro per le classi messe dopo.
  const again = () => { if (attivo) { survey(document.documentElement); flush(); } };
  const osserva = () => {
    again();
    if (observer) return;
    observer = new MutationObserver((records) => {
      if (!attivo || !generiche) return;
      for (const r of records) for (const n of r.addedNodes) survey(n);
      schedule();
    });
    observer.observe(document, { childList: true, subtree: true });
  };

  const accendi = () => {
    let cfg = null;
    try { cfg = ipcRenderer.sendSync('filo:adblock-css', (window.location && window.location.href) || href, GATE); } catch (_) {}
    if (!cfg || typeof cfg !== 'object' || !cfg.on) return;
    attivo = true;
    generiche = !!cfg.tokens;
    try { if (document.documentElement) document.documentElement.removeAttribute(GATE); } catch (_) {}
    if (!inserite) {
      inserite = true;
      insert(cfg.css);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', osserva, { once: true });
    else osserva();
  };

  const spegni = () => {
    attivo = false;
    try { document.documentElement.setAttribute(GATE, ''); } catch (_) {}
  };

  ipcRenderer.on('filo:adblock-stato', () => { spegni(); accendi(); });

  accendi();
  window.addEventListener('load', again, { once: true });
}

module.exports = nascondiPubblicita;
module.exports.chiudiBloccati = chiudiBloccati;
