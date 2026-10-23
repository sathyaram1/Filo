// L'email dell'account Filo proposta sotto un campo di accesso di un sito (#1124), in una vista sopra la scheda: la
// pagina non la legge e non la preme. L'email va al frame del campo solo alla scelta (clic, Invio, tasto destro).
// Regole: patterns/una-conferma-su-un-sito-sta-fuori-dal-suo-documento.md

const path = require('node:path');
const { BrowserWindow, webContents: WebContents } = require('electron');
const { collegaScorciatoie } = require('./shortcuts');
require('../shared/campoAccesso.js');

const C = globalThis.SN_CAMPO_ACCESSO;
// Un clic vale quando la proposta è ferma sotto il campo da mezzo secondo: la pagina può farla comparire sotto il cursore.
const ARMA_MS = 500;
// Il campo che perde il fuoco perché l'utente preme la proposta non la chiude.
const TOCCO_MS = 600;
const LARGHEZZA_MIN = 240;
const LARGHEZZA_MAX = 480;
const MARGINE = 4;
const STACCO = 2;
const CAMPO = /^[0-9a-f]{32}$/;
// Riquadri di un'altra origine uno dentro l'altro: oltre questo non si risale.
const ANELLI_MAX = 8;
// `clic` e `scrive` arrivano solo da un gesto vero dell'utente sul campo; `input` può averlo mosso la pagina.
const MOTIVI = new Set(['focus', 'clic', 'scrive', 'input', 'posto']);
const RIEMPI = () => (globalThis.SN_MSG && globalThis.SN_MSG.MSG.PROPOSTA_EMAIL_RIEMPI) || 'proposta_email_riempi';

const testo = (v) => (typeof v === 'string' ? v : '');
const coord = (v) => Math.max(-10000, Math.min(10000, Math.round(Number(v) || 0)));
const misura = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const numero = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 50000;

function emailAccount() {
  try {
    const auth = require('./auth/google-auth');
    if (!auth.isSignedIn()) return '';
    const p = auth.getProfile();
    const e = p && typeof p.email === 'string' ? p.email.trim() : '';
    return e.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(e) ? e : '';
  } catch (_) { return ''; }
}

function opzioni(s) {
  const p = (s && s.propostaEmail) || {};
  return { attiva: p.attiva !== false, incognito: p.incognito === true };
}

function origineDi(frame) {
  try { return String(frame.origin || ''); } catch (_) { return ''; }
}

function frameVivo(frame) {
  try { return !!frame && !frame.isDestroyed() && !frame.detached; } catch (_) { return false; }
}

function stessoFrame(frame, pid, rid) {
  try { return frame.processId === pid && frame.routingId === rid; } catch (_) { return true; }
}

// La posizione di un riquadro la dà solo un documento che contiene il frame del campo: sopra di lui c'è la sua pagina.
function antenato(a, frame) {
  try {
    let p = frame.parent;
    for (let i = 0; p && i < 32; i++, p = p.parent) if (p.processId === a.pid && p.routingId === a.rid) return true;
  } catch (_) {}
  return false;
}

const istanze = new Set();

class PropostaEmail {
  // area(wc): dove sta nella finestra la pagina di `wc` se è quella che l'utente vede, se no null.
  // restituisci(wc): la tastiera torna alla pagina. sotto(): le viste che devono starle sotto (schede, avvisi);
  // dopoInCima: chi deve restarle sopra (la conferma, la barra laterale) ci risale.
  constructor(win, { area = () => null, restituisci = () => {}, sotto = () => [], dopoInCima = () => {} } = {}) {
    this.win = win;
    this.area = area;
    this.restituisci = restituisci;
    this.sotto = sotto;
    this.dopoInCima = dopoInCima;
    this.vista = null;
    this.pronta = false;
    this.c = null;
    this.mostrata = false;
    this.giro = 0;
    this.inviato = '';
    this.misurato = 0;
    this.taglia = { w: 0, h: 0 };
    this.toccataA = 0;
    this.menuPer = null;
    this.ingoiati = new Set();
    this.seguite = new WeakSet();
    // Per istanza del content script, l'ultimo messaggio visto: uno arrivato in ritardo non riapre un campo lasciato.
    this.numeri = new Map();
    // Per segno: dove sta, nel documento sopra, il riquadro di un'altra origine che contiene il campo.
    this.ancore = new Map();
    istanze.add(this);
    if (win && typeof win.once === 'function') win.once('closed', () => { istanze.delete(this); this._butta(); });
  }

