// Nasconde i riquadri pubblicitari che il blocco di rete lascia in pagina, con le regole delle liste (services/adblock.js).
// Foglio di stile dell'utente: batte gli !important del sito e la CSP non lo ferma. Solo nel frame principale.
// Gli id e le classi della pagina si chiedono al main man mano che compaiono: le regole generiche sono troppe per mandarle tutte.

module.exports = function nascondiPubblicita({ ipcRenderer, webFrame, href }) {
  const cfg = ipcRenderer.sendSync('filo:adblock-css', href);
  if (!cfg || typeof cfg !== 'object') return;
  const insert = (css) => {
    if (typeof css === 'string' && css) webFrame.insertCSS(css, { cssOrigin: 'user' });
  };
  insert(cfg.css);
  if (!cfg.tokens) return;

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
    if (!ids.length && !classes.length) return;
    const msg = { ids: ids.splice(0, 5000), classes: classes.splice(0, 5000) };
    ipcRenderer.invoke('filo:adblock-tokens', msg).then(insert).catch(() => {});
    schedule();
  };

  const survey = (root) => {
    if (!root || root.nodeType !== 1) return;
    collect(root);
    let nodes = [];
    try { nodes = root.querySelectorAll('[id],[class]'); } catch (_) {}
    for (const n of nodes) collect(n);
  };

  const schedule = () => {
    if (!timer && (ids.length || classes.length)) timer = setTimeout(flush, 30);
  };

  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) survey(n);
    schedule();
  }).observe(document, { childList: true, subtree: true });

  // Una classe messa dopo l'inserimento non passa dall'osservatore: un giro intero a pagina pronta e a pagina caricata.
  const again = () => { survey(document.documentElement); schedule(); };
  document.addEventListener('DOMContentLoaded', again, { once: true });
  window.addEventListener('load', again, { once: true });
};
