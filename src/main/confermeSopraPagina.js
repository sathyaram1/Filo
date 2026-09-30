// Vista che mostra sopra un sito le conferme di Filo (#592.6): nel documento del sito il suo codice poteva
// nasconderle e disegnarne una finta al loro posto. Una per finestra, nata alla prima domanda; non decide niente.
// Regole: patterns/una-conferma-su-un-sito-sta-fuori-dal-suo-documento.md

const path = require('node:path');
const { BrowserWindow, webContents: WebContents } = require('electron');
const { collegaScorciatoie } = require('./shortcuts');

const TIPI = new Set(['confirm', 'typed', 'notify']);
const CAMPI = ['title', 'text', 'okLabel', 'cancelLabel', 'word'];
const BANDIERE = ['coprePagina', 'reversibile'];

// Dalla pagina arrivano solo le forme attese, e i testi interi: si conferma quello che si legge.
function pulisci(r) {
  const out = {
    tipo: TIPI.has(r && r.tipo) ? r.tipo : 'confirm',
    scriveva: !!(r && r.scriveva === true),
    campo: !!(r && r.campo === true),
  };
  for (const k of CAMPI) if (r && typeof r[k] === 'string') out[k] = r[k];
  for (const k of BANDIERE) if (r && r[k] === true) out[k] = true;
  // Un avviso sulla pagina non rimanda tasti alla pagina, qualunque cosa dica chi chiede.
  if (out.coprePagina) { out.scriveva = false; out.campo = false; }
  return out;
}

function stessoFrame(frame, pid, rid) {
  try { return frame.processId === pid && frame.routingId === rid; } catch (_) { return true; }
}

class ConfermeSopraPagina {
  // sotto(): il webContents che si vede adesso nell'area da coprire; area(): quell'area, nella finestra.
  constructor(win, { sotto = () => null, area = () => null } = {}) {
    this.win = win;
    this.sotto = sotto;
    this.area = area;
    this.vista = null;
    this.pronta = false;
    this.coda = [];
    this.mostrata = null;
    this.seq = 0;
    this.seguite = new WeakSet();
    if (win && typeof win.once === 'function') win.once('closed', () => { this._togli(() => true); this._butta(); });
  }

  chiedi(wc, frame, richiesta) {
    if (!wc || wc.isDestroyed() || !this.win || this.win.isDestroyed()) return Promise.resolve(false);
    return new Promise((resolve) => {
      const idPagina = richiesta && Number.isSafeInteger(richiesta.id) ? richiesta.id : 0;
      this.coda.push({ id: ++this.seq, wc, frame, idPagina, richiesta: pulisci(richiesta), resolve });
      this._segui(wc);
      this.posa();
    });
  }

  // Chi ha chiesto non la vuole più (il verdetto sul sito è cambiato): vale un Annulla, anche se è a schermo.
  ritira(wc, frame, idPagina) {
    if (!Number.isSafeInteger(idPagina) || idPagina <= 0) return;
    this._togli((v) => v.wc === wc && v.idPagina === idPagina
      && (!frame || !v.frame || stessoFrame(v.frame, frame.processId, frame.routingId)));
  }

  // Chiamata dal layout delle schede: cambio di scheda, ridimensionamenti, schermo intero.
  // Una domanda si vede solo sopra la sua scheda, quando è davanti; le altre aspettano il loro turno.
  posa() {
    if (!this.win || this.win.isDestroyed()) return;
    const voce = this._daMostrare();
    const b = voce ? this.area() : null;
    if (!voce || !b || !(b.width > 0) || !(b.height > 0)) { this._nascondi(); return; }
    const vista = this._vista();
    if (!vista || !this.pronta) return;
    vista.setBounds(b);
    this._inCima();
    vista.setVisible(true);
    if (this.mostrata === voce.id) return;
    this.mostrata = voce.id;
    this._invia(voce);
    this._tastiera(voce);
  }

