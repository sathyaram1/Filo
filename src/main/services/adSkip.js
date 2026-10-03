// Il «Salta» delle pubblicità dei video premuto come lo premerebbe l'utente (#737): un clic del content script è finto e YouTube lo riconosce.
// Solo a YouTube (frame principale, o lettore incorporato col punto confermato dalla pagina ospite): altrove un sito si
// fabbricherebbe un pulsante per avere gesti veri. Regole: tests/unit/adSkip.test.mjs; il lato pagina è src/content/adSkip.js.
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

// I lettori incorporati: il dominio senza cookie è quello che molti siti usano per i video di YouTube.
function hostIncorporato(url) {
  if (hostConClicVero(url)) return true;
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const h = u.hostname.toLowerCase();
  return h === 'youtube-nocookie.com' || h.endsWith('.youtube-nocookie.com');
}

function framePrincipale(sender) {
  try {
    const wc = sender && sender.wc;
    const f = sender && sender.frame;
    return Boolean(wc && f && wc.mainFrame && f.frameTreeNodeId === wc.mainFrame.frameTreeNodeId);
  } catch (_) { return false; }
}

function urlDelFrame(sender) {
  try { return String(sender.frame.url || ''); } catch (_) { return ''; }
}

// Un riquadro figlio diretto del frame principale: più in fondo la pagina che lo ospita non saprebbe dov'è.
function figlioDelPrincipale(sender) {
  try {
    const wc = sender && sender.wc;
    const f = sender && sender.frame;
    return Boolean(wc && f && wc.mainFrame && f.parent && f.parent.frameTreeNodeId === wc.mainFrame.frameTreeNodeId);
  } catch (_) { return false; }
}

/** Come il mittente può avere il clic vero: 'principale' (YouTube), 'riquadro' (lettore incorporato), o null. */
function modoClicVero(sender) {
  if (!sender || !sender.tab) return null;
  if (framePrincipale(sender)) return hostConClicVero(urlDelFrame(sender)) ? 'principale' : null;
  if (figlioDelPrincipale(sender) && hostIncorporato(urlDelFrame(sender))) return 'riquadro';
  return null;
}

function mittenteConClicVero(sender) {
  return modoClicVero(sender) !== null;
}

// Il lettore incorporato chiede, la pagina che lo ospita risponde dove sta: il gettone lega le due metà.
const GETTONE_MS = 3000;
const inAttesa = new Map();

function numero(v) { return typeof v === 'number' && Number.isFinite(v); }

/** Il riquadro di YouTube chiede il clic: il main tiene il punto e dà un gettone da passare alla pagina ospite. */
function richiestaDalRiquadro(sender, msg, { ora = Date.now() } = {}) {
  if (!msg || !numero(msg.x) || !numero(msg.y) || msg.x < 0 || msg.y < 0) return { ok: false, code: 'punto' };
  for (const [k, r] of inAttesa) if (r.scade < ora || r.wc === sender.wc) inAttesa.delete(k);
  const gettone = require('crypto').randomBytes(16).toString('hex');
  inAttesa.set(gettone, {
    wc: sender.wc, padre: sender.frame.parent.frameTreeNodeId, x: msg.x, y: msg.y, scade: ora + GETTONE_MS,
  });
  return { ok: false, code: 'cornice', gettone };
}

/**
 * La pagina ospite (il suo frame principale, la stessa scheda) dice dove cade nella sua vista il punto chiesto dal
 * riquadro, dopo aver visto che lì sopra c'è il riquadro. Il gettone vale una volta. Restituisce il punto o null.
 */
function puntoDalPadre(sender, msg, { ora = Date.now() } = {}) {
  const g = msg && typeof msg.gettone === 'string' ? msg.gettone : '';
  const r = g && inAttesa.get(g);
  if (!r) return null;
  inAttesa.delete(g);
  if (r.scade < ora || !sender || sender.wc !== r.wc || !framePrincipale(sender)) return null;
  try { if (sender.frame.frameTreeNodeId !== r.padre) return null; } catch (_) { return null; }
  if (msg.rx !== r.x || msg.ry !== r.y || !numero(msg.x) || !numero(msg.y)) return null;
  return { x: msg.x, y: msg.y };
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

// La scheda in secondo piano ha la vista grande zero ma la pagina tiene la sua misura, e il clic le arriva lo stesso:
// lì il limite è l'area della finestra, dove la pagina tornerà.
function areaDelClic(view, win) {
  let b = null;
  try { b = view.getBounds(); } catch (_) { b = null; }
  if (b && b.width > 0 && b.height > 0) return b;
  let c = null;
  try { c = win && win.getContentBounds(); } catch (_) { c = null; }
  return c && c.width > 0 && c.height > 0 ? { x: 0, y: 0, width: c.width, height: c.height } : null;
}

function clicVero(wc, msg, { win, view, ora = Date.now() } = {}) {
  if (!wc || !view || (wc.isDestroyed && wc.isDestroyed())) return { ok: false, code: 'scheda' };
  if (ora - (ultimoClic.get(wc) || 0) < INTERVALLO_MS) return { ok: false, code: 'presto' };
  const b = areaDelClic(view, win);
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

// Un lettore incorporato da un altro sito vive in un processo suo: sendInputEvent arriva solo al frame principale, che
// riceverebbe lui il gesto. Il protocollo di debug instrada il clic come quello del mouse, fino al riquadro sotto il punto.
async function clicNelRiquadro(wc, msg, { win, view, ora = Date.now() } = {}) {
  if (!wc || !view || (wc.isDestroyed && wc.isDestroyed())) return { ok: false, code: 'scheda' };
  if (ora - (ultimoClic.get(wc) || 0) < INTERVALLO_MS) return { ok: false, code: 'presto' };
  const b = areaDelClic(view, win);
  let zoom = 1;
  try { zoom = wc.getZoomFactor(); } catch (_) { zoom = 1; }
  if (!b || !puntoNellaVista(msg, zoom, b.width, b.height)) return { ok: false, code: 'punto' };
  ultimoClic.set(wc, ora);
  const dbg = wc.debugger;
  let mio = false;
  try {
    if (!dbg.isAttached()) { dbg.attach('1.3'); mio = true; }
    const base = { x: msg.x, y: msg.y };
    await dbg.sendCommand('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', button: 'none' });
    await dbg.sendCommand('Input.dispatchMouseEvent', { ...base, type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1 });
    await dbg.sendCommand('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1 });
  } catch (_) {
    return { ok: false, code: 'scheda' };
  } finally {
    if (mio) { try { dbg.detach(); } catch (_) {} }
  }
  if (win) rimettiPuntatore(wc, win, b);
  return { ok: true };
}

module.exports = {
  attivo, configureFromSettings, hostConClicVero, hostIncorporato, modoClicVero, mittenteConClicVero,
  richiestaDalRiquadro, puntoDalPadre, puntoNellaVista, clicVero, clicNelRiquadro, INTERVALLO_MS, GETTONE_MS,
};
