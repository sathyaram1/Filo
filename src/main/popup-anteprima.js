// La carta che mostra cosa c'è in una scheda quando il puntatore le passa sopra (#430): finestra figlia,
// perché la shell non disegna sopra la pagina. Le foto arrivano PRIMA dell'hover, già decodificate nella carta.
// Non fotografa niente (tabs/anteprime.js) e non decide quando comparire (shell.js). Regole: patterns/l-anteprima-di-una-scheda-si-scatta-prima-che-serva.md

const path = require('node:path');
const { BrowserWindow, nativeTheme } = require('electron');
const { hideForTests } = require('./test-window-mode');

// Il margine trasparente tiene l'ombra; sopra è sottile perché la carta sfiora la barra delle schede.
const MARGINE = { su: 2, lati: 10, giu: 14 };
const NOME_VAR = /^--[a-z][a-z0-9-]*$/;
const LARGHEZZE = { piccola: 220, media: 280, grande: 360 };

const stati = new WeakMap();

function larghezzaDi(misura) {
  return LARGHEZZE[misura] || LARGHEZZE.media;
}

function testo(v) { return typeof v === 'string' ? v : String(v == null ? '' : v); }

function temaPulito(vars) {
  const out = {};
  if (vars && typeof vars === 'object') {
    for (const [k, v] of Object.entries(vars)) {
      if (NOME_VAR.test(k) && typeof v === 'string' && !/[;{}<>]/.test(v)) out[k] = v;
    }
  }
  return out;
}

function statoDi(parent) {
  let s = stati.get(parent);
  if (!s) {
    s = { win: null, pronta: false, voluta: null, posa: null, attese: [] };
    stati.set(parent, s);
  }
  return s;
}

function invia(s, canale, dati) {
  if (!s.win || s.win.isDestroyed()) return;
  if (!s.pronta) { s.attese.push([canale, dati]); return; }
  try { s.win.webContents.send(canale, dati); } catch (_) {}
}

function finestra(parent) {
  if (!parent || parent.isDestroyed()) return null;
  const s = statoDi(parent);
  if (s.win && !s.win.isDestroyed()) return s;
  const win = new BrowserWindow({
    parent,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    hasShadow: false,
    width: 300,
    height: 200,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'anteprima-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // Le foto si decodificano mentre è nascosta: senza, aspetterebbero la prima comparsa.
      backgroundThrottling: false,
    },
  });
  // Non prende mai il puntatore: sotto c'è la pagina, e sopra la barra delle schede che ha aperto la carta.
  try { win.setIgnoreMouseEvents(true); } catch (_) {}
  hideForTests(win);
  s.win = win;
  s.pronta = false;
  s.attese = [];
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.once('did-finish-load', () => {
    s.pronta = true;
    const tabs = parent._filoTabs;
    const tutte = tabs && tabs.anteprime ? tabs.anteprime.tutte() : [];
    for (const [id, dato] of tutte) {
      try { wc.send('anteprima:immagine', { id, src: dato.src, w: dato.w, h: dato.h }); } catch (_) {}
    }
    const attese = s.attese;
    s.attese = [];
    for (const [c, d] of attese) { try { wc.send(c, d); } catch (_) {} }
  });
  wc.on('ipc-message', (_e, canale, dati) => {
    if (canale === 'anteprima:misura') posa(parent, s, dati);
    else if (canale === 'anteprima:vuota') {
      if (!s.voluta && !win.isDestroyed() && win.isVisible()) win.hide();
    }
  });
  win.on('closed', () => { if (s.win === win) { s.win = null; s.pronta = false; } });
  win.loadURL('filo://shell/anteprima.html');
  return s;
}

function posa(parent, s, dati) {
  const voluta = s.voluta;
  if (!voluta || !dati || dati.n !== voluta.n || !s.win || s.win.isDestroyed() || parent.isDestroyed()) return;
  const w = Math.max(40, Math.min(2000, Math.round(Number(dati.w) || 0)));
  const h = Math.max(20, Math.min(2000, Math.round(Number(dati.h) || 0)));
  const cb = parent.getContentBounds();
  const W = w + MARGINE.lati * 2;
  const H = h + MARGINE.su + MARGINE.giu;
  // Allineata al bordo sinistro della scheda, dentro la finestra anche per l'ultima scheda a destra.
  let x = cb.x + voluta.x - MARGINE.lati;
  x = Math.min(x, cb.x + cb.width - W);
  x = Math.max(x, cb.x);
  const y = cb.y + voluta.y - MARGINE.su;
  s.win.setBounds({ x: Math.round(x), y: Math.round(y), width: W, height: H });
  if (!s.win.isVisible()) s.win.showInactive();
}

function precarica(parent, id, dato) {
  const s = finestra(parent);
  if (!s || !dato) return;
  invia(s, 'anteprima:immagine', { id: testo(id), src: dato.src, w: dato.w, h: dato.h });
}

function dimentica(parent, ids) {
  const s = parent && !parent.isDestroyed() ? stati.get(parent) : null;
  if (!s) return;
  invia(s, 'anteprima:dimentica', (ids || []).map(testo));
  if (s.voluta && ids.includes(s.voluta.id)) nascondi(parent);
}

// dati: { id, titolo, x, y, misura, tema } con x/y nella shell (bordo sinistro e fondo della scheda).
function mostra(parent, dati) {
  const tabs = parent && parent._filoTabs;
  if (!tabs || !dati) return false;
  const id = testo(dati.id);
  const tab = tabs.tabs.find((t) => t.id === id);
  if (!tab) { nascondi(parent); return false; }
  const s = finestra(parent);
  if (!s) return false;
  const n = (s.voluta ? s.voluta.n : 0) + 1;
  s.voluta = { n, id, x: Math.round(Number(dati.x) || 0), y: Math.round(Number(dati.y) || 0) };
  const davanti = id === tabs.activeId;
  invia(s, 'anteprima:mostra', {
    n,
    id,
    titolo: testo(dati.titolo) || testo(tab.title) || testo(tab.url),
    indirizzo: indirizzoDi(tab.url),
    // Della scheda davanti la pagina si vede già: la carta dice solo cos'è.
    immagine: !davanti && !!tabs.anteprime.get(id),
    larghezza: larghezzaDi(dati.misura),
    margine: MARGINE,
    tema: temaPulito(dati.tema),
    scuro: nativeTheme.shouldUseDarkColors,
  });
  return true;
}

function nascondi(parent) {
  const s = parent ? stati.get(parent) : null;
  if (!s || !s.voluta) return;
  s.voluta = null;
  // La carta si svuota prima di sparire: chi la rivede dopo non trova per un istante la scheda di prima.
  invia(s, 'anteprima:nascondi', {});
}

function indirizzoDi(url) {
  const u = testo(url);
  if (!/^https?:\/\//i.test(u)) return '';
  try { return new URL(u).hostname.replace(/^www\./i, ''); } catch (_) { return ''; }
}

function finestraDi(parent) {
  const s = parent ? stati.get(parent) : null;
  return s && s.win && !s.win.isDestroyed() ? s.win : null;
}

module.exports = { precarica, dimentica, mostra, nascondi, finestraDi, larghezzaDi, indirizzoDi, LARGHEZZE };
