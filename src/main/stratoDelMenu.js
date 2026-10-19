// Lo strato del menu del tasto destro (#1053): una vista trasparente per finestra, posata sopra la scheda attiva, dove
// il menu si disegnerà fuori dal documento del sito. Nasce una volta e resta pronta e nascosta; spenta di serie.
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

function stessaArea(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// Il punto arriva dal `context-menu` della scheda: px della vista (DIP), già fuori da zoom e riquadri. Mai dalla
// posizione del cursore sullo schermo, che su Wayland non si sa.
function puntoNellArea(punto, area) {
  const x = Number(punto && punto.x);
  const y = Number(punto && punto.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !area) return null;
  return {
    x: Math.min(Math.max(0, Math.round(x)), Math.max(0, area.width - 1)),
    y: Math.min(Math.max(0, Math.round(y)), Math.max(0, area.height - 1)),
  };
}

class StratoDelMenu {
  // schedaAttiva(): il webContents della scheda davanti; area(): dove sta nella finestra, null se non si vede.
  constructor(win, { schedaAttiva = () => null, area = () => null } = {}) {
    this.win = win;
    this.schedaAttiva = schedaAttiva;
    this.area = area;
    this.vista = null;
    this.pronta = false;
    this.aperto = null; // { wc, punto, area, seq }
    this.seq = 0;
    this.seguite = new WeakSet();
    if (!acceso() || !win || typeof win.once !== 'function') return;
    win.once('closed', () => this._butta());
    // Lo schermo intero cambia tutto quello che c'è sotto, anche quando lo chiede il sistema.
    win.on('enter-full-screen', () => this.nascondi());
    win.on('leave-full-screen', () => this.nascondi());
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

  mostra(wc, punto) {
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
    try { vista.webContents.send('strato:mostra', { seq: this.aperto.seq, x: p.x, y: p.y }); } catch (_) {}
    return true;
  }

  nascondi() {
    if (!this.aperto) return;
    this.aperto = null;
    const vista = this.vista;
    if (!vista || vista.webContents.isDestroyed()) return;
    const aveva = this._haTastiera();
    vista.setVisible(false);
    vista.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    try { vista.webContents.send('strato:via'); } catch (_) {}
    if (aveva) this._restituisci();
  }

  // Dal layout delle schede: un'altra scheda davanti, o la sua area cambiata (schermo intero, barra compatta,
  // finestra ridimensionata), e il punto non indica più quello che l'utente aveva cliccato.
  posa() {
    if (!this.aperto) return;
    let davanti = null;
    try { davanti = this.schedaAttiva(); } catch (_) { davanti = null; }
    if (davanti !== this.aperto.wc || !stessaArea(this._area(), this.aperto.area)) { this.nascondi(); return; }
    this.inCima();
  }

  inCima() {
    if (!this.aperto || !this.vista || this.vista.webContents.isDestroyed()) return;
    const cv = this.win.contentView;
    const figli = cv.children || [];
    if (figli[figli.length - 1] !== this.vista) cv.addChildView(this.vista);
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
    wc.on('ipc-message', (_e, canale, dati) => {
      // Un clic fuori dal menu chiude e basta: lo strato copre la scheda, e alla pagina sotto non arriva.
      if (canale === 'strato:fuori' && this.aperto && Number(dati && dati.seq) === this.aperto.seq) this.nascondi();
    });
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
