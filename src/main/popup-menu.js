// Il menu a comparsa di Filo (tasto destro su una scheda, Impostazioni/App/Profilo, avvisi, barra laterale): una
// finestra figlia per finestra madre, perché l'HTML della shell non sta sopra le schede. Non decide le voci.
// Regole: patterns/una-finestra-a-comparsa-nasce-una-volta-e-si-riusa.md

const { BrowserWindow, nativeTheme } = require('electron');
const path = require('node:path');
const { hideForTests } = require('./test-window-mode');
const { collegaScorciatoie } = require('./shortcuts');

const stati = new WeakMap();
// Un menu solo in tutta l'app: aprirne uno in un'altra finestra chiude questo.
let inVista = null;

// Icone del menu: il popup è una finestra a sé e non carica src/shared/icons.js, quindi
// queste ne sono una COPIA — una voce che sta in tutte e due deve disegnare lo stesso.
const ICON_PATHS = {
  // `note` in src/shared/icons.js: gli appunti vivono nell'editor, stessa icona.
  editor:
    '<path d="M6 3.5h8l4 4v13H6z"/>' +
    '<path d="M14 3.5v4h4"/>' +
    '<path d="M9 12.5h6"/>' +
    '<path d="M9 15.8h4"/>',

  feedback:
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',

  options:
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z"/>',

  colorPicker:
    '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',

  lock:
    '<rect x="5" y="11" width="14" height="9" rx="1.5"/>' +
    '<path d="M8 11V8a4 4 0 0 1 8 0v3"/>',

  transparency:
    '<path d="M12 6.6C10.4 5.1 8.3 4.6 4 4.6v12.6c4.3 0 6.4.5 8 2 1.6-1.5 3.7-2 8-2V4.6c-4.3 0-6.4.5-8 2z"/>' +
    '<path d="M12 6.6v14.6"/>',

  close:
    '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',

  // Freccia indietro: COPIA di `back` in src/shared/icons.js. Voce «Torna indietro» del menu dell'avviso del sito.
  back:
    '<path d="M19 12H5"/>' +
    '<path d="M11 6l-6 6 6 6"/>',

  // Biscotto morsicato — righe del banner dei cookie nel menu della scheda (#754).
  cookie:
    '<path d="M12 3a9 9 0 1 0 9 9 3 3 0 0 1-3.6-3.4A3 3 0 0 1 14.4 5 3 3 0 0 1 12 3z"/>' +
    '<path d="M8.5 9.5h.01"/><path d="M15.5 15h.01"/><path d="M9.5 15.5h.01"/><path d="M12.5 12h.01"/>',

  // Chiave — «Resta connesso qui» / «Non restare connesso» (#759).
  key:
    '<circle cx="8" cy="15" r="4"/>' +
    '<path d="M10.8 12.2L20 3"/><path d="M16.5 6.5l2.5 2.5"/><path d="M14 9l2 2"/>',

  // Occhio — «Mostra il banner dei cookie».
  eye:
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/>' +
    '<circle cx="12" cy="12" r="2.8"/>',

  // Freccia che torna: COPIA di `undo` in src/shared/icons.js. Voce «Riapri scheda chiusa» del menu della scheda.
  undo:
    '<path d="M4 10h11a5 5 0 0 1 0 10h-4"/>' +
    '<path d="M8 6l-4 4 4 4"/>',

  duplicate:
    '<rect x="9" y="9" width="11" height="11" rx="2"/>' +
    '<path d="M5 15V5a2 2 0 0 1 2-2h10"/>',

  sound:
    '<path d="M4 9v6h4l5 4V5L8 9z"/>' +
    '<path d="M16.5 8.5a5 5 0 0 1 0 7"/>' +
    '<path d="M19 6a8 8 0 0 1 0 12"/>',

  mute:
    '<path d="M4 9v6h4l5 4V5L8 9z"/>' +
    '<path d="M17 9l4 6"/><path d="M21 9l-4 6"/>',

  help:
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
    '<path d="M9.2 9.3a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.4-2.6 2.4"/>' +
    '<path d="M12 15.2h.01"/>',

  user:
    '<circle cx="12" cy="8" r="4"/><path d="M5 20a7 7 0 0 1 14 0"/>',

  // Moneta forata col filo nel foro: COPIA di `credits` in src/shared/icons.js. Voce «Crediti» del menu Profilo.
  credits:
    '<circle cx="12" cy="13.5" r="7"/>' +
    '<rect x="9.75" y="11.25" width="4.5" height="4.5" rx="0.5"/>' +
    '<path d="M12 11.25V5.5"/>' +
    '<path d="M12 5.5a2 2 0 1 0 0.01 0"/>',

  incognito:
    '<path d="M3 13h18"/>' +
    '<path d="M6 13l1.4-3.8A2.2 2.2 0 0 1 9.5 7.8h5a2.2 2.2 0 0 1 2.1 1.4L18 13"/>' +
    '<circle cx="8" cy="16.2" r="2.3"/>' +
    '<circle cx="16" cy="16.2" r="2.3"/>' +
    '<path d="M10.3 16.2h3.4"/>',

  models:
    '<circle cx="12" cy="5" r="2"/>' +
    '<circle cx="5.5" cy="18" r="2"/>' +
    '<circle cx="18.5" cy="18" r="2"/>' +
    '<path d="M11 6.7L6.5 16.3"/>' +
    '<path d="M13 6.7L17.5 16.3"/>' +
    '<path d="M7.5 18L16.5 18"/>',

  // "Apri da un altro paese": un globo, mai un lucchetto — il tono è viaggio.
  globe:
    '<circle cx="12" cy="12" r="9"/>' +
    '<path d="M3 12h18"/>' +
    '<path d="M12 3a13.5 13.5 0 0 1 0 18"/>' +
    '<path d="M12 3a13.5 13.5 0 0 0 0 18"/>',

  decks:
    '<rect x="8" y="5" width="10" height="14" rx="1.5"/>' +
    '<path d="M6.5 7.2l-2.9.8 3.1 11 3.4-.9"/>',

  board:
    '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/>' +
    '<path d="M9 5v14"/>' +
    '<path d="M15 5v14"/>',

  download:
    '<path d="M12 3v11"/>' +
    '<path d="M8 10.5l4 4 4-4"/>' +
    '<path d="M4 19h16"/>',

  saveForLater:
    '<path d="M7 4h10a1 1 0 0 1 1 1v15.2l-6-3.8-6 3.8V5a1 1 0 0 1 1-1z"/>',
  memory:
    '<path d="M9.5 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 1.5 5A3 3 0 0 0 9.5 20c1.3 0 2.5-.8 2.5-2V6a2.5 2.5 0 0 0-2.5-2z"/>' +
    '<path d="M14.5 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-1.5 5A3 3 0 0 1 14.5 20c-1.3 0-2.5-.8-2.5-2V6a2.5 2.5 0 0 1 2.5-2z"/>',
};

