// Lo strato del menu del tasto destro (#1053): una vista trasparente per finestra, posata sopra la scheda attiva, dove
// il menu si disegna fuori dal documento del sito (#1054). Nasce una volta e resta pronta e nascosta; spenta di serie.
// Regole: patterns/il-menu-del-tasto-destro-sta-in-uno-strato-sopra-la-scheda.md

const path = require('node:path');
const { webContents: WebContents } = require('electron');
const { collegaScorciatoie } = require('./shortcuts');

// Il passo 4 di #1053 lo accende per tutti; fino ad allora solo le prove (FILO_STRATO_MENU=1).
const ACCESO_DI_SERIE = false;
function acceso() {
  return ACCESO_DI_SERIE || process.env.FILO_STRATO_MENU === '1';
}

const INDIRIZZO = 'filo://menu/';

// Il content script descrive il menu dopo il `context-menu` (aspetta la cronologia e la navigazione, o rigioca il clic
// in un riquadro appena montato): oltre questo tempo dal tasto destro un menu non si apre più.
const DOPO_IL_CLIC_MS = 5000;
// Un menu descritto prima che il `context-menu` arrivi lo aspetta così.
const PRIMA_DEL_CLIC_MS = 1000;
// Una voce dello strato vale solo dopo un gesto dell'utente sullo strato stesso, visto qui.
const GESTO_MS = 5000;
// Abbondanti: le icone sono SVG, una spiegazione lunga è qualche decina di KB.
const MENU_MAX_BYTE = 8 * 1024 * 1024;
const AGGIORNA_MAX_BYTE = 4 * 1024 * 1024;
const ID_MAX = 80;
// Quanto un menu aspetta lo strato che finisce di caricare, appena aperta la finestra.
const PRONTA_MS = 5000;
// Il contagocce aspetta che l'utente scelga un punto dello schermo: il clic che lo chiude non arriva allo strato.
const CONTAGOCCE_MS = 120000;

const msg = () => (globalThis.SN_MSG && globalThis.SN_MSG.MSG) || {};

function pesa(v) {
  try { return JSON.stringify(v).length; } catch (_) { return Infinity; }
}

function nodoDi(frame) {
  try { return frame && !frame.detached ? frame.frameTreeNodeId : null; } catch (_) { return null; }
}

function idValido(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= ID_MAX;
}

function interi(a) {
  return Array.isArray(a) && a.length <= 64 && a.every((i) => Number.isInteger(i) && i >= 0) ? a : null;
}

// Le richieste dello strato per la cronologia e gli appunti passano dalle stesse porte di Filo, come una sua pagina.
async function comeFilo(win, wc, richiesta, scheda = null) {
  const { handleMessage } = require('./services/handlers');
  const info = {
    tab: scheda, url: scheda ? scheda.url : INDIRIZZO, isShell: false, win,
    isIncognito: !!(win && win._filoIncognito), wc: scheda ? scheda.wc : wc, frame: null,
  };
  const run = () => require('./services/registroCambi').con({ via: 'interfaccia', dove: 'menu' }, () => handleMessage(richiesta, info));
  try {
    return info.isIncognito ? await require('./shim/storage').runIncognito(run) : await run();
  } catch (_) { return null; }
}

function stessaArea(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// Il punto arriva dal `context-menu` della scheda: px della vista (DIP), già fuori da zoom e riquadri. Mai dalla
// posizione del cursore sullo schermo, che su Wayland non si sa.
function puntoNellArea(punto, area) {
  const x = punto ? punto.x : undefined;
  const y = punto ? punto.y : undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !area) return null;
  return {
    x: Math.min(Math.max(0, Math.round(x)), Math.max(0, area.width - 1)),
    y: Math.min(Math.max(0, Math.round(y)), Math.max(0, area.height - 1)),
  };
}

