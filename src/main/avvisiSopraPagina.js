// Vista che mostra gli avvisi della barra sopra le schede (#588.5): il DOM della shell nell'area
// pagina resta sotto la WebContentsView attiva. Una per finestra, nasce al primo avviso.
// Il modello (tetto, tempi, azioni) resta in shell.js: qui solo posa, ordine delle viste e clic.

const path = require('node:path');
const { collegaScorciatoie } = require('./shortcuts');

const NOME_VAR = /^--[a-z][a-z0-9-]*$/;
const AZIONE = /^(chiudi|\d{1,2})$/;

const testo = (v) => (typeof v === 'string' ? v : String(v == null ? '' : v));
const lato = (v) => Math.max(0, Math.min(10000, Math.round(Number(v) || 0)));

// Lo stato arriva dalla shell: se ne tengono solo le forme attese, senza tagliare i testi.
function pulisci(stato) {
  const carte = (Array.isArray(stato && stato.carte) ? stato.carte : [])
    .filter((c) => c && typeof c === 'object' && c.id)
    .map((c) => ({
      id: testo(c.id),
      testo: testo(c.testo),
      azioni: (Array.isArray(c.azioni) ? c.azioni : []).map(testo),
      chiusa: c.chiusa === true,
    }));
  const vars = {};
  const dati = stato && stato.tema && stato.tema.vars;
  if (dati && typeof dati === 'object') {
    for (const [k, v] of Object.entries(dati)) {
      if (NOME_VAR.test(k) && typeof v === 'string') vars[k] = v;
    }
  }
  return { carte, tema: { vars } };
}

class AvvisiSopraPagina {
  constructor(win, { alto = () => 0, restituisciTastiera = () => {}, schedaAttiva = () => null } = {}) {
    this.win = win;
    this.alto = alto;
    this.restituisciTastiera = restituisciTastiera;
    this.schedaAttiva = schedaAttiva;
    this.vista = null;
    this.pronta = false;
    this.stato = { carte: [], tema: { vars: {} } };
    this.misura = { w: 0, h: 0 };
    this.altezza = 0;
    this.riserve = new WeakMap();
    this.suggerimento = false;
    if (win && typeof win.once === 'function') win.once('closed', () => this._butta());
  }

  aggiorna(stato) {
    this.stato = pulisci(stato);
    if (!this.stato.carte.length) {
      if (this.vista) { this._invia(); this.posa(); }
      return;
    }
    if (!this._vista()) return;
    this._invia();
  }

  // Chiamata dal layout delle schede (ridimensionamenti, schede nuove, schermo intero).
  posa() {
    const vista = this.vista;
    if (!vista || vista.webContents.isDestroyed() || !this.win || this.win.isDestroyed()) return;
    const [W, H] = this.win.getContentSize();
    const w = Math.min(this.misura.w, W);
    const h = Math.min(this.misura.h, Math.max(0, H - this.alto()));
    if (!this.stato.carte.length || !w || !h) {
      vista.setVisible(false);
      vista.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      this._nascondiSuggerimento();
      this.altezza = 0;
      this._riserva(0);
      // Chi ha cliccato una carta ha dato la tastiera alla vista: sparita la vista, torna alla pagina.
      const col = require('electron').webContents.getFocusedWebContents();
      if (!col || col === vista.webContents) this.restituisciTastiera();
      return;
    }
    vista.setBounds({ x: W - w, y: H - h, width: w, height: h });
    this._inCima();
    vista.setVisible(true);
    this.altezza = h;
    this._riserva(h);
  }

  // L'angolo in basso a destra è uno: gli avvisi di Filo dentro la scheda attiva salgono sopra la
  // pila della barra (--filo-avvisi-barra, letta dalle loro pile in popup.css ed editor.css).
  _riserva(px) {
    let wc = null;
    try { wc = this.schedaAttiva(); } catch (_) { wc = null; }
    if (!wc || wc.isDestroyed()) return;
    let r = this.riserve.get(wc);
    if (!r) {
      r = { px: 0, chiave: null, coda: Promise.resolve() };
      this.riserve.set(wc, r);
      // Un documento nuovo non ha il foglio inserito nel vecchio: si rimette.
      wc.on('dom-ready', () => {
        r.px = 0;
        r.chiave = null;
        if (this.schedaAttiva() === wc) this._riserva(this.altezza);
      });
    }
    let zoom = 1;
    try { zoom = wc.getZoomFactor() || 1; } catch (_) { zoom = 1; }
    const css = px > 0 ? Math.ceil(px / zoom) : 0;
    if (css === r.px) return;
    r.px = css;
    r.coda = r.coda.then(async () => {
      if (r.chiave) {
        const k = r.chiave;
        r.chiave = null;
        try { await wc.removeInsertedCSS(k); } catch (_) {}
      }
      if (css > 0 && !wc.isDestroyed()) {
        try { r.chiave = await wc.insertCSS(`:root{--filo-avvisi-barra:${css}px!important}`, { cssOrigin: 'user' }); } catch (_) {}
      }
    });
  }