function iconSvg(name, size) {
  const inner = ICON_PATHS[name];
  if (!inner) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

// A larghezza fissa le voci lunghe (l'email dell'account) venivano ellissate:
// si stima il testo più lungo, fra un minimo e un massimo.
const MENU_MIN_W = 200;
const MENU_MAX_W = 340;
function computeMenuWidth(entries) {
  const H_PADDING = 28;   // padding orizzontale dell'item (14px * 2)
  const ICON_COL = 28;    // icona (18px) + gap (10px) quando presente
  let needed = MENU_MIN_W;
  for (const e of entries || []) {
    if (!e || e.type === 'separator') continue;
    const label = String(e.label || '');
    // Stima generosa (~0.6 * font-size per carattere): meglio larghi che troncati.
    const fontPx = e.disabled ? 12 : 13;
    const charW = fontPx * 0.6;
    const hasIcon = !!e.icon && ICON_PATHS[e.icon];
    const SUB_COL = e.subAction ? 30 : 0;
    const w = H_PADDING + (hasIcon ? ICON_COL : 0) + SUB_COL + Math.ceil(label.length * charW);
    if (w > needed) needed = w;
  }
  return Math.min(MENU_MAX_W, needed);
}

// ── Geometria ─────────────────────────────────────────────────────────────
const ITEM_H = 36;
const SEP_H = 9;
const PAD = 8;
// Gutter trasparente che contiene INTERA l'ombra CSS (0 4px 20px): più stretto, l'ombra finiva di colpo (feedback alpha).
const MARGIN = 26;

// Dove sta la finestra del menu, in coordinate schermo: il menu ancorato a `x`, il bordo alto ~6px sotto `y`.
function posizione(parentWin, entries, x, y) {
  const WIDTH = computeMenuWidth(entries);
  let contentH = PAD * 2;
  for (const e of entries) contentH += e && e.type === 'separator' ? SEP_H : ITEM_H;
  const WIN_W = WIDTH + MARGIN * 2;
  const WIN_H = contentH + MARGIN * 2;
  const cb = parentWin.getContentBounds();
  let popX = cb.x + x - MARGIN;
  let popY = cb.y + y + 6 - MARGIN;
  if (popX + WIN_W > cb.x + cb.width) popX = cb.x + cb.width - WIN_W;
  // Sotto non c'è posto (un tasto destro in fondo alla finestra, sugli avvisi): si apre sopra il punto.
  if (popY + WIN_H - MARGIN > cb.y + cb.height) {
    popY = Math.max(cb.y - MARGIN, cb.y + y - 6 - contentH - MARGIN);
  }
  return { x: Math.round(popX), y: Math.round(popY), width: WIN_W, height: WIN_H };
}

// ── La finestra, una per finestra madre ───────────────────────────────────
// Un blur entro questo tempo dalla comparsa può essere quello, in ritardo, della chiusura di prima (X11):
// conta solo se il fuoco non è tornato al menu.
const GRAZIA_BLUR_MS = 150;
// Se la pagina non conferma il vuoto disegnato, la finestra si nasconde lo stesso.
const TETTO_SVUOTA_MS = 120;

function statoDi(parent) {
  let s = stati.get(parent);
  if (!s) {
    s = { parent, win: null, pronta: false, attesa: null, aperto: false, giro: 0, scelta: null, richiesta: null, posa: null, mostratoAlle: 0, tetto: null, dopo: [] };
    stati.set(parent, s);
  }
  return s;
}

function invia(s, dati) {
  if (!s.win || s.win.isDestroyed()) return;
  if (!s.pronta) { s.attesa = dati; return; }
  try { s.win.webContents.send('popup-menu:voci', dati); } catch (_) {}
}

// Nasce nascosta col documento e il preload già caricati: all'apertura arrivano solo le voci.
function finestraDi(parent) {
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
    skipTaskbar: true,
    focusable: true,
    show: false,
    hasShadow: false,
    width: MENU_MIN_W + MARGIN * 2,
    height: 120,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload', 'popup-preload.js'),
      // Da nascosta risponde come da visibile: la prima comparsa non aspetta un processo messo in secondo piano.
      backgroundThrottling: false,
    },
  });
  s.win = win;
  s.pronta = false;
  s.attesa = null;
  // Nei test la finestra madre è invisibile: il menu è una finestra a sé e comparirebbe da solo (test-window-mode.js).
  hideForTests(win);
  const wc = win.webContents;
  // Il menu prende il fuoco: senza, le scorciatoie di Filo lì dentro morirebbero.
  collegaScorciatoie(wc, parent);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.once('did-finish-load', () => {
    if (s.win !== win) return;
    s.pronta = true;
    const d = s.attesa;
    s.attesa = null;
    if (d) invia(s, d);
  });
  wc.on('ipc-message', (_e, canale, a, b) => { if (s.win === win) dalMenu(s, canale, a, b); });
  // Un processo morto non risponde più: tenuta, la finestra lascerebbe la finestra madre senza menu fino al riavvio.
  // Si butta; il prossimo clic ne fa una nuova, e il menu che stava per comparire si riapre una volta sola.
  wc.on('render-process-gone', () => {
    if (s.win !== win) return;
    const r = s.aperto && !win.isVisible() && s.richiesta && !s.richiesta.ripresa ? s.richiesta : null;
    // Il menu che si riapre da solo è la stessa ricerca: né una chiusura a vuoto né una seconda apertura.
    const ricerca = r ? s.ricerca : null;
    if (r) s.ricerca = null;
    clearTimeout(s.tetto);
    s.win = null;
    s.pronta = false;
    s.attesa = null;
    chiudi(s);
    if (!win.isDestroyed()) win.destroy();
    if (r && !parent.isDestroyed()) apri(parent, { ...r, ripresa: true, ricerca });
  });
  win.on('blur', () => sfocato(s, win));
  win.on('closed', () => {
    if (s.win !== win) return;
    clearTimeout(s.tetto);
    s.win = null;
    s.pronta = false;
    s.attesa = null;
    chiudi(s);
  });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildHTML([], false)));
  return s;
}

