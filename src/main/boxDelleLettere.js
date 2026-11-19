// Il box delle lettere del doppio Ctrl (#2377): una finestra figlia per finestra madre, riusata, sopra qualunque scheda
// (home compresa) e col fuoco. Mostra e cambia le lettere; cosa fanno e quando si apre lo decide src/main/lettereDiFilo.js.
// Regole: patterns/una-finestra-a-comparsa-nasce-una-volta-e-si-riusa.md

const { BrowserWindow, nativeTheme } = require('electron');
const path = require('node:path');
const { hideForTests } = require('./test-window-mode');

const LARGHEZZA = 300;
const MARGINE = 14;
const RIGA_H = 34;
const SEP_H = 9;
const PAD = 12;
// Un blur subito dopo la comparsa può essere quello, in ritardo, della finestra di prima (X11).
const GRAZIA_BLUR_MS = 150;

const stati = new WeakMap();

function statoDi(parent) {
  let s = stati.get(parent);
  if (!s) { s = { parent, win: null, pronta: false, attesa: null, aperto: false, giro: 0, mani: null, mostratoAlle: 0, posa: null }; stati.set(parent, s); }
  return s;
}

function invia(s, dati) {
  if (!s.win || s.win.isDestroyed()) return;
  if (!s.pronta) { s.attesa = dati; return; }
  try { s.win.webContents.send('box-lettere:voci', dati); } catch (_) {}
}

function finestraDi(parent) {
  if (!parent || parent.isDestroyed()) return null;
  const s = statoDi(parent);
  if (s.win && !s.win.isDestroyed()) return s;
  const win = new BrowserWindow({
    parent, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, focusable: true, show: false, hasShadow: false, width: LARGHEZZA + MARGINE * 2, height: 200,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, '..', 'preload', 'box-lettere-preload.js'), backgroundThrottling: false },
  });
  s.win = win;
  s.pronta = false;
  hideForTests(win);
  const wc = win.webContents;
  // Col fuoco qui, il tocco che chiude il box e le scorciatoie di Filo passano di lì.
  require('./shortcuts').collegaScorciatoie(wc, parent);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.once('did-finish-load', () => {
    if (s.win !== win) return;
    s.pronta = true;
    const d = s.attesa;
    s.attesa = null;
    if (d) invia(s, d);
  });
  wc.on('ipc-message', (_e, canale, a, b, c) => { if (s.win === win) dalBox(s, canale, a, b, c); });
  wc.on('render-process-gone', () => { if (s.win !== win) return; s.win = null; chiudi(s, 'guasto'); if (!win.isDestroyed()) win.destroy(); });
  win.on('blur', () => sfocato(s, win));
  win.on('closed', () => { if (s.win !== win) return; s.win = null; s.pronta = false; chiudi(s, 'chiuso'); });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(documento()));
  return s;
}

function dalBox(s, canale, a, b, c) {
  if (canale === 'box-lettere:pronto') {
    if (s.aperto && a === s.giro) mostra(s);
  } else if (canale === 'box-lettere:scegli') {
    if (!s.aperto || b !== s.giro) return;
    const mani = s.mani;
    chiudi(s, 'scelta');
    if (mani && mani.scegli) { try { mani.scegli(String(a || '')); } catch (_) {} }
  } else if (canale === 'box-lettere:assegna') {
    if (!s.aperto || c !== s.giro || !s.mani || !s.mani.assegna) return;
    try { s.mani.assegna(String(a || ''), String(b || '')); } catch (_) {}
  } else if (canale === 'box-lettere:chiudi') {
    if (s.aperto && a === s.giro) chiudi(s, 'esc');
  } else if (canale === 'box-lettere:fumetto') {
    fumetto(s, String(a || ''), Number(b), Number(c));
  }
}