class StratoDelMenu {
  // schedaAttiva(): il webContents della scheda davanti; area(): dove sta nella finestra, null se non si vede.
  // scheda(wc): { id, url } della scheda di quel webContents; barra(): la barra laterale della finestra.
  constructor(win, { schedaAttiva = () => null, area = () => null, scheda = () => null, barra = () => null } = {}) {
    this.win = win;
    this.schedaAttiva = schedaAttiva;
    this.area = area;
    this.scheda = scheda;
    this.barra = barra;
    this.vista = null;
    this.pronta = false;
    this.aperto = null; // { wc, punto, area, seq }
    this.seq = 0;
    this.seguite = new WeakSet();
    this.clic = null; // l'ultimo tasto destro: { wc, punto, nodo, alle }
    this.inArrivo = null; // un menu descritto prima del suo tasto destro
    this.menu = null; // il menu disegnato: { id, wc, frame, nodo, cronologia, pronto, coda }
    this.gestoAlle = 0;
    this.clicAlle = 0;
    if (!acceso() || !win || typeof win.once !== 'function') return;
    win.once('closed', () => this._butta());
    // Lo schermo intero cambia tutto quello che c'è sotto, anche quando lo chiede il sistema.
    win.on('enter-full-screen', () => this.nascondi());
    win.on('leave-full-screen', () => this.nascondi());
    // Come un menu del sistema: passando a un'altra finestra non resta aperto.
    win.on('blur', () => this.nascondi());
    const shell = win.webContents;
    if (shell && typeof shell.on === 'function') {
      shell.on('input-event', (_e, input) => { if (input && input.type === 'mouseDown') this.nascondi(); });
      shell.on('before-input-event', (e, input) => { if (this.tasto(input)) e.preventDefault(); });
    }
    // Dopo la shell: all'avvio non le contende il caricamento.
    if (shell && typeof shell.once === 'function' && shell.isLoading()) shell.once('did-finish-load', () => this._vista());
    else setImmediate(() => this._vista());
  }

  get acceso() { return acceso(); }

  // Il `context-menu` della scheda: il punto e il riquadro del tasto destro. Il menu si apre quando arriva la sua
  // descrizione dal content script di quel riquadro.
  segnaClic(wc, params) {
    if (!acceso() || !wc || !params) return;
    this.clic = { wc, punto: { x: params.x, y: params.y }, nodo: nodoDi(params.frame), alle: Date.now() };
    const a = this.inArrivo;
    if (a && a.wc === wc && a.nodo === this.clic.nodo && Date.now() - a.alle < PRIMA_DEL_CLIC_MS) {
      this.inArrivo = null;
      this._apri(a);
    }
  }

  // STRATO_MENU_APRI: solo dal riquadro dell'ultimo tasto destro, e da poco. Un sito non apre il menu da sé.
  apriDa(sender, d) {
    const wc = sender && sender.wc;
    const frame = sender && sender.frame;
    const nodo = nodoDi(frame);
    if (!acceso() || !wc || nodo == null || !d || !idValido(d.id)) return { ok: false };
    const menu = d.menu;
    if (!menu || !Array.isArray(menu.items) || pesa(menu) > MENU_MAX_BYTE) return { ok: false, error: 'menu' };
    const richiesta = { wc, frame, nodo, id: d.id, menu: { items: menu.items, keepOnScroll: !!menu.keepOnScroll }, coda: [], alle: Date.now() };
    const c = this.clic;
    if (c && c.wc === wc && c.nodo === nodo && Date.now() - c.alle < DOPO_IL_CLIC_MS) {
      this._apri(richiesta);
      return { ok: true };
    }
    this.inArrivo = richiesta;
    setTimeout(() => {
      if (this.inArrivo !== richiesta) return;
      this.inArrivo = null;
      this._alContent(richiesta, { type: msg().STRATO_MENU_CHIUSO, id: richiesta.id });
    }, PRIMA_DEL_CLIC_MS).unref?.();
    return { ok: true, attesa: true };
  }