  _vecchio(d) {
    const k = testo(d.istanza);
    if (!k || !d.n) return false;
    if ((this.numeri.get(k) || 0) >= d.n) return true;
    this.numeri.delete(k);
    this.numeri.set(k, d.n);
    if (this.numeri.size > 64) this.numeri.delete(this.numeri.keys().next().value);
    return false;
  }

  _suo(wc, frame, campo) {
    const c = this.c;
    return !!c && c.wc === wc && c.frame === frame && c.campo === campo;
  }

  campo(wc, frame, d, { email, tema, incognito = false }) {
    if (this._vecchio(d)) return;
    if (!this._suo(wc, frame, d.campo)) {
      this.c = { wc, frame, origine: origineDi(frame), campo: d.campo, chiusa: false, evidenziata: false, armataDa: 0, incognito };
      this._segui(wc);
    }
    const c = this.c;
    // Dopo Esc la ripropongono il rientro nel campo, un clic sul campo e lo scrivere dell'utente, come in Chrome.
    if ((d.motivo === 'focus' && !this._toccata()) || d.motivo === 'clic' || d.motivo === 'scrive') c.chiusa = false;
    // Chi scrive dopo aver evidenziato con la freccia vuole il suo testo: il prossimo Invio è della pagina.
    if (d.motivo === 'input' || d.motivo === 'scrive') c.evidenziata = false;
    Object.assign(c, { x: d.x, y: d.y, w: d.w, h: d.h, ancora: d.ancora, valore: d.valore, digitato: d.digitato, email, lasciato: false });
    this.tema = tema;
    this.posa();
  }

  riquadro(wc, frame, d) {
    if (this._vecchio(d)) return;
    let pid = 0; let rid = 0;
    try { pid = frame.processId; rid = frame.routingId; } catch (_) { return; }
    this.ancore.delete(d.ancora);
    this.ancore.set(d.ancora, { wc, pid, rid, x: d.x, y: d.y, s: d.s, su: d.su });
    if (this.ancore.size > 32) this.ancore.delete(this.ancore.keys().next().value);
    if (this.c && this.c.wc === wc) this.posa();
  }

  // Il campo in px CSS della scheda: dentro riquadri di un'altra origine, sommando le loro posizioni. null finché
  // un anello non è arrivato, o se lo dà un documento che non contiene il campo.
  _campo(c) {
    let r = { x: c.x, y: c.y, w: c.w, h: c.h };
    let segno = c.ancora;
    for (let i = 0; segno; i++) {
      const a = this.ancore.get(segno);
      if (i >= ANELLI_MAX || !a || a.wc !== c.wc || !(a.s > 0) || !antenato(a, c.frame)) return null;
      r = { x: a.x + r.x * a.s, y: a.y + r.y * a.s, w: r.w * a.s, h: r.h * a.s };
      segno = a.su;
    }
    return r;
  }

  // Il campo ha perso il fuoco. Se l'ha preso la proposta (un clic, il suo tasto destro) si aspetta che torni.
  via(wc, frame, d, { subito = false } = {}) {
    if (!subito && this._vecchio(d)) return;
    if (!this._suo(wc, frame, d.campo)) return;
    const c = this.c;
    if (!subito && this._toccata()) {
      c.lasciato = true;
      setTimeout(() => { if (this.c === c && c.lasciato && !this._toccata()) this.fine(); }, TOCCO_MS);
      return;
    }
    this.fine();
  }

  _toccata() {
    if (Date.now() - this.toccataA < TOCCO_MS) return true;
    if (this.menuPer && this.menuPer === this.c) return true;
    try { return !!this.vista && WebContents.getFocusedWebContents() === this.vista.webContents; } catch (_) { return false; }
  }

  fine() {
    this.c = null;
    this._nascondi();
  }

