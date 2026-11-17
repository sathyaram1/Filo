// Filo davanti o no, e la notifica del sistema quando non lo è (#2390): la forma dell'avviso la sceglie la shell
// (src/shared/formaAvviso.js), qui si sa se una finestra di Filo ha il fuoco e si mostra l'unica forma fuori da Filo.
// Mai una notifica da una finestra incognito: resterebbe nel centro notifiche del sistema.

const path = require('node:path');

// Nelle prove la finestra non si mostra e non ha mai il fuoco: lì Filo è davanti finché una prova non dice altro, e
// la notifica si scrive in `registroProva` invece di arrivare al sistema (sul contenitore non c'è chi la mostra).
const IN_PROVA = process.env.NODE_ENV === 'test';
let perProva = IN_PROVA ? true : null;
const registroProva = [];
let annunciato = null;
let programmato = false;
let avviato = false;
// uid (o testo e chiave) → { n, chiave, win, ts }: lo stesso avviso mandato a più finestre è una notifica sola.
const mostrate = new Map();
const DOPPIONE_MS = 3000;
const ICONA = path.join(__dirname, '..', '..', '..', 'assets', 'icons', 'icon-128.png');

function electron() { return require('electron'); }

function davanti() {
  if (perProva !== null) return perProva;
  try {
    const w = electron().BrowserWindow.getFocusedWindow();
    return !!(w && !w.isDestroyed() && w.isVisible() && !w.isMinimized());
  } catch (_) { return true; }
}

function finestreFilo() {
  try { return electron().BrowserWindow.getAllWindows().filter((w) => w && !w.isDestroyed() && w._filoTabs); } catch (_) { return []; }
}

function dilloA(win, ora) {
  try { if (!win.webContents.isDestroyed()) win.webContents.send('avvisi:davanti', { davanti: ora }); } catch (_) {}
}

// Il fuoco passa fra due finestre di Filo con un blur e un focus di fila: si guarda al giro dopo.
function annuncia() {
  programmato = false;
  const ora = davanti();
  if (ora === annunciato) return;
  annunciato = ora;
  for (const w of finestreFilo()) dilloA(w, ora);
}
function programma() {
  if (programmato) return;
  programmato = true;
  setImmediate(annuncia);
}

function avvia() {
  if (avviato) return;
  avviato = true;
  try {
    const { app } = electron();
    app.on('browser-window-focus', programma);
    app.on('browser-window-blur', programma);
    // Una finestra ridotta a icona perde il fuoco, ma su alcuni sistemi il blur arriva dopo: si ricontrolla.
    app.on('browser-window-created', (_e, w) => {
      for (const ev of ['minimize', 'restore', 'show', 'hide']) { try { w.on(ev, programma); } catch (_) {} }
    });
  } catch (_) {}
}

function vecchie(adesso) {
  for (const [k, v] of mostrate) if (adesso - v.ts > DOPPIONE_MS && v.chiusa) mostrate.delete(k);
}

// `win`: la finestra che lo chiede, che al clic torna davanti con l'avviso. Ritorna false se la notifica non c'è
// (Filo davanti, incognito, sistema senza notifiche): allora l'avviso resta nella finestra.
function mostra(win, { uid = '', testo = '', titolo = '', chiave = '' } = {}) {
  const body = String(testo || '').slice(0, 2000);
  if (!body || davanti()) return false;
  if (win && win._filoIncognito) return false;
  const Notification = IN_PROVA ? NotificaDiProva : electron().Notification;
  try { if (!Notification.isSupported()) return false; } catch (_) { return false; }
  const adesso = Date.now();
  vecchie(adesso);
  const k = uid ? `uid:${uid}` : `t:${body}|${chiave}`;
  const gia = mostrate.get(k);
  if (gia && (uid || adesso - gia.ts < DOPPIONE_MS)) return true;
  let n;
  try {
    n = new Notification({ title: String(titolo || 'Filo').slice(0, 200), body, icon: ICONA });
  } catch (_) { return false; }
  const voce = { n, chiave: String(chiave || ''), win, ts: adesso, uid: String(uid || ''), chiusa: false };
  mostrate.set(k, voce);
  n.on('click', () => richiama(voce));
  n.on('close', () => { voce.chiusa = true; });
  try { n.show(); } catch (_) { mostrate.delete(k); return false; }
  return true;
}

// Il clic porta Filo davanti dove serve: la finestra che l'ha chiesto (o la normale) riceve l'avviso nella sua forma.
function richiama(voce) {
  let win = voce.win && !voce.win.isDestroyed() ? voce.win : null;
  try {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } else {
      win = require('../window').mostraFinestraNormale();
    }
  } catch (_) {}
  if (perProva === false) perProva = true;
  annuncia();
  if (win && !win.isDestroyed() && voce.uid) {
    try { win.webContents.send('avvisi:richiama', { uid: voce.uid }); } catch (_) {}
  }
}

// Lo stato che l'avviso diceva non c'è più (il timer fermato, lo scaricamento ripreso): via anche dal sistema.
function ritira(chiave) {
  const c = String(chiave || '');
  if (!c) return;
  for (const [k, v] of mostrate) {
    if (v.chiave !== c) continue;
    try { v.n.close(); } catch (_) {}
    mostrate.delete(k);
  }
}

// Solo per le prove: Filo davanti o no senza muovere finestre vere. `null` torna al fuoco vero.
function impostaPerProva(v) {
  perProva = v === null ? null : !!v;
  annuncia();
}

module.exports = { avvia, davanti, mostra, ritira, impostaPerProva, _mostrate: mostrate };