function dalMenu(s, canale, a, b) {
  if (canale === 'popup-menu:pronto') {
    if (s.aperto && a === s.giro) mostra(s);
  } else if (canale === 'popup-menu:vuoto') {
    if (!s.aperto && a === s.giro) nascondi(s);
  } else if (canale === 'popup-menu:select') {
    // Una voce del menu di prima (cliccata mentre arrivava quello nuovo) non sceglie per lui.
    if (!s.aperto || b !== s.giro) return;
    const scelta = s.scelta;
    const ric = s.ricerca;
    if (ric && !ric.fatta) {
      ric.fatta = true;
      contaRicerca(s, 'scelta', { attesaMs: Date.now() - ric.t0, posizione: ric.posti.get(typeof a === 'string' ? a : '') || null });
    }
    // Prima si chiude: chi sceglie può riaprire subito il menu (il secondo livello di una voce a due zone).
    chiudi(s);
    if (scelta) { try { scelta(typeof a === 'string' ? a : ''); } catch (_) {} }
  } else if (canale === 'popup-menu:close') {
    if (s.aperto && a === s.giro) chiudi(s);
  }
}

function mostra(s) {
  const win = s.win;
  if (!win || win.isDestroyed() || !s.posa) return;
  clearTimeout(s.tetto);
  win.setBounds(s.posa);
  s.mostratoAlle = Date.now();
  win.show();
  try { win.webContents.focus(); } catch (_) {}
}