  // Le voci che cambiano a menu aperto: solo per il menu che quel riquadro ha aperto.
  aggiornaDa(sender, d) {
    if (!d || !idValido(d.id) || pesa(d) > AGGIORNA_MAX_BYTE) return { ok: false };
    const cosa = String(d.cosa || '');
    if (!['riga', 'griglia', 'griglia-apri', 'correzione', 'inline', 'fuori'].includes(cosa)) return { ok: false };
    const { type: _t, ...dati } = d;
    // L'icona dalla barra arriva in px della pagina: lo strato, a zoom 1, li vuole della vista.
    if (cosa === 'fuori') {
      let zoom = 1;
      try { zoom = (sender && sender.wc && sender.wc.getZoomFactor()) || 1; } catch (_) { zoom = 1; }
      dati.x = (Number(dati.x) || 0) * zoom;
      dati.y = (Number(dati.y) || 0) * zoom;
    }
    const di = (r) => r && r.id === d.id && r.wc === (sender && sender.wc) && r.nodo === nodoDi(sender && sender.frame);
    if (di(this.inArrivo)) { this.inArrivo.coda.push(dati); return { ok: true }; }
    const m = this.menu;
    if (!di(m)) return { ok: false };
    if (!m.pronto) m.coda.push(dati);
    else this._alloStrato('strato:aggiorna', dati);
    return { ok: true };
  }

  chiudiDa(sender, d) {
    if (this.inArrivo && d && this.inArrivo.id === d.id && this.inArrivo.wc === (sender && sender.wc)) this.inArrivo = null;
    const m = this.menu;
    if (!m || !d || m.id !== d.id || m.wc !== (sender && sender.wc) || m.nodo !== nodoDi(sender && sender.frame)) return { ok: false };
    this.nascondi();
    return { ok: true };
  }

  async _apri(r) {
    const c = this.clic;
    if (!c || c.wc !== r.wc) { this._alContent(r, { type: msg().STRATO_MENU_CHIUSO, id: r.id }); return; }
    this.clic = null;
    if (this.menu) this.nascondi();
    const m = { id: r.id, wc: r.wc, frame: r.frame, nodo: r.nodo, cronologia: null, pronto: false, coda: r.coda };
    this.menu = m;
    const conIncolla = r.menu.items.some((it) => it && it.$incolla === true);
    // Un tasto destro appena aperto Filo trova lo strato ancora in caricamento: lo aspetta, non perde il menu.
    const [impostazioni, cronologia] = await Promise.all([
      require('./services/handlers').getEffectiveSettings().catch(() => null),
      conIncolla ? comeFilo(this.win, null, { type: msg().GET_CLIPBOARD_HISTORY }) : null,
      this._pronta(),
    ]);
    if (this.menu !== m) return;
    m.cronologia = cronologia && cronologia.ok && Array.isArray(cronologia.items) ? cronologia.items : [];
    const tema = { tema: (impostazioni && impostazioni.theme) || 'system', tokens: (impostazioni && impostazioni.themeTokens) || {} };
    if (!this.mostra(r.wc, c.punto, { menu: { id: m.id, ...r.menu }, cronologia: conIncolla ? m.cronologia : null, ...tema })) {
      this.menu = null;
      this._alContent(m, { type: msg().STRATO_MENU_CHIUSO, id: m.id });
      return;
    }
    m.pronto = true;
    for (const dati of m.coda.splice(0)) this._alloStrato('strato:aggiorna', dati);
  }

  _pronta(entroMs = PRONTA_MS) {
    const fine = Date.now() + entroMs;
    return new Promise((fatto) => {
      const guarda = () => {
        if (!this.vista) this._vista();
        if (this.pronta || Date.now() >= fine || !this.win || this.win.isDestroyed()) { fatto(this.pronta); return; }
        setTimeout(guarda, 20);
      };
      guarda();
    });
  }