  // Gli avvisi della barra tornano in cima a ogni loro cambio: la domanda aperta resta sopra di loro.
  inCima() {
    if (this.mostrata && this.vista && !this.vista.webContents.isDestroyed()) this._inCima();
  }

  _inCima() {
    const cv = this.win.contentView;
    const figli = cv.children || [];
    if (figli[figli.length - 1] !== this.vista) cv.addChildView(this.vista);
  }

  _daMostrare() {
    let wc = null;
    try { wc = this.sotto(); } catch (_) { wc = null; }
    return (wc && this.coda.find((v) => v.wc === wc)) || null;
  }

  _nascondi() {
    const vista = this.vista;
    if (!vista || vista.webContents.isDestroyed()) return;
    const aveva = this._haTastiera();
    vista.setVisible(false);
    vista.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    // Tornando davanti la domanda si ridisegna da capo, e col popup riparte il mezzo secondo prima del sì.
    if (this.mostrata) {
      this.mostrata = null;
      try { vista.webContents.send('conferma:via'); } catch (_) {}
    }
    if (aveva) this._restituisci();
  }

  _haTastiera() {
    try { return WebContents.getFocusedWebContents() === this.vista.webContents; } catch (_) { return false; }
  }

  // La domanda si prende la tastiera se ce l'aveva la pagina che la fa (o nessuno): chi scriveva nella
  // barra la tiene. Quello che batte chi scriveva nella pagina torna nel suo campo (conferma:tasto).
  _tastiera(voce) {
    if (!this.win.isFocused() || !this.vista) return;
    let col = null;
    try { col = WebContents.getFocusedWebContents(); } catch (_) { col = null; }
    if (col && col !== voce.wc && col !== this.vista.webContents) return;
    try { this.vista.webContents.focus(); } catch (_) {}
  }

  _restituisci() {
    if (!this.win || this.win.isDestroyed() || !this.win.isFocused()) return;
    let wc = null;
    try { wc = this.sotto(); } catch (_) { wc = null; }
    if (wc && !wc.isDestroyed()) { try { wc.focus(); } catch (_) {} }
  }

  _segui(wc) {
    if (this.seguite.has(wc)) return;
    this.seguite.add(wc);
    const via = (filtro) => this._togli((v) => v.wc === wc && filtro(v));
    wc.once('destroyed', () => via(() => true));
    wc.on('render-process-gone', () => via(() => true));
    // Un documento nuovo non aspetta la risposta del vecchio: la sua domanda se ne va con lui.
    wc.on('did-frame-navigate', (_e, _url, _codice, _stato, principale, pid, rid) => {
      via((v) => principale || !v.frame || stessoFrame(v.frame, pid, rid));
    });
    // Finché la domanda è a schermo la pagina sotto non si riprende la tastiera (tornando alla finestra,
    // o con la scheda riattivata): al giro dopo, perché durante l'evento il fuoco risulta ancora suo.
    wc.on('focus', () => {
      const v = this.coda.find((x) => x.id === this.mostrata);
      if (!v || v.wc !== wc) return;
      setTimeout(() => {
        if (this.mostrata !== v.id || !this.vista || this.vista.webContents.isDestroyed()) return;
        try { this.vista.webContents.focus(); } catch (_) {}
      }, 0);
    });
  }

  _togli(filtro) {
    const via = this.coda.filter(filtro);
    if (!via.length) return;
    this.coda = this.coda.filter((v) => !via.includes(v));
    for (const v of via) v.resolve(false);
    this.posa();
  }

  _esito(d) {
    const id = Number(d && d.id);
    const voce = id && id === this.mostrata ? this.coda.find((v) => v.id === id) : null;
    if (!voce) return;
    this.coda = this.coda.filter((v) => v !== voce);
    // La vista ha già tolto il suo popup: niente «via» da mandarle.
    this.mostrata = null;
    voce.resolve(d.ok === true);
    this.posa();
  }