function nascondi(s) {
  clearTimeout(s.tetto);
  const win = s.win;
  if (win && !win.isDestroyed() && win.isVisible()) win.hide();
}

function chiudi(s) {
  if (!s.aperto) return;
  s.aperto = false;
  s.scelta = null;
  const ric = s.ricerca;
  s.ricerca = null;
  if (ric && !ric.fatta) contaRicerca(s, 'vuota');
  const n = ++s.giro;
  if (inVista === s) inVista = null;
  const win = s.win;
  if (win && !win.isDestroyed()) {
    // Si nasconde col vuoto già disegnato: nascosta col menu dentro, alla prossima comparsa lo rimostrerebbe per un istante.
    invia(s, { n, html: '' });
    clearTimeout(s.tetto);
    if (win.isVisible()) s.tetto = setTimeout(() => { if (!s.aperto && s.giro === n) nascondi(s); }, TETTO_SVUOTA_MS);
  }
  // Per ultimi: chi aspettava la chiusura può riaprire un menu, e non va svuotato.
  const dopo = s.dopo.splice(0);
  for (const fn of dopo) { try { fn(); } catch (_) {} }
}

function sfocato(s, win) {
  if (!s.aperto || s.win !== win) return;
  const giro = s.giro;
  const resta = GRAZIA_BLUR_MS - (Date.now() - s.mostratoAlle);
  if (resta <= 0) { chiudi(s); return; }
  setTimeout(() => {
    if (s.aperto && s.giro === giro && !win.isDestroyed() && win.isVisible() && !win.isFocused()) chiudi(s);
  }, resta);
}

// Ogni menu a comparsa è un pannello dove si cerca una voce (#1461): apertura, scelta con l'attesa e il posto della
// voce fra quelle che si possono scegliere, chiusura senza scelta. Una regola sola qui, per tutti i menu che ci passano.
function contaRicerca(s, esito, extra = {}) {
  try {
    const C = globalThis.SN_CONTATORI_MAIN;
    if (C && typeof C.ricerca === 'function') C.ricerca('menu', { esito, ...extra }, { incognito: !!(s.parent && s.parent._filoIncognito) });
  } catch (_) {}
}

// Il valore che ogni voce manda (lo stesso di vociHTML) e il suo posto, da 1; la freccia di una voce a due zone vale la voce.
function postiDelleVoci(entries) {
  const posti = new Map();
  let n = 0;
  for (const e of entries || []) {
    if (!e || e.type === 'separator' || e.disabled) continue;
    n += 1;
    const valore = e.action ? '@action:' + String(e.action) : String(e.url || '');
    if (!posti.has(valore)) posti.set(valore, n);
    if (e.subAction && !posti.has('@action:' + String(e.subAction))) posti.set('@action:' + String(e.subAction), n);
  }
  return posti;
}

// ── Mostra il menu ────────────────────────────────────────────────────────
function showPopupMenu(parentWin, entries, x, y, onSelect) {
  if (!parentWin || parentWin.isDestroyed()) return;
  const voci = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e === 'object');
  // Senza voci non c'è niente da mostrare: la pagina risponderebbe col vuoto e il menu resterebbe «aperto» senza comparire.
  if (!voci.length) return;
  apri(parentWin, { voci, x: Number(x) || 0, y: Number(y) || 0, scelta: typeof onSelect === 'function' ? onSelect : null, ripresa: false });
}