  _alloStrato(canale, dati) {
    const v = this.vista;
    if (!v || v.webContents.isDestroyed()) return;
    try { v.webContents.send(canale, dati); } catch (_) {}
  }

  _alContent(m, dati) {
    try {
      if (m && m.frame && !m.frame.detached) m.frame.send('filo:broadcast', dati);
    } catch (_) {}
  }

  _voce(m, chiave) {
    const C = globalThis.SN_CLIPBOARD;
    if (!C || typeof chiave !== 'string' || !chiave) return null;
    return (m.cronologia || []).find((v) => C.chiave(v) === chiave) || null;
  }

  // Quello che lo strato chiede al main: vale per il menu a schermo, e dopo un gesto vero sullo strato.
  async _dalloStrato(canale, d) {
    const m = this.menu;
    const a = this.aperto;
    if (!m || !m.pronto || !a || !d || Number(d.seq) !== a.seq || d.id !== m.id) return;
    const ora = Date.now();
    const contagocce = canale === 'strato:esegui' && d.contagocce === true && ora - this.clicAlle <= CONTAGOCCE_MS;
    if (ora - this.gestoAlle > GESTO_MS && !contagocce) return;
    const unClic = ora - this.clicAlle <= GESTO_MS;
    const M = msg();
    if (canale === 'strato:tastiera') {
      try { this.vista.webContents.focus(); } catch (_) {}
      return;
    }
    // La rotella fuori da un menu che resta aperto scorre la pagina sotto, come se lo strato non ci fosse.
    if (canale === 'strato:rotella') {
      const q = puntoNellArea({ x: d.x, y: d.y }, a.area);
      const delta = (v) => (Number.isFinite(Number(v)) ? Math.max(-10000, Math.min(10000, Number(v))) : 0);
      if (!q || m.wc.isDestroyed()) return;
      try { m.wc.sendInputEvent({ type: 'mouseWheel', x: q.x, y: q.y, deltaX: -delta(d.dx), deltaY: -delta(d.dy), canScroll: true }); } catch (_) {}
      return;
    }
    if (canale === 'strato:esegui') {
      if (d.inline != null) {
        const cammino = interi(d.cammino);
        if (!unClic || !Number.isInteger(d.inline) || !cammino) return;
        this._alContent(m, { type: M.STRATO_MENU_ESEGUI, id: m.id, inline: d.inline, cammino, sfondo: d.sfondo === true });
        return;
      }
      if (!Number.isInteger(d.n) || d.n < 0) return;
      const args = Array.isArray(d.args) && pesa(d.args) <= AGGIORNA_MAX_BYTE ? d.args : [];
      const chiude = d.chiude === true;
      const esegui = { type: M.STRATO_MENU_ESEGUI, id: m.id, n: d.n, args, chiude };
      if (!chiude) { this._alContent(m, esegui); return; }
      // Alla pagina non si regala il gesto (patterns/un-clic-vero-dato-a-una-pagina-e-un-gesto-regalato.md): la voce
      // parte col fuoco rimesso alla scheda, e quello che chiede un gesto vero lo fa lo strato (il contagocce).
      if (!unClic && !contagocce) return;
      this.nascondi({ dopo: () => this._alContent(m, esegui) });
      return;
    }
    if (!unClic) return;
    if (canale === 'strato:incolla') {
      const s = this.scheda(m.wc);
      const letti = s ? await comeFilo(this.win, null, { type: M.APPUNTI_DI_FILO }, { id: s.id, url: s.url, wc: m.wc }) : null;
      if (this.menu !== m) return;
      const incolla = letti && letti.ok
        ? { type: M.STRATO_MENU_INCOLLA, id: m.id, testo: String(letti.testo || ''), immagine: String(letti.immagine || '') }
        : { type: M.STRATO_MENU_INCOLLA, id: m.id, testo: '', immagine: '' };
      this.nascondi({ dopo: () => this._alContent(m, incolla) });
      return;
    }
    const voce = this._voce(m, d.chiave);
    const vista = this.vista && this.vista.webContents;
    if (canale === 'strato:scegli' && voce) {
      await comeFilo(this.win, vista, { type: M.PUSH_CLIPBOARD_ENTRY, entry: voce });
      if (this.menu === m) this.nascondi({ dopo: () => this._alContent(m, { type: M.STRATO_MENU_INCOLLA, id: m.id, voce }) });
      return;
    }
    if (canale === 'strato:togli' && voce) {
      const C = globalThis.SN_CLIPBOARD;
      m.cronologia = m.cronologia.filter((v) => C.chiave(v) !== d.chiave);
      await comeFilo(this.win, vista, { type: M.REMOVE_CLIPBOARD_ENTRY, entry: voce });
      return;
    }
    if (canale === 'strato:svuota') {
      m.cronologia = [];
      await comeFilo(this.win, vista, { type: M.CLEAR_CLIPBOARD_HISTORY });
    }
  }