  inCima() {
    if (this.mostrata) this._inCima();
  }

  // Chiamata a ogni misura del campo e dal layout delle schede (scheda cambiata, finestra ridimensionata).
  posa() {
    const c = this.c;
    if (!c) { this._nascondi(); return; }
    if (c.wc.isDestroyed()) { this.fine(); return; }
    // L'account di adesso, non quello di quando il campo ha parlato: tornando alla scheda può essere cambiato.
    c.email = emailAccount();
    let a = null;
    if (!c.chiusa && C.daProporre(c.valore, c.email, c.digitato)) {
      try { a = this.area(c.wc); } catch (_) { a = null; }
    }
    const b = a ? this._dove(a, c) : null;
    if (!b) { this._nascondi(); return; }
    this._mostra(b);
  }

  // Sotto il campo, largo almeno quanto lui; sopra se sotto non c'è posto. Fuori dall'area della pagina, niente.
  _dove(a, c) {
    const m = this._campo(c);
    if (!m || !(m.w > 0 && m.h > 0)) return null;
    let z = 1;
    try { z = c.wc.getZoomFactor() || 1; } catch (_) { z = 1; }
    const fx = a.x + m.x * z; const fy = a.y + m.y * z; const fw = m.w * z; const fh = m.h * z;
    if (fy + fh <= a.y || fy >= a.y + a.height || fx + fw <= a.x || fx >= a.x + a.width) return null;
    const spazio = a.width - 2 * MARGINE;
    if (spazio < 80) return null;
    const width = Math.round(Math.min(Math.max(fw, Math.min(this.taglia.w, LARGHEZZA_MAX), LARGHEZZA_MIN), spazio));
    const height = Math.max(1, this.taglia.h || 44);
    const x = Math.round(Math.min(Math.max(fx, a.x + MARGINE), a.x + a.width - MARGINE - width));
    let y = Math.round(fy + fh + STACCO);
    if (y + height > a.y + a.height) {
      const su = Math.round(fy - STACCO - height);
      y = su >= a.y ? su : Math.max(a.y, a.y + a.height - height);
    }
    return { x, y, width, height };
  }

  _stato() {
    const c = this.c;
    return { email: c.email, evidenziata: !!c.evidenziata, tema: this.tema || { theme: 'system', tokens: {} } };
  }

  _mostra(b) {
    const vista = this._vista();
    if (!vista) return;
    const c = this.c;
    const s = this._stato();
    const chiave = JSON.stringify(s);
    if (chiave !== this.inviato && this.pronta) {
      this.inviato = chiave;
      this.giro++;
      try { vista.webContents.send('proposta-email:stato', { ...s, giro: this.giro }); } catch (_) {}
    }
    // Compare quando la sua pagina ha disegnato lo stato di adesso e ne ha dato la misura.
    if (!this.pronta || this.misurato !== this.giro) return;
    const prima = this.bounds;
    vista.setBounds(b);
    this.bounds = b;
    this._inCima();
    if (!this.mostrata) {
      vista.setVisible(true);
      this.mostrata = true;
      c.armataDa = Date.now();
    } else if (prima && (Math.abs(prima.x - b.x) > 4 || Math.abs(prima.y - b.y) > 4)) {
      c.armataDa = Date.now();
    }
  }

  _nascondi() {
    this.mostrata = false;
    this.bounds = null;
    if (this.c) this.c.evidenziata = false;
    const vista = this.vista;
    if (!vista || vista.webContents.isDestroyed()) return;
    vista.setVisible(false);
    vista.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }

  _evidenzia(on) {
    if (!this.c || this.c.evidenziata === on) return;
    this.c.evidenziata = on;
    this.posa();
  }

  // I tasti della pagina passano di qui prima del documento: con la proposta a schermo frecce, Invio ed Esc sono suoi.
  tasto(wc, input) {
    if (!input) return false;
    const k = String(input.key || '');
    if (input.type === 'keyUp') return this.ingoiati.delete(k);
    if (input.type !== 'keyDown' || !this.mostrata || !this.c || this.c.wc !== wc) return false;
    if (k === 'Tab') { this.c.chiusa = true; this.posa(); return false; }
    if (input.control || input.alt || input.meta || input.shift) return false;
    if (k === 'ArrowDown') this._evidenzia(true);
    else if (k === 'ArrowUp' && this.c.evidenziata) this._evidenzia(false);
    else if (k === 'Enter' && this.c.evidenziata) this._scegli('tastiera');
    else if (k === 'Escape') { this.c.chiusa = true; this.posa(); } else return false;
    this.ingoiati.add(k);
    return true;
  }