function apri(parentWin, r) {
  if (inVista && inVista.parent !== parentWin) chiudi(inVista);
  const s = finestraDi(parentWin);
  if (!s) return;
  if (s.aperto) chiudi(s);
  const { voci } = r;
  s.richiesta = r;
  s.posa = posizione(parentWin, voci, r.x, r.y);
  s.giro++;
  s.aperto = true;
  s.scelta = r.scelta;
  s.mostratoAlle = Date.now();
  inVista = s;
  if (r.ripresa && r.ricerca) s.ricerca = r.ricerca;
  else {
    s.ricerca = { t0: Date.now(), posti: postiDelleVoci(voci), fatta: false };
    contaRicerca(s, 'aperta');
  }
  // La finestra compare quando la pagina conferma le voci nuove (popup-menu:pronto), mai con quelle di prima.
  invia(s, { n: s.giro, html: vociHTML(voci), scuro: !!nativeTheme.shouldUseDarkColors, vars: require('./movimento').variabili() });
}

// La finestra madre è pronta: il menu nasce adesso, così il primo clic lo trova già caricato.
function preparaMenu(parentWin) {
  finestraDi(parentWin);
}

// Il menu aperto sopra questa finestra, se c'è: la carta di anteprima delle schede non gli si apre sotto.
function menuAperto(parentWin) {
  const s = parentWin ? stati.get(parentWin) : null;
  return s && s.aperto && s.win && !s.win.isDestroyed() ? s.win : null;
}

// `fn` alla chiusura del menu di questa finestra (subito, se non è aperto).
function quandoChiuso(parentWin, fn) {
  const s = parentWin ? stati.get(parentWin) : null;
  if (!s || !s.aperto) { fn(); return; }
  s.dopo.push(fn);
}

// ── Il documento ──────────────────────────────────────────────────────────
// Il menu prende la tastiera appena si apre: Esc lo chiude, le frecce scelgono la voce e Invio la esegue.
// Le voci arrivano dal main (popup-menu:voci); `giro` accompagna ogni scelta, così il main scarta quelle di un menu passato.
const SCRIPT_MENU = `(() => {
  const api = window.popupApi;
  let giro = 0;
  let i = -1;
  const voci = () => [...document.querySelectorAll('button.item')];
  const segna = (n) => {
    const v = voci();
    if (!v.length) return;
    i = n < 0 ? -1 : n % v.length;
    v.forEach((b, k) => b.classList.toggle('attiva', k === i));
    if (i >= 0) v[i].focus();
    else if (document.activeElement) document.activeElement.blur();
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-v]');
    if (b && api) api.select(b.dataset.v, giro);
  });
  document.addEventListener('mousemove', (e) => {
    const b = e.target.closest && e.target.closest('button.item');
    const k = b ? voci().indexOf(b) : -1;
    if (k !== i) segna(k);
  });
  document.addEventListener('keydown', (e) => {
    const n = voci().length;
    const passo = { ArrowDown: i + 1, ArrowUp: (i < 0 ? n : i) - 1 + n, Home: 0, End: n - 1 }[e.key];
    if (e.key === 'Escape') { if (api) api.close(giro); }
    else if (passo !== undefined) segna(passo);
    else if (e.key === 'ArrowRight' && i >= 0) {
      const sotto = voci()[i].parentElement.querySelector('.subarrow');
      if (!sotto) return;
      sotto.click();
    } else return;
    e.preventDefault();
  });
  if (!api || !api.onVoci) return;
  api.onVoci((d) => {
    giro = (d && Number(d.n)) || 0;
    i = -1;
    document.documentElement.classList.toggle('scuro', !!(d && d.scuro));
    for (const [k, v] of Object.entries((d && d.vars) || {})) {
      if (/^--sn-[a-z-]+$/.test(k) && /^[0-9.]+$/.test(String(v))) document.documentElement.style.setProperty(k, String(v));
    }
    const prima = document.querySelector('.menu');
    if (prima) prima.remove();
    if (d && d.html) {
      const m = document.createElement('div');
      m.className = 'menu';
      m.innerHTML = d.html;
      document.body.prepend(m);
      api.pronto(giro);
      return;
    }
    const n = giro;
    requestAnimationFrame(() => requestAnimationFrame(() => api.vuoto(n)));
  });
})();`;