// Il suggerimento del tasto di una riga lo disegna il fumetto di Filo, sopra il box (le coordinate della madre).
function fumetto(s, testo, x, y) {
  const T = require('./popup-tooltip');
  if (!testo || !s.aperto || !s.win || s.win.isDestroyed() || !Number.isFinite(x) || !Number.isFinite(y)) { try { T.hideTooltip(); } catch (_) {} return; }
  const b = s.win.getBounds();
  const cb = s.parent.getContentBounds();
  try { T.showTooltip(s.parent, testo, Math.round(b.x - cb.x + x), Math.round(b.y - cb.y + y)); } catch (_) {}
}

function mostra(s) {
  const win = s.win;
  if (!win || win.isDestroyed() || !s.posa) return;
  win.setBounds(s.posa);
  s.mostratoAlle = Date.now();
  win.show();
  try { win.focus(); win.webContents.focus(); } catch (_) {}
}

function chiudi(s, perche) {
  if (!s.aperto) return;
  s.aperto = false;
  const mani = s.mani;
  s.mani = null;
  s.giro += 1;
  const win = s.win;
  try { require('./popup-tooltip').hideTooltip(); } catch (_) {}
  if (win && !win.isDestroyed() && win.isVisible()) win.hide();
  // Il fuoco torna dov'era: la scheda davanti, che non deve accorgersi del box.
  try { if (s.parent && !s.parent.isDestroyed() && perche !== 'fuoco') s.parent.focus(); } catch (_) {}
  if (mani && mani.chiuso) { try { mani.chiuso(perche); } catch (_) {} }
}

function sfocato(s, win) {
  if (!s.aperto || s.win !== win) return;
  const giro = s.giro;
  const resta = GRAZIA_BLUR_MS - (Date.now() - s.mostratoAlle);
  if (resta <= 0) { chiudi(s, 'fuoco'); return; }
  setTimeout(() => { if (s.aperto && s.giro === giro && !win.isDestroyed() && !win.isFocused()) chiudi(s, 'fuoco'); }, resta);
}

// In alto nel terzo superiore della finestra madre, al centro: lo sguardo è lì, non sul puntatore.
function posizione(parent, n) {
  const cb = parent.getContentBounds();
  const voluta = PAD * 2 + n.righe * RIGA_H + (n.sep ? SEP_H : 0) + MARGINE * 2;
  const height = Math.max(120, Math.min(voluta, cb.height - 24));
  const width = LARGHEZZA + MARGINE * 2;
  const x = cb.x + Math.round((cb.width - width) / 2);
  const y = cb.y + Math.max(12, Math.round((cb.height - height) / 3));
  return { x, y, width, height };
}

// `voci`: { con: [{ id, lettera, titolo }], senza: [...] } (src/shared/doppioCtrl.js ordinate). `mani`: scegli(id),
// assegna(id, lettera), chiuso(perche).
function apri(parent, voci, mani) {
  const s = finestraDi(parent);
  if (!s) return false;
  const giro = ++s.giro;
  s.aperto = true;
  s.mani = mani || null;
  s.mostratoAlle = Date.now();
  s.posa = posizione(parent, { righe: voci.con.length + voci.senza.length, sep: voci.senza.length > 0 });
  invia(s, { n: giro, voci, scuro: !!nativeTheme.shouldUseDarkColors, vars: require('./movimento').variabili() });
  return true;
}

// Le lettere cambiate dal box: lo stesso box, ridisegnato, resta aperto.
function aggiorna(parent, voci) {
  const s = parent ? stati.get(parent) : null;
  if (!s || !s.aperto) return;
  invia(s, { n: s.giro, voci, scuro: !!nativeTheme.shouldUseDarkColors, vars: require('./movimento').variabili(), resta: true });
}