  _scegli(come, giro) {
    const c = this.c;
    if (!c || !this.mostrata) return;
    if (giro !== undefined && giro !== this.giro) return;
    if (come === 'clic' && Date.now() - c.armataDa < ARMA_MS) return;
    const email = emailAccount();
    if (!email || email !== c.email) { this.fine(); return; }
    if (!frameVivo(c.frame) || origineDi(c.frame) !== c.origine) { this.fine(); return; }
    try { c.frame.send('filo:broadcast', { type: RIEMPI(), campo: c.campo, email }); } catch (_) { this.fine(); return; }
    c.valore = email;
    c.digitato = true;
    this.posa();
    try { this.restituisci(c.wc); } catch (_) {}
  }

  _menu(d) {
    const c = this.c;
    if (!c || !this.mostrata || !this.vista || Number(d && d.giro) !== this.giro) return;
    const b = this.vista.getBounds();
    const Menu = require('./popup-menu');
    this.menuPer = c;
    Menu.showPopupMenu(this.win, [
      { label: 'Inserisci l\'email', icon: 'user', action: 'proposta-email:inserisci' },
      { label: 'Non propormela più', icon: 'close', action: 'proposta-email:spegni' },
    ], b.x + coord(d.x), b.y + coord(d.y), (scelta) => {
      this.menuPer = null;
      if (scelta === '@action:proposta-email:inserisci' && this.c === c) this._scegli('menu');
      else if (scelta === '@action:proposta-email:spegni') spegni(this.win);
    });
    Menu.quandoChiuso(this.win, () => {
      if (this.menuPer !== c) return;
      this.menuPer = null;
      if (this.c === c) { try { this.restituisci(c.wc); } catch (_) {} }
    });
  }

  // Sale solo se qualcosa che le sta sotto le è passato sopra: a ogni misura del campo non rimescola le viste.
  _inCima() {
    const cv = this.win.contentView;
    const figli = cv.children || [];
    const mia = figli.indexOf(this.vista);
    let sotto = [];
    try { sotto = this.sotto() || []; } catch (_) { sotto = []; }
    if (mia >= 0 && !figli.slice(mia + 1).some((v) => sotto.includes(v))) return;
    cv.addChildView(this.vista);
    try { this.dopoInCima(); } catch (_) {}
  }

  // Un documento nuovo, una scheda chiusa o un renderer morto portano via la proposta del loro campo.
  _segui(wc) {
    if (this.seguite.has(wc)) return;
    this.seguite.add(wc);
    const via = (filtro) => { if (this.c && this.c.wc === wc && filtro(this.c)) this.fine(); };
    wc.once('destroyed', () => via(() => true));
    wc.on('render-process-gone', () => via(() => true));
    wc.on('did-frame-navigate', (_e, _url, _codice, _stato, principale, pid, rid) => {
      via((c) => principale || stessoFrame(c.frame, pid, rid));
    });
  }