  _rigiocaDestro(wc, p) {
    let davanti = null;
    try { davanti = this.schedaAttiva(); } catch (_) { davanti = null; }
    const area = this._area();
    const q = davanti === wc && !wc.isDestroyed() ? puntoNellArea(p, area) : null;
    if (!q) return;
    try {
      wc.sendInputEvent({ type: 'mouseDown', x: q.x, y: q.y, button: 'right', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x: q.x, y: q.y, button: 'right', clickCount: 1 });
    } catch (_) {}
  }

  // Un'icona trascinata dal menu dello strato verso la barra laterale: i px dello strato sono quelli della scheda.
  _versoLaBarra(d) {
    const m = this.menu;
    const barra = this.barra();
    const s = m && this.scheda(m.wc);
    if (!m || !m.pronto || !barra || !s || !d || Date.now() - this.gestoAlle > GESTO_MS) return { ok: false };
    const fase = String(d.fase || '');
    if (!['inizio', 'sopra', 'posa', 'fine'].includes(fase)) return { ok: false };
    const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    const dati = { fase, id: String(d.id || ''), menuSinistra: num(d.menuSinistra), x: num(d.x), y: num(d.y) };
    try { return barra.dallaScheda(dati, s.id, { zoom: 1 }); } catch (_) { return { ok: false }; }
  }

  mostra(wc, punto, dati = {}) {
    if (!acceso() || !wc || wc.isDestroyed() || !this.win || this.win.isDestroyed()) return false;
    let davanti = null;
    try { davanti = this.schedaAttiva(); } catch (_) { davanti = null; }
    const area = davanti === wc ? this._area() : null;
    const p = puntoNellArea(punto, area);
    if (!p) return false;
    const vista = this._vista();
    if (!vista || !this.pronta) return false;
    this._segui(wc);
    this.aperto = { wc, punto: p, area, seq: ++this.seq };
    vista.setBounds(area);
    this.inCima();
    vista.setVisible(true);
    try { vista.webContents.send('strato:mostra', { ...dati, seq: this.aperto.seq, x: p.x, y: p.y, w: area.width, h: area.height }); } catch (_) {}
    return true;
  }

  // `dopo`: l'azione scelta, consegnata quando la tastiera è già tornata alla scheda e prima che il menu si dica chiuso.
  nascondi({ dopo = null } = {}) {
    const m = this.menu;
    this.menu = null;
    if (this.aperto) {
      this.aperto = null;
      const vista = this.vista;
      if (vista && !vista.webContents.isDestroyed()) {
        const aveva = this._haTastiera();
        vista.setVisible(false);
        vista.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        try { vista.webContents.send('strato:via'); } catch (_) {}
        if (aveva) this._restituisci();
      }
    }
    if (typeof dopo === 'function') { try { dopo(); } catch (_) {} }
    if (m) this._alContent(m, { type: msg().STRATO_MENU_CHIUSO, id: m.id });
  }