  _tasto(d) {
    const id = Number(d && d.id);
    const voce = id && id === this.mostrata ? this.coda.find((v) => v.id === id) : null;
    const tasto = d && d.tasto;
    if (!voce || !voce.richiesta.campo || !voce.frame || typeof tasto !== 'string') return;
    if (tasto.length !== 1 && tasto !== 'Backspace') return;
    try { voce.frame.send('filo:conferma-tasto', { id: voce.idPagina, tasto }); } catch (_) {}
  }

  async _invia(voce) {
    let s = {};
    try { s = (await globalThis.SN_STORAGE?.getSettings?.()) || {}; } catch (_) { s = {}; }
    if (this.mostrata !== voce.id || !this.vista || this.vista.webContents.isDestroyed()) return;
    const tema = {
      theme: typeof s.theme === 'string' ? s.theme : 'system',
      tokens: s.themeTokens && typeof s.themeTokens === 'object' ? s.themeTokens : {},
    };
    try { this.vista.webContents.send('conferma:mostra', { ...voce.richiesta, id: voce.id, tema }); } catch (_) {}
  }

  _vista() {
    if (this.vista && !this.vista.webContents.isDestroyed()) return this.vista;
    if (!this.win || this.win.isDestroyed()) return null;
    const { WebContentsView } = require('electron');
    const vista = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'conferma-preload.js'),
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
    this.mostrata = null;
    const wc = vista.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    collegaScorciatoie(wc, this.win);
    wc.on('ipc-message', (_e, canale, dati) => {
      if (canale === 'conferma:esito') this._esito(dati);
      else if (canale === 'conferma:tasto') this._tasto(dati);
    });
    wc.once('did-finish-load', () => { this.pronta = true; this.posa(); });
    // Una vista morta non risponde più: le domande aperte valgono un Annulla, la prossima ne fa nascere un'altra.
    wc.on('render-process-gone', () => { this._butta(); this._togli(() => true); });
    // Carica FUORI dalla finestra (ci entra alla prima posa): dentro si prenderebbe la tastiera di chi scrive.
    wc.loadURL('filo://shell/conferma.html');
    return vista;
  }

  _butta() {
    const vista = this.vista;
    this.vista = null;
    this.pronta = false;
    this.mostrata = null;
    if (!vista) return;
    try { if (this.win && !this.win.isDestroyed()) this.win.contentView.removeChildView(vista); } catch (_) {}
    try { if (!vista.webContents.isDestroyed()) vista.webContents.close(); } catch (_) {}
  }
}

const perPopup = new WeakMap();

// La domanda di una pagina web va sopra la sua scheda; da un popup di accesso, che è una finestra vera
// con dentro un sito (#589.3), sopra la finestra. Da chiunque altro non si apre niente.
function chiediConferma(event, richiesta) {
  const wc = event && event.sender;
  if (!wc) return Promise.resolve(false);
  const frame = event.senderFrame || null;
  for (const w of BrowserWindow.getAllWindows()) {
    const tm = w._filoTabs;
    if (tm && tm.conferme && tm.tabs.some((t) => t.view && t.view.webContents === wc)) return tm.conferme.chiedi(wc, frame, richiesta);
  }
  const win = BrowserWindow.fromWebContents(wc);
  if (!win || win.isDestroyed() || win._filoTabs || win.webContents !== wc) return Promise.resolve(false);
  let c = perPopup.get(win);
  if (!c) {
    c = new ConfermeSopraPagina(win, {
      sotto: () => (win.isDestroyed() ? null : win.webContents),
      area: () => {
        const [width, height] = win.getContentSize();
        return { x: 0, y: 0, width, height };
      },
    });
    perPopup.set(win, c);
    win.on('resize', () => c.posa());
  }
  return c.chiedi(wc, frame, richiesta);
}

module.exports = { ConfermeSopraPagina, chiediConferma, pulisci };