  _vista() {
    if (this.vista && !this.vista.webContents.isDestroyed()) return this.vista;
    if (!this.win || this.win.isDestroyed()) return null;
    const { WebContentsView } = require('electron');
    const vista = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'proposta-email-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    vista.setBackgroundColor('#00000000');
    vista.setVisible(false);
    vista.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    this.vista = vista;
    this.pronta = false;
    this.inviato = '';
    this.misurato = 0;
    const wc = vista.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    // La tastiera non è sua: il clic gliela dà, e torna al campo al giro dopo (durante l'evento risulta ancora suo).
    wc.on('focus', () => {
      this.toccataA = Date.now();
      setTimeout(() => { if (this.c) { try { this.restituisci(this.c.wc); } catch (_) {} } }, 0);
    });
    collegaScorciatoie(wc, this.win);
    wc.on('ipc-message', (_e, canale, dati) => {
      if (canale === 'proposta-email:misura') {
        if (Number(dati && dati.giro) !== this.giro) return;
        this.taglia = { w: misura(dati.w, 2000), h: misura(dati.h, 400) };
        this.misurato = this.giro;
        this.posa();
      } else if (canale === 'proposta-email:scegli') {
        this.toccataA = Date.now();
        this._scegli('clic', Number(dati && dati.giro));
      } else if (canale === 'proposta-email:menu') {
        this.toccataA = Date.now();
        this._menu(dati);
      }
    });
    wc.once('did-finish-load', () => { this.pronta = true; this.posa(); });
    wc.on('render-process-gone', () => { this._butta(); this.posa(); });
    // Carica FUORI dalla finestra (ci entra alla prima posa): dentro si prenderebbe la tastiera di chi scrive.
    wc.loadURL('filo://shell/proposta-email.html');
    return vista;
  }

  _butta() {
    const vista = this.vista;
    this.vista = null;
    this.pronta = false;
    this.mostrata = false;
    if (!vista) return;
    try { if (this.win && !this.win.isDestroyed()) this.win.contentView.removeChildView(vista); } catch (_) {}
    try { if (!vista.webContents.isDestroyed()) vista.webContents.close(); } catch (_) {}
  }
}

// La finestra con la barra a cui dire «fatto»: un popup di accesso non ne ha una sua.
function finestraConLaBarra(win) {
  if (win && !win.isDestroyed() && win._filoTabs) return win;
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w._filoTabs) || null;
}

// «Non propormela più» è un gesto della persona (via `interfaccia`); in incognito resta all'incognito.
function spegni(win) {
  try {
    const { applySettingsUpdate } = require('./services/handlers');
    const scrivi = () => require('./services/registroCambi').con({ via: 'interfaccia' }, () => applySettingsUpdate({ propostaEmail: { attiva: false } }));
    Promise.resolve(win && win._filoIncognito ? require('./shim/storage').runIncognito(scrivi) : scrivi()).catch(() => {});
  } catch (_) {}
  const w = finestraConLaBarra(win);
  if (!w) return;
  try {
    w.webContents.send('shell:toast', {
      text: 'Non ti propongo più la tua email nei siti. La riaccendi in Preferenze, nelle impostazioni avanzate.',
      opts: { durationSec: 8, key: 'proposta-email', tipo: 'proposta_email_spenta' },
    });
  } catch (_) {}
}

// La proposta di una pagina sta sopra la sua scheda; in un popup di accesso, che è una finestra vera con dentro un
// sito, sopra la finestra. Altrove niente.
const perPopup = new WeakMap();
function propostaDi(wc, { crea = false } = {}) {
  for (const w of BrowserWindow.getAllWindows()) {
    const tm = w._filoTabs;
    if (tm && tm.propostaEmail && tm.tabs.some((t) => t.view && t.view.webContents === wc)) return tm.propostaEmail;
  }
  const win = BrowserWindow.fromWebContents(wc);
  if (!win || win.isDestroyed() || win._filoTabs || win.webContents !== wc) return null;
  let p = perPopup.get(win);
  if (!p && crea) {
    p = new PropostaEmail(win, {
      area: (x) => {
        if (x !== win.webContents || win.isDestroyed()) return null;
        const [width, height] = win.getContentSize();
        return { x: 0, y: 0, width, height };
      },
      restituisci: () => { try { if (win.isFocused()) win.webContents.focus(); } catch (_) {} },
    });
    perPopup.set(win, p);
    win.on('resize', () => p.posa());
    wc.on('before-input-event', (e, input) => { if (p.tasto(wc, input)) e.preventDefault(); });
  }
  return p || null;
}