  // Un'altra scheda davanti, o nessuna, chiude. La stessa con l'area cambiata no: chi accorcia la finestra non annulla il
  // menu (#500), lo strato prende la nuova area e il menu rientra da sé.
  posa() {
    if (!this.aperto) return;
    let davanti = null;
    try { davanti = this.schedaAttiva(); } catch (_) { davanti = null; }
    const area = this._area();
    if (davanti !== this.aperto.wc || !area) { this.nascondi(); return; }
    if (!stessaArea(area, this.aperto.area)) {
      this.aperto.area = area;
      this.aperto.punto = puntoNellArea(this.aperto.punto, area);
      const vista = this.vista;
      if (vista && !vista.webContents.isDestroyed()) vista.setBounds(area);
    }
    this.inCima();
  }

  // Sopra tutto tranne la barra laterale: la sua striscia sul bordo e il pannello aperto restano raggiungibili a menu
  // aperto, come col menu nella pagina, e un'icona si porta dalla barra al menu (#871).
  inCima() {
    if (!this.aperto || !this.vista || this.vista.webContents.isDestroyed()) return;
    const cv = this.win.contentView;
    let barra = null;
    try { barra = this.barra(); } catch (_) { barra = null; }
    const sopra = barra && barra.vista && !barra.vista.webContents.isDestroyed() ? barra.vista : null;
    const figli = () => cv.children || [];
    const mia = figli().indexOf(this.vista);
    const suaPrima = sopra ? figli().indexOf(sopra) : -1;
    const giusto = sopra && suaPrima >= 0
      ? mia === figli().length - 2 && suaPrima === figli().length - 1
      : mia === figli().length - 1;
    if (giusto) return;
    cv.addChildView(this.vista);
    if (sopra && suaPrima >= 0) cv.addChildView(sopra);
  }

  // Un'icona trascinata dalla barra verso il menu aperto: un gesto dell'utente che il main ha visto, nella barra.
  gestoDallaBarra() {
    if (this.aperto) this.gestoAlle = Date.now();
  }

  // Esc chiude lo strato prima di ogni altro uso del tasto (schermo intero compreso), da qualunque vista arrivi.
  tasto(input) {
    if (!this.aperto || !input || input.type !== 'keyDown') return false;
    if (input.key !== 'Escape' && input.code !== 'Escape') return false;
    this.nascondi();
    return true;
  }

  stato() {
    const a = this.aperto;
    return {
      acceso: acceso(),
      pronta: this.pronta,
      aperto: !!a,
      punto: a ? { ...a.punto } : null,
      area: a ? { ...a.area } : null,
      scheda: a ? a.wc.id : null,
      vista: this.vista && !this.vista.webContents.isDestroyed() ? this.vista.webContents.id : null,
    };
  }

  _area() {
    let b = null;
    try { b = this.area(); } catch (_) { b = null; }
    return b && b.width > 0 && b.height > 0 ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
  }

  _haTastiera() {
    try { return WebContents.getFocusedWebContents() === this.vista.webContents; } catch (_) { return false; }
  }

  _restituisci() {
    if (!this.win || this.win.isDestroyed() || !this.win.isFocused()) return;
    let wc = null;
    try { wc = this.schedaAttiva(); } catch (_) { wc = null; }
    if (wc && !wc.isDestroyed()) { try { wc.focus(); } catch (_) {} }
  }

  // Scheda chiusa, renderer morto, documento nuovo: quello che stava sotto il punto non c'è più.
  _segui(wc) {
    if (this.seguite.has(wc)) return;
    this.seguite.add(wc);
    const via = () => { if (this.aperto && this.aperto.wc === wc) this.nascondi(); };
    wc.once('destroyed', via);
    wc.on('render-process-gone', via);
    wc.on('did-start-navigation', (_e, _url, inPagina, principale) => { if (principale && !inPagina) via(); });
  }