function aperto(parent) {
  const s = parent ? stati.get(parent) : null;
  return !!(s && s.aperto);
}
function chiudiBox(parent, perche = 'tocco') {
  const s = parent ? stati.get(parent) : null;
  if (s) chiudi(s, perche);
}
// La finestra del box, se questo webContents è il suo: il tocco che arriva da lì chiude il box.
function eDelBox(wc) {
  try {
    const w = BrowserWindow.fromWebContents(wc);
    const p = w && w.getParentWindow && w.getParentWindow();
    const s = p ? stati.get(p) : null;
    return s && s.win === w ? p : null;
  } catch (_) { return null; }
}
function preparaBox(parent) { finestraDi(parent); }

// ── Il documento ──────────────────────────────────────────────────────────
// Una lettera sceglie la sua voce; il clic sul tasto (o il tasto destro sulla riga) aspetta la lettera nuova, che
// Canc o Backspace tolgono. Esc chiude, o esce dal cambio; frecce e Invio come in ogni menu di Filo.
const SCRIPT = `(() => {
  const api = window.boxLettere;
  let giro = 0, i = -1, cambia = '';
  const righe = () => [...document.querySelectorAll('.riga')];
  const segna = (n) => {
    const r = righe();
    if (!r.length) return;
    i = n < 0 ? -1 : (n + r.length) % r.length;
    r.forEach((b, k) => b.classList.toggle('attiva', k === i));
    if (i >= 0) r[i].focus();
  };
  const inCambio = (id) => {
    cambia = id || '';
    righe().forEach((r) => r.classList.toggle('cambio', r.dataset.id === cambia));
  };
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('.tasto');
    const r = e.target.closest && e.target.closest('.riga');
    if (!r) return;
    if (t) { inCambio(cambia === r.dataset.id ? '' : r.dataset.id); return; }
    if (cambia) { inCambio(''); return; }
    api.scegli(r.dataset.id, giro);
  });
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const r = e.target.closest && e.target.closest('.riga');
    if (r) inCambio(r.dataset.id);
  });
  let sotto = null;
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t === sotto) return;
    sotto = t;
    if (!t) { api.fumetto('', 0, 0); return; }
    const r = t.getBoundingClientRect();
    api.fumetto(t.dataset.tip, r.left + r.width / 2, r.bottom + 4);
  });
  document.addEventListener('mousemove', (e) => {
    const r = e.target.closest && e.target.closest('.riga');
    const k = r ? righe().indexOf(r) : -1;
    if (k !== i && k >= 0) segna(k);
  });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const l = e.key.length === 1 && /^[a-z]$/i.test(e.key) ? e.key.toLowerCase()
      : (/^Key([A-Z])$/.exec(e.code || '') || [])[1] ? e.code.slice(3).toLowerCase() : '';
    if (cambia) {
      if (e.key === 'Escape') inCambio('');
      else if (e.key === 'Backspace' || e.key === 'Delete') api.assegna(cambia, '', giro);
      else if (l) api.assegna(cambia, l, giro);
      else return;
      e.preventDefault();
      return;
    }
    const n = righe().length;
    if (e.key === 'Escape') api.chiudi(giro);
    else if (e.key === 'ArrowDown') segna(i + 1);
    else if (e.key === 'ArrowUp') segna(i < 0 ? n - 1 : i - 1);
    else if (e.key === 'Enter' && i >= 0) api.scegli(righe()[i].dataset.id, giro);
    else if (l) {
      const r = righe().find((x) => x.dataset.lettera === l);
      if (r) api.scegli(r.dataset.id, giro);
      else { const b = document.querySelector('.box'); b.classList.remove('no'); void b.offsetWidth; b.classList.add('no'); }
    } else return;
    e.preventDefault();
  });
  const esc = (v) => String(v == null ? '' : v).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
  const riga = (v) => '<div class="riga' + (v.lettera ? '' : ' senza') + '" tabindex="-1" role="menuitem" data-id="' + esc(v.id) + '" data-lettera="' + esc(v.lettera) + '">'
    + '<span class="tasto" data-tip="' + (v.lettera ? 'Cambia lettera' : 'Dai una lettera') + '" aria-label="' + (v.lettera ? 'Cambia lettera' : 'Dai una lettera') + '">' + esc(String(v.lettera || '').toUpperCase()) + '</span>'
    + '<span class="lbl">' + esc(v.titolo) + '</span></div>';
  if (!api) return;
  api.onVoci((d) => {
    giro = (d && Number(d.n)) || 0;
    sotto = null;
    document.documentElement.classList.toggle('scuro', !!(d && d.scuro));
    for (const [k, v] of Object.entries((d && d.vars) || {})) {
      if (/^--sn-[a-z-]+$/.test(k) && /^[0-9.]+$/.test(String(v))) document.documentElement.style.setProperty(k, String(v));
    }
    const voci = (d && d.voci) || { con: [], senza: [] };
    const box = document.querySelector('.box');
    box.innerHTML = voci.con.map(riga).join('') + (voci.senza.length ? '<div class="sep"></div>' + voci.senza.map(riga).join('') : '');
    if (!d.resta) { i = -1; box.classList.remove('vista'); void box.offsetWidth; box.classList.add('vista'); box.scrollTop = 0; }
    inCambio('');
    api.pronto(giro);
  });
})();`;