// Si propone su una pagina web http(s), con l'interruttore acceso, e in incognito solo se l'utente l'ha chiesto.
function ammessa(sender, s) {
  const o = opzioni(s);
  if (!o.attiva) return false;
  let url = '';
  try { url = String(sender.frame.url || ''); } catch (_) { url = ''; }
  if (!/^https?:\/\//i.test(url) || String(sender.url || '').startsWith('filo:')) return false;
  return !inIncognito(sender) || o.incognito;
}

// Una scheda in incognito sta in una finestra in incognito; un popup di accesso aperto da lei, nella sua sessione.
// Non basta una sessione effimera: in Privacy ogni sito non fidato ne ha una sua.
function inIncognito(sender) {
  if (sender.isIncognito) return true;
  try {
    const { session } = require('electron');
    const ses = sender.wc && sender.wc.session;
    return !!ses && BrowserWindow.getAllWindows().some((w) => w._filoIncognito && w._filoTabs && w._filoTabs.partition
      && session.fromPartition(w._filoTabs.partition) === ses);
  } catch (_) { return false; }
}

function pulisci(msg) {
  const ancora = testo(msg.ancora);
  if (msg.fase === 'riquadro') {
    if (!CAMPO.test(ancora) || ![msg.x, msg.y, msg.s].every(numero) || (msg.su && !CAMPO.test(testo(msg.su)))) return null;
    return {
      istanza: testo(msg.istanza).slice(0, 64), n: Number.isSafeInteger(msg.n) && msg.n > 0 ? msg.n : 0,
      ancora, x: msg.x, y: msg.y, s: Math.max(0, msg.s), su: testo(msg.su),
    };
  }
  if (ancora && !CAMPO.test(ancora)) return null;
  const campo = testo(msg.campo);
  if (!CAMPO.test(campo)) return null;
  const d = { campo, istanza: testo(msg.istanza).slice(0, 64), n: Number.isSafeInteger(msg.n) && msg.n > 0 ? msg.n : 0 };
  if (msg.fase === 'via') return d;
  if (!MOTIVI.has(msg.motivo) || ![msg.x, msg.y, msg.w, msg.h].every(numero) || typeof msg.valore !== 'string') return null;
  return {
    ...d, ancora, motivo: msg.motivo, x: msg.x, y: msg.y, w: Math.max(0, msg.w), h: Math.max(0, msg.h),
    valore: msg.valore.slice(0, C.VALORE_MAX + 1), digitato: msg.digitato === true,
  };
}

function temaDi(s) {
  return {
    theme: s && typeof s.theme === 'string' ? s.theme : 'system',
    tokens: s && s.themeTokens && typeof s.themeTokens === 'object' ? s.themeTokens : {},
  };
}

// Dal content script di un sito: la risposta dice solo se seguire il campo, mai con che email.
async function daContenuto(msg, sender) {
  const wc = sender && sender.wc;
  const frame = sender && sender.frame;
  if (!msg || !wc || !frame || wc.isDestroyed()) return { ok: false };
  const d = pulisci(msg);
  if (!d) return { ok: false };
  if (msg.fase === 'riquadro') {
    const p = propostaDi(wc, { crea: true });
    if (p) p.riquadro(wc, frame, d);
    return { ok: true };
  }
  if (msg.fase === 'via') {
    const p = propostaDi(wc);
    if (p) p.via(wc, frame, d);
    return { ok: true };
  }
  let s = null;
  try { s = (await globalThis.SN_STORAGE.getSettings()) || {}; } catch (_) { s = {}; }
  const email = emailAccount();
  const si = !!email && ammessa(sender, s);
  const p = propostaDi(wc, { crea: si });
  if (!si || !p) {
    if (p) p.via(wc, frame, d, { subito: true });
    return { ok: true, segui: false };
  }
  p.campo(wc, frame, d, { email, tema: temaDi(s), incognito: inIncognito(sender) });
  return { ok: true, segui: true };
}

// Una proposta a schermo segue le impostazioni di adesso, da dovunque cambino: spenta (anche solo in incognito) va
// via, col tema nuovo si ridisegna.
function impostazioni(merged) {
  const o = opzioni(merged);
  for (const p of istanze) {
    if (!o.attiva || (p.c && p.c.incognito && !o.incognito)) { p.fine(); continue; }
    p.tema = temaDi(merged);
    if (p.c) p.posa();
  }
}

module.exports = { PropostaEmail, daContenuto, impostazioni, _test: { opzioni, ammessa, pulisci, ARMA_MS } };