  _mostraSuggerimento(dati) {
    const t = testo(dati && dati.testo);
    const vista = this.vista;
    if (!t || !vista || !this.win || this.win.isDestroyed()) { this._nascondiSuggerimento(); return; }
    const b = vista.getBounds();
    this.suggerimento = true;
    try { require('./popup-tooltip').showTooltip(this.win, t, b.x + (Number(dati.x) || 0), b.y + (Number(dati.y) || 0)); } catch (_) {}
  }

  _nascondiSuggerimento() {
    if (!this.suggerimento) return;
    this.suggerimento = false;
    try { require('./popup-tooltip').hideTooltip(); } catch (_) {}
  }

  // Ogni scheda nuova entra in cima alle viste della finestra: gli avvisi devono tornarle sopra.
  _inCima() {
    const cv = this.win.contentView;
    const figli = cv.children || [];
    if (figli[figli.length - 1] !== this.vista) cv.addChildView(this.vista);
  }

  _invia() {
    if (!this.pronta || !this.vista) return;
    try { this.vista.webContents.send('avvisi:stato', this.stato); } catch (_) {}
  }

  _vista() {
    if (this.vista && !this.vista.webContents.isDestroyed()) return this.vista;
    if (!this.win || this.win.isDestroyed()) return null;
    const { WebContentsView } = require('electron');
    const vista = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'avvisi-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        // Nasce nascosta: senza, il disegno delle carte potrebbe restare fermo fino a che si vede.
        backgroundThrottling: false,
      },
    });
    vista.setBackgroundColor('#00000000');
    vista.setVisible(false);
    vista.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    this.vista = vista;
    this.pronta = false;
    this.misura = { w: 0, h: 0 };
    const wc = vista.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    // Un clic sulla carta le dà la tastiera: le scorciatoie di Filo devono restare vive anche lì.
    collegaScorciatoie(wc, this.win);
    wc.on('ipc-message', (_e, canale, dati) => {
      if (canale === 'avvisi:misura') {
        this.misura = { w: lato(dati && dati.w), h: lato(dati && dati.h) };
        this.posa();
      } else if (canale === 'avvisi:clic') {
        const id = testo(dati && dati.id);
        const azione = testo(dati && dati.azione);
        if (!id || !AZIONE.test(azione)) return;
        try { this.win.webContents.send('avvisi:azione', { id, azione }); } catch (_) {}
        this.restituisciTastiera();
      } else if (canale === 'avvisi:suggerimento') {
        this._mostraSuggerimento(dati);
      }
    });
    wc.once('did-finish-load', () => { this.pronta = true; this._invia(); });
    // Se la vista muore, il prossimo avviso ne fa nascere un'altra.
    wc.on('render-process-gone', () => this._butta());
    // Carica fuori dalla finestra e ci entra alla prima posa: una vista che carica dentro si prende
    // la tastiera, e chi stava scrivendo nella pagina perde i tasti (#588.5).
    // Da filo://shell come la shell: un file:// farebbe scattare chi controlla che nessuna vista apra file locali.
    wc.loadURL('filo://shell/avvisi.html');
    return vista;
  }

  _butta() {
    const vista = this.vista;
    this.vista = null;
    this.pronta = false;
    if (!vista) return;
    this._nascondiSuggerimento();
    this.altezza = 0;
    try { this._riserva(0); } catch (_) {}
    try { if (this.win && !this.win.isDestroyed()) this.win.contentView.removeChildView(vista); } catch (_) {}
    try { if (!vista.webContents.isDestroyed()) vista.webContents.close(); } catch (_) {}
  }
}

module.exports = { AvvisiSopraPagina, pulisci };
