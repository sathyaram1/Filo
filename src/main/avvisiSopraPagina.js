// Vista che mostra gli avvisi della barra sopra le schede (#588.5), una per finestra, nata al primo avviso.
// Il modello (tetto, tempi, azioni) resta in shell.js: qui posa, clic, tasto destro e gesti del vuoto
// rigirati alla scheda. Regole: patterns/la-shell-non-disegna-sopra-la-pagina.md

const path = require('node:path');
const { collegaScorciatoie } = require('./shortcuts');

const NOME_VAR = /^--[a-z][a-z0-9-]*$/;
const AZIONE = /^(chiudi|\d{1,2})$/;
const GESTI = new Set(['mouseDown', 'mouseUp', 'mouseMove', 'mouseLeave', 'mouseWheel']);
const TASTI = new Set(['left', 'middle', 'right']);
const MODIFICATORI = new Set(['shift', 'control', 'alt', 'meta', 'leftButtonDown', 'middleButtonDown', 'rightButtonDown']);

const testo = (v) => (typeof v === 'string' ? v : String(v == null ? '' : v));
const lato = (v) => Math.max(0, Math.min(10000, Math.round(Number(v) || 0)));
const coord = (v) => Math.max(-10000, Math.min(10000, Math.round(Number(v) || 0)));
const passo = (v) => Math.max(-5000, Math.min(5000, Number(v) || 0));

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
  // schedaAttiva: la WebContentsView della scheda in primo piano (o null).
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
    this.inoltroSu = null;
    this.cursori = new WeakSet();
    this.forme = new WeakMap();
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
      return;
    }
    vista.setBounds({ x: W - w, y: H - h, width: w, height: h });
    this._inCima();
    vista.setVisible(true);
    this.altezza = h;
    this._riserva(h);
    const wc = this._wcAttiva();
    if (wc) this._seguiPuntatore(wc);
  }

  // L'angolo in basso a destra è uno: gli avvisi di Filo dentro la scheda attiva salgono sopra la
  // pila della barra (--filo-avvisi-barra, letta dalle loro pile in popup.css ed editor.css).
  _riserva(px) {
    const wc = this._wcAttiva();
    if (wc) this._scriviRiserva(wc, px);
  }

  // Un foglio inserito mentre la scheda carica può finire nel documento nuovo senza che se ne tenga la chiave, e
  // restare lì col vecchio valore: quindi il valore nuovo si mette SOPRA (stessa origine e peso, vince il più
  // recente) e solo dopo si toglie il precedente. Foglio d'autore: uno di origine 'user' non si toglie più.
  _scriviRiserva(wc, px) {
    let r = this.riserve.get(wc);
    if (!r) {
      r = { px: 0, chiave: null, gen: 0, coda: Promise.resolve() };
      this.riserve.set(wc, r);
      // Documento nuovo: la chiave del vecchio non vale più, e lì dentro può esserci un foglio di cui non si sa.
      wc.on('did-navigate', () => { r.gen++; r.chiave = null; r.px = null; });
      wc.on('dom-ready', () => { r.px = null; this._scriviRiserva(wc, this._wcAttiva() === wc ? this.altezza : 0); });
      // Il valore è in px CSS della scheda: cambiato lo zoom (da qualunque parte), va riscritto.
      try { wc.ipc.on('filo:zoom-cambiato', () => { if (this._wcAttiva() === wc) this._scriviRiserva(wc, this.altezza); }); } catch (_) {}
    }
    let zoom = 1;
    try { zoom = wc.getZoomFactor() || 1; } catch (_) { zoom = 1; }
    const css = px > 0 ? Math.ceil(px / zoom) : 0;
    if (css === r.px) return;
    r.px = css;
    const gen = r.gen;
    r.coda = r.coda.then(async () => {
      if (wc.isDestroyed()) return;
      let k = null;
      try { k = await wc.insertCSS(`:root:root{--filo-avvisi-barra:${css}px!important}`); } catch (_) { return; }
      if (gen !== r.gen) return;
      const prima = r.chiave;
      r.chiave = k;
      if (prima) { try { await wc.removeInsertedCSS(prima); } catch (_) {} }
    });
  }

  _schedaViva() {
    let v = null;
    try { v = this.schedaAttiva(); } catch (_) { v = null; }
    return v && v.webContents && !v.webContents.isDestroyed() ? v : null;
  }

  _wcAttiva() {
    const v = this._schedaViva();
    return v ? v.webContents : null;
  }

  // Dove la vista è vuota (margine, accanto a una carta più stretta) il gesto è della pagina sotto:
  // la vista lo rigira alla scheda, come le pile della pagina che dove sono vuote lasciano passare il clic.
  _inoltra(d) {
    const tipo = testo(d && d.tipo);
    const v = this._schedaViva();
    if (!GESTI.has(tipo) || !this.vista || !v) return;
    const wc = v.webContents;
    const b = this.vista.getBounds();
    const s = v.getBounds();
    const ev = { type: tipo, x: coord(b.x + coord(d.x) - s.x), y: coord(b.y + coord(d.y) - s.y) };
    ev.modifiers = (Array.isArray(d.mod) ? d.mod : []).map(testo).filter((m) => MODIFICATORI.has(m));
    if (tipo === 'mouseDown' || tipo === 'mouseUp') {
      ev.button = TASTI.has(d.tasto) ? d.tasto : 'left';
      ev.clickCount = Math.max(1, Math.min(3, Math.round(Number(d.clic) || 1)));
    } else if (tipo === 'mouseWheel') {
      Object.assign(ev, { deltaX: passo(d.dx), deltaY: passo(d.dy), canScroll: true, hasPreciseScrollingDeltas: true });
    }
    const prima = this.inoltroSu;
    this.inoltroSu = tipo === 'mouseLeave' ? null : wc;
    this._seguiPuntatore(wc);
    // Rientrando nel vuoto la pagina non ridice un puntatore che per lei non è cambiato: lo si ridà da qui.
    if (this.inoltroSu && prima !== wc) this._puntatore(this.forme.get(wc) || '');
    if (tipo === 'mouseDown') this.restituisciTastiera();
    try { wc.sendInputEvent(ev); } catch (_) {}
  }

  // Sopra il vuoto della vista il puntatore è quello che mostrerebbe la pagina (mano su un link, barra sul testo).
  // Si ascolta da quando la vista copre la scheda, così si sa anche quello che la pagina ha detto prima.
  _seguiPuntatore(wc) {
    if (this.cursori.has(wc)) return;
    this.cursori.add(wc);
    wc.on('cursor-changed', (_e, forma) => {
      this.forme.set(wc, testo(forma));
      if (this.inoltroSu === wc) this._puntatore(forma);
    });
  }

  _puntatore(forma) {
    if (!this.vista || this.vista.webContents.isDestroyed()) return;
    try { this.vista.webContents.send('avvisi:cursore', testo(forma)); } catch (_) {}
  }

  // Tasto destro su una carta: le sue azioni e la chiusura, nel menu di Filo; la scelta fa quello che fa il pulsante.
  _menu(d) {
    const id = testo(d && d.id);
    const carta = this.stato.carte.find((c) => c.id === id && !c.chiusa);
    if (!carta || !this.vista || !this.win || this.win.isDestroyed()) return;
    this._nascondiSuggerimento();
    const voci = carta.azioni.map((label, i) => ({ label, action: `avviso:${i}` })).filter((v) => v.label);
    if (voci.length) voci.push({ type: 'separator' });
    voci.push({ label: 'Chiudi', icon: 'close', action: 'avviso:chiudi' });
    const b = this.vista.getBounds();
    const { showPopupMenu } = require('./popup-menu');
    showPopupMenu(this.win, voci, b.x + coord(d.x), b.y + coord(d.y), (scelta) => {
      const m = /^@action:avviso:(chiudi|\d{1,2})$/.exec(testo(scelta));
      if (!m || this.win.isDestroyed()) return;
      try { this.win.webContents.send('avvisi:azione', { id, azione: m[1] }); } catch (_) {}
      this.restituisciTastiera();
    });
  }

  // Il puntatore sopra le carte ferma i loro tempi: li tiene la shell.
  _sopra(on) {
    if (!this.win || this.win.isDestroyed()) return;
    try { this.win.webContents.send('avvisi:sopra', { sopra: on }); } catch (_) {}
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
    // La tastiera non è sua: un clic su una carta gliela dà, e torna subito a chi scriveva. Al giro dopo:
    // durante l'evento il fuoco risulta ancora a chi l'aveva, e restituirlo sarebbe un no-op.
    wc.on('focus', () => setTimeout(() => this.restituisciTastiera(), 0));
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
      } else if (canale === 'avvisi:inoltra') {
        this._inoltra(dati);
      } else if (canale === 'avvisi:menu') {
        this._menu(dati);
      } else if (canale === 'avvisi:sopra') {
        this._sopra(!!(dati && dati.sopra));
      }
    });
    wc.once('did-finish-load', () => { this.pronta = true; this._invia(); });
    // Se la vista muore, il prossimo avviso ne fa nascere un'altra.
    wc.on('render-process-gone', () => this._butta());
    // Carica FUORI dalla finestra (ci entra alla prima posa): dentro si prenderebbe la tastiera di chi scrive.
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
    this._sopra(false);
    this.altezza = 0;
    try { this._riserva(0); } catch (_) {}
    try { if (this.win && !this.win.isDestroyed()) this.win.contentView.removeChildView(vista); } catch (_) {}
    try { if (!vista.webContents.isDestroyed()) vista.webContents.close(); } catch (_) {}
  }
}

module.exports = { AvvisiSopraPagina, pulisci };
