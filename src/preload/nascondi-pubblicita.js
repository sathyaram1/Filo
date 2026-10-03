// Nasconde i riquadri pubblicitari che il blocco di rete lascia in pagina, con le regole delle liste (services/adblock.js).
// Foglio di stile dell'utente: batte gli !important del sito e la CSP non lo ferma. Solo nel frame principale.
// Gli id e le classi della pagina si chiedono al main man mano che compaiono: le regole generiche sono troppe per mandarle tutte.

// Un'immagine o un riquadro che il blocco ha fermato si chiude, o resta il buco grande quanto l'annuncio.
const CHIUSO = 'data-filo-pub-chiuso';
const ELEMENTI = 'img,iframe,frame,embed,object';
const MAX_BLOCCATI = 500;

module.exports = function nascondiPubblicita({ ipcRenderer, webFrame, href }) {
  let keys = [];
  // Una risposta chiesta prima di uno spegnimento non deve rimettere le regole dopo.
  let giro = 0;
  let attivo = false;
  let generiche = false;
  let observer = null;

  const insert = (css, g) => {
    if (g !== giro || typeof css !== 'string' || !css) return;
    try { keys.push(webFrame.insertCSS(css, { cssOrigin: 'user' })); } catch (_) {}
  };

  const asked = new Set();
  let ids = [];
  let classes = [];
  let timer = null;

  const bloccati = new Set();
  const srcDi = (el) => [el.currentSrc, el.src, el.data].filter((s) => typeof s === 'string' && s);
  const segna = (el) => {
    if (el && el.nodeType === 1 && srcDi(el).some((s) => bloccati.has(s))) el.setAttribute(CHIUSO, '');
  };

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
    const g = giro;
    const msg = { ids: ids.splice(0, 5000), classes: classes.splice(0, 5000) };
    ipcRenderer.invoke('filo:adblock-tokens', msg).then((css) => insert(css, g)).catch(() => {});
    schedule();
  };

  const survey = (root) => {
    if (!root || root.nodeType !== 1) return;
    let nodes = [];
    try { nodes = root.querySelectorAll(generiche ? '[id],[class]' : ELEMENTI); } catch (_) {}
    if (generiche) collect(root);
    if (bloccati.size) { segna(root); for (const n of nodes) if (n.matches && n.matches(ELEMENTI)) segna(n); }
    if (generiche) for (const n of nodes) collect(n);
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
      if (!attivo || (!generiche && !bloccati.size)) return;
      for (const r of records) for (const n of r.addedNodes) survey(n);
      schedule();
    });
    observer.observe(document, { childList: true, subtree: true });
  };

  const accendi = () => {
    let cfg = null;
    try { cfg = ipcRenderer.sendSync('filo:adblock-css', (window.location && window.location.href) || href); } catch (_) {}
    if (!cfg || typeof cfg !== 'object') return;
    attivo = true;
    generiche = !!cfg.tokens;
    insert(`[${CHIUSO}]{display:none!important}`, giro);
    insert(cfg.css, giro);
    asked.clear();
    ids = [];
    classes = [];
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', osserva, { once: true });
    else osserva();
  };

  const spegni = () => {
    giro++;
    attivo = false;
    for (const k of keys) { try { webFrame.removeCSS(k); } catch (_) {} }
    keys = [];
  };

  ipcRenderer.on('filo:adblock-stato', () => { spegni(); accendi(); });

  ipcRenderer.on('filo:adblock-chiudi', (_e, url) => {
    if (typeof url !== 'string' || !url) return;
    bloccati.add(url);
    if (bloccati.size > MAX_BLOCCATI) bloccati.delete(bloccati.values().next().value);
    let nodes = [];
    try { nodes = document.querySelectorAll(ELEMENTI); } catch (_) {}
    for (const n of nodes) segna(n);
  });
  // L'errore di un'immagine arriva prima o dopo l'avviso del main: chi arriva secondo chiude.
  window.addEventListener('error', (e) => { if (bloccati.size) segna(e.target); }, true);
  // Un'immagine che poi carica una sorgente buona (banner a rotazione) torna visibile.
  window.addEventListener('load', (e) => {
    const t = e.target;
    if (t && t.nodeType === 1 && t.tagName === 'IMG' && t.hasAttribute(CHIUSO) && !srcDi(t).some((s) => bloccati.has(s))) {
      t.removeAttribute(CHIUSO);
    }
  }, true);

  accendi();
  window.addEventListener('load', again, { once: true });
};