  _vista() {
    if (this.vista && !this.vista.webContents.isDestroyed()) return this.vista;
    if (!acceso() || !this.win || this.win.isDestroyed()) return null;
    const { WebContentsView } = require('electron');
    const vista = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'strato-menu-preload.js'),
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
    const wc = vista.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    collegaScorciatoie(wc, this.win);
    wc.on('before-input-event', (e, input) => { if (this.tasto(input)) e.preventDefault(); });
    // Il gesto vero sullo strato lo vede il main: è quello che fa valere una voce, non quello che la pagina dichiara.
    wc.on('input-event', (_e, input) => {
      const t = input && input.type;
      this.gestoAlle = Date.now();
      if (t === 'mouseDown' || t === 'mouseUp' || t === 'keyDown' || t === 'rawKeyDown') this.clicAlle = this.gestoAlle;
    });
    wc.on('ipc-message', (_e, canale, dati) => {
      // Un clic fuori dal menu chiude e basta: lo strato copre la scheda, e alla pagina sotto non arriva.
      if (canale === 'strato:fuori') {
        if (!this.aperto || Number(dati && dati.seq) !== this.aperto.seq) return;
        const sotto = this.aperto.wc;
        this.nascondi();
        // Un tasto destro altrove apre lì il menu nuovo, come nella pagina: lo strato lo rigioca sulla scheda.
        if (dati.destro && Date.now() - this.clicAlle <= GESTO_MS) this._rigiocaDestro(sotto, dati.destro);
        return;
      }
      // Le ricerche nel menu e nella cronologia degli appunti, per i contatori (#1461): solo numeri ed esiti, per la
      // finestra di questo strato. Lo strato nomina solo questi due pannelli.
      if (canale === 'strato:conta') {
        const d = dati && typeof dati === 'object' ? dati : {};
        const incognito = !!(this.win && this.win._filoIncognito);
        // I gesti del menu (#1471): il main ne prende solo le chiavi e le voci dei loro elenchi.
        if (d.misura === 'gesto') {
          const C = globalThis.SN_CONTATORI;
          const g = String(d.gesto || '');
          try { if (C && C.GESTI_DALLE_PAGINE.includes(g)) globalThis.SN_CONTATORI_MAIN?.gesto(g, d, { incognito }); } catch (_) {}
          return;
        }
        const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
        const pannello = d.pannello === 'tasto-destro' ? 'tasto-destro' : 'incolla';
        try {
          globalThis.SN_CONTATORI_MAIN?.ricerca(pannello, { esito: String(d.esito || ''), attesaMs: n(d.attesaMs), posizione: n(d.posizione) }, { incognito });
        } catch (_) {}
        return;
      }
      if (/^strato:(esegui|incolla|scegli|togli|svuota|tastiera|rotella)$/.test(canale)) this._dalloStrato(canale, dati).catch(() => {});
    });
    try { wc.ipc.handle('strato:barra', (_e, dati) => this._versoLaBarra(dati)); } catch (_) {}
    wc.once('did-finish-load', () => {
      // I px dello strato devono essere quelli del punto: uno zoom rimasto sull'host «menu» li sposterebbe.
      try { wc.setZoomFactor(1); } catch (_) {}
      this.pronta = true;
    });
    wc.on('render-process-gone', () => { this.aperto = null; this._butta(); setImmediate(() => this._vista()); });
    // Carica FUORI dalla finestra (ci entra alla prima apertura): dentro si prenderebbe la tastiera di chi scrive.
    wc.loadURL(INDIRIZZO);
    return vista;
  }

  _butta() {
    const vista = this.vista;
    this.vista = null;
    this.pronta = false;
    this.aperto = null;
    if (!vista) return;
    try { if (this.win && !this.win.isDestroyed()) this.win.contentView.removeChildView(vista); } catch (_) {}
    try { if (!vista.webContents.isDestroyed()) vista.webContents.close(); } catch (_) {}
  }
}

module.exports = { StratoDelMenu, acceso, puntoNellArea, ACCESO_DI_SERIE, INDIRIZZO };