function stile() {
  return `*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:rgba(248,246,240,0.98);--fg:#1a1918;--muted:#8a8780;--border:#e0dcd4;--cap:#fffdf8;--accento:196,90,59;--sn-ombra:calc(var(--sn-shadow-opacity, 0.18) / 0.18)}
:root.scuro{--bg:rgba(30,29,27,0.98);--fg:#e5e3dc;--muted:#8a8780;--border:#3a3835;--cap:#262523}
html,body{background:transparent;overflow:hidden;height:100%}
.box{
  margin:${MARGINE}px;max-height:calc(100% - ${MARGINE * 2}px);overflow-y:auto;
  background:var(--bg);border:1px solid var(--border);border-radius:10px;
  box-shadow:0 8px 28px rgba(0,0,0,calc(0.22 * var(--sn-ombra, 1)));
  padding:${PAD - 6}px 0;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:13px;color:var(--fg);
}
.box.vista{animation:entra calc(120ms * var(--sn-motion, 1)) ease-out}
@keyframes entra{from{opacity:0;transform:translateY(-4px) scale(.99)}to{opacity:1;transform:none}}
/* Una lettera che non fa niente: il box si scuote appena, come un tasto che non scatta. */
.box.no{animation:no calc(180ms * var(--sn-motion, 1)) ease-in-out}
@keyframes no{25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
.riga{display:flex;align-items:center;gap:12px;height:${RIGA_H}px;padding:0 14px;cursor:pointer;outline:none}
.riga:hover,.riga.attiva{background:rgba(var(--accento),0.12)}
.riga.senza .lbl{color:var(--muted)}
/* Il tasto della tastiera, col bordo basso più spesso: si legge come un tasto vero. */
.tasto{
  flex:0 0 24px;height:24px;display:inline-flex;align-items:center;justify-content:center;
  border:1px solid var(--border);border-bottom-width:2px;border-radius:6px;background:var(--cap);
  font-weight:600;font-size:12px;color:var(--fg);transition:border-color calc(120ms * var(--sn-motion, 1));
}
.tasto:hover{border-color:rgba(var(--accento),0.7)}
.riga.cambio .tasto{border-color:rgb(var(--accento));color:rgb(var(--accento));animation:attesa calc(900ms * var(--sn-motion, 1)) ease-in-out infinite}
@keyframes attesa{50%{background:rgba(var(--accento),0.14)}}
.lbl{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sep{height:1px;background:var(--border);margin:4px 10px}`;
}

function documento() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lettere di Filo</title><style>${stile()}</style></head>`
    + `<body><div class="box" role="menu" aria-label="Lettere di Filo"></div><script>${SCRIPT}</script></body></html>`;
}

module.exports = { apri, aggiorna, aperto, chiudi: chiudiBox, eDelBox, preparaBox, documento, posizione };