const ESCAPE = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' };
const testoHTML = (v) => String(v == null ? '' : v).replace(/[<>&"']/g, (ch) => ESCAPE[ch]);

function vociHTML(entries) {
  let items = '';
  for (const e of entries || []) {
    if (!e) continue;
    if (e.type === 'separator') {
      items += '<div class="sep"></div>';
      continue;
    }
    const ico = iconSvg(e.icon, 16);
    // Niente colonna icona vuota: spingeva a destra le voci senza icona (l'email dell'account, feedback alpha).
    const icoSpan = ico ? `<span class="ico">${ico}</span>` : '';
    const label = testoHTML(e.label || '');
    if (e.disabled) {
      const cls = ico ? 'item disabled' : 'item disabled centered';
      items += `<div class="${cls}">${icoSpan}<span class="lbl">${label}</span></div>`;
      continue;
    }
    // `url` apre una scheda, `action` torna al chiamante: il prefisso le tiene distinte.
    const valore = e.action ? '@action:' + String(e.action) : String(e.url || '');
    const main = `<button class="item" data-v="${testoHTML(valore)}">${icoSpan}<span class="lbl">${label}</span></button>`;
    if (e.subAction) {
      // Voce a due zone: il corpo esegue `action`, la freccia manda `subAction` e il chiamante riapre col secondo livello.
      items += `<div class="row">${main}` +
        `<button class="subarrow" aria-label="Altre opzioni" data-v="${testoHTML('@action:' + String(e.subAction))}">` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" ` +
        `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
        `stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button></div>`;
    } else {
      items += main;
    }
  }
  return items;
}

function stile(margin) {
  return `*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:rgba(248,246,240,0.98);--fg:#1a1918;--muted:#6e6b63;--border:#e0dcd4;--sn-ombra:calc(var(--sn-shadow-opacity, 0.18) / 0.18)}
:root.scuro{--bg:rgba(30,29,27,0.98);--fg:#e5e3dc;--muted:#8a8780;--border:#3a3835}
html,body{background:transparent;overflow:hidden;height:100%}
.menu{
  margin:${margin}px;
  background:var(--bg);
  border:1px solid var(--border);
  border-radius:8px;
  box-shadow:0 4px 20px rgba(0,0,0,calc(0.20 * var(--sn-ombra, 1)));
  padding:4px 0;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  font-size:13px;
  color:var(--fg);
  backdrop-filter:blur(8px);
  animation:fadeIn calc(100ms * var(--sn-motion, 1)) ease-out;
}
@keyframes fadeIn{
  from{opacity:0;transform:translateY(-3px)}
  to{opacity:1;transform:translateY(0)}
}
.item{
  all:unset;box-sizing:border-box;
  display:flex;align-items:center;gap:10px;
  width:100%;padding:8px 14px;
  cursor:pointer;color:var(--fg);
  font-family:inherit;font-size:13px;line-height:1.2;
}
.item:hover,.item.attiva{background:rgba(196,90,59,0.12)}
.item.disabled{color:var(--muted);cursor:default;font-size:12px}
.item.disabled:hover{background:transparent}
.item.centered{justify-content:center;text-align:center}
.ico{
  width:18px;height:18px;flex:0 0 18px;
  display:inline-flex;align-items:center;justify-content:center;
  color:rgba(196,90,59,0.85);
}
.lbl{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item.centered .lbl{flex:0 1 auto}
.sep{height:1px;background:var(--border);margin:4px 8px}
.row{display:flex;align-items:stretch}
.row .item{flex:1;min-width:0}
.subarrow{
  all:unset;box-sizing:border-box;
  display:inline-flex;align-items:center;justify-content:center;
  flex:0 0 30px;cursor:pointer;color:var(--muted);
}
.subarrow:hover{background:rgba(196,90,59,0.12);color:rgba(196,90,59,0.95)}`;
}

// Lo stesso documento della finestra riusata, già con le voci: lo usano gli spec che ne misurano il layout.
function buildHTML(entries, isDark, margin = MARGIN) {
  const voci = entries && entries.length ? `<div class="menu">${vociHTML(entries)}</div>` : '';
  return `<!DOCTYPE html><html${isDark ? ' class="scuro"' : ''}><head><meta charset="utf-8"><style>${stile(margin)}</style></head>` +
    `<body>${voci}<script>${SCRIPT_MENU}</script></body></html>`;
}

module.exports = { showPopupMenu, preparaMenu, buildHTML, computeMenuWidth, menuAperto, quandoChiuso };
