// Il «Salta» delle pubblicità dei video premuto come lo premerebbe l'utente (#737): un clic del content script è finto e YouTube lo riconosce.
// Il clic vero va solo al frame principale di una scheda su YouTube: altrove un sito si fabbricherebbe un pulsante per avere gesti veri.
// Regole: tests/unit/adSkip.test.mjs; il lato pagina è src/content/adSkip.js.
'use strict';

// Fra due clic veri sulla stessa scheda: più fitto di così non serve nemmeno a una serie di pubblicità.
const INTERVALLO_MS = 800;
const ultimoClic = new WeakMap();
let ultimoStato = null;

function attivo(settings) {
  return settings?.security?.adSkip?.enabled !== false;
}

// Rilegge l'interruttore; true se è cambiato, così chi salva le impostazioni lo dice alle schede.
function configureFromSettings(settings) {
  const ora = attivo(settings);
  const cambiato = ultimoStato !== null && ultimoStato !== ora;
  ultimoStato = ora;
  return cambiato;
}

/** I siti a cui Filo dà il clic vero sul «Salta». PURA. */
function hostConClicVero(url) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const h = u.hostname.toLowerCase();
  return h === 'youtube.com' || h.endsWith('.youtube.com');
}

function framePrincipale(sender) {
  try {
    const wc = sender && sender.wc;
    const f = sender && sender.frame;
    return Boolean(wc && f && wc.mainFrame && f.frameTreeNodeId === wc.mainFrame.frameTreeNodeId);
  } catch (_) { return false; }
}

/** Il mittente può chiedere il clic vero: una scheda, il suo frame principale, su YouTube. */
function mittenteConClicVero(sender) {
  if (!sender || !sender.tab || !framePrincipale(sender)) return false;
  let url = '';
  try { url = String(sender.frame.url || ''); } catch (_) { url = ''; }
  return hostConClicVero(url);
}

/**
 * Dal punto della pagina (px CSS del riquadro visibile) al punto della vista (px dello schermo logico). PURA.
 * Fuori dalla vista, o non un numero, è null: il clic non parte.
 */
function puntoNellaVista(msg, zoom, larghezza, altezza) {
  if (!msg || typeof msg.x !== 'number' || typeof msg.y !== 'number') return null;
  const { x, y } = msg;
  const z = Number(zoom) > 0 ? Number(zoom) : 1;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
  const px = Math.round(x * z);
  const py = Math.round(y * z);
  if (!(px < Number(larghezza)) || !(py < Number(altezza))) return null;
  return { x: px, y: py };
}

// Dopo il clic la pagina crede che il puntatore sia sul «Salta»: glielo si rimette dov'è davvero.
function rimettiPuntatore(wc, win, vista) {
  try {
    const { screen } = require('electron');
    const c = screen.getCursorScreenPoint();
    const cb = win.getContentBounds();
    const x = Math.round(c.x - cb.x - vista.x);
    const y = Math.round(c.y - cb.y - vista.y);
    const dentro = x >= 0 && y >= 0 && x < vista.width && y < vista.height;
    wc.sendInputEvent({ type: dentro ? 'mouseMove' : 'mouseLeave', x, y });
  } catch (_) {}
}

function clicVero(wc, msg, { win, view, ora = Date.now() } = {}) {
  if (!wc || !view || (wc.isDestroyed && wc.isDestroyed())) return { ok: false, code: 'scheda' };
  if (ora - (ultimoClic.get(wc) || 0) < INTERVALLO_MS) return { ok: false, code: 'presto' };
  let b = null;
  try { b = view.getBounds(); } catch (_) { b = null; }
  let zoom = 1;
  try { zoom = wc.getZoomFactor(); } catch (_) { zoom = 1; }
  const p = b && puntoNellaVista(msg, zoom, b.width, b.height);
  if (!p) return { ok: false, code: 'punto' };
  ultimoClic.set(wc, ora);
  try {
    wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  } catch (_) { return { ok: false, code: 'scheda' }; }
  if (win) rimettiPuntatore(wc, win, b);
  return { ok: true };
}

module.exports = {
  attivo, configureFromSettings, hostConClicVero, mittenteConClicVero, puntoNellaVista, clicVero, INTERVALLO_MS,
};
