// I riquadri di Filo sopra un sito (#1509.1): spiegazione, Modifica, feedback e attacco red-team si disegnano in una vista
// sopra la scheda, una per pagina, fuori dal documento del sito, che così non li legge, non li cerca e non li tocca.
// Regole: patterns/i-riquadri-di-filo-su-un-sito-stanno-sopra-la-scheda.md

const { webContents: WebContents } = require('electron');
const { collegaScorciatoie } = require('./shortcuts');
const { VuotoDellaVista } = require('./vuotoDellaVista');
const { percorsoDelPreload } = require('./preloadPacchetto');
const { zoomDaTasto, rotellaZoom } = require('./tabs/tabZoom');

const INDIRIZZO = 'filo://riquadri/riquadri.html';
const PRELOAD = 'src/preload/riquadri-preload.js';
const TIPI = new Set(['feedback', 'modifica', 'redteam', 'risposta', 'aiuto']);
// L'Aiuto nello strato lavora sulla pagina sotto (#1509.3): cosa può chiederle e quanto aspetta la risposta. Un'azione
// può aspettare il sì dell'utente; le altre sono letture o tocchi che finiscono in pochi secondi.
const OP_PAGINA = Object.freeze({ stato: 5000, leggi: 60000, azione: 600000, evidenzia: 15000, auto: 15000, pulisci: 15000 });
const COMANDI_AIUTO = new Set(['passo', 'chiudi', 'evita', 'azione']);
const AIUTO_CHIUSO = Object.freeze({ pannello: 'chiuso', voce: 'pronto', nonLetta: false });
// Abbondanti: una selezione da spiegare o un testo da modificare possono essere lunghi quanto la pagina. Oltre, la
// richiesta si rifiuta col numero, mai tagliata.
const DATI_MAX_BYTE = 8 * 1024 * 1024;
// Un ultimo punto del puntatore sulla scheda vale come ancora di una risposta chiesta da un riquadro incorporato.
const PUNTATORE_MS = 15000;
const ID_MAX = 80;
// Uno strato rimasto vuoto resta pronto per il riquadro dopo, poi se ne va: ogni strato è un processo.
const VUOTO_MS = 60000;

// Le viste vive, per webContents: chi parla da qui parla come la pagina sotto (src/main/ipc.js, senderInfo).
const perVista = new Map();

const msg = () => (globalThis.SN_MSG && globalThis.SN_MSG.MSG) || {};

function pesa(v) {
  try { return JSON.stringify(v).length; } catch (_) { return Infinity; }
}

function vivo(wc) {
  try { return !!wc && !wc.isDestroyed(); } catch (_) { return false; }
}

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function principaleDi(sender) {
  try { return !!sender && !sender.frame?.parent; } catch (_) { return false; }
}

// L'ancora di una risposta arriva in px della pagina; lo strato, a zoom 1, la vuole in px della vista.
function ancoraNellaVista(ancora, zoom) {
  if (!ancora || typeof ancora !== 'object') return null;
  const out = {};
  for (const k of ['x', 'y', 'top', 'bottom', 'left', 'right']) {
    const v = numero(ancora[k]);
    if (v !== undefined) out[k] = Math.round(v * zoom);
  }
  return Object.keys(out).length ? out : null;
}

class StratoDeiRiquadri {
  // area(wc): dove sta la pagina nella finestra, null se non si vede o se qualcosa la copre; sopraA(wc): la vista sopra
  // cui posarlo (null: in cima alla finestra); scheda(wc): { id, url, title } della pagina, null se non è sua;
  // tastoDellaScheda(wc, input): i tasti che la scheda prende prima della pagina, true se preso; pronta(v, wc): lo
  // strato `v` della pagina `wc` ha appena caricato (chi scrive nella scheda scrive anche lì, come l'angolo degli avvisi).
  constructor(win, { area = () => null, sopraA = () => null, scheda = () => null, tastoDellaScheda = () => false, pronta = () => {} } = {}) {
    this.win = win;
    this.area = area;
    this.sopraA = sopraA;
    this.scheda = scheda;
    this.tastoDellaScheda = tastoDellaScheda;
    this.pronta = pronta;
    this.strati = new Map(); // wc della pagina → { wc, vista, pronta, coda, aperti, riquadri, modale, inPagina }
    this.seguite = new WeakSet();
    this.seq = 0;
    if (win && typeof win.once === 'function') win.once('closed', () => { for (const s of [...this.strati.values()]) this._butta(s); });
  }

  // RIQUADRO_APRI dal content script della pagina: il riquadro nasce nello strato, mai nel documento del sito.
  apri(sender, d) {
    const wc = sender && sender.wc;
    if (!vivo(wc) || !this.win || this.win.isDestroyed() || !this.scheda(wc)) return { ok: false };
    const tipo = String((d && d.tipo) || '');
    const dati = d && d.dati && typeof d.dati === 'object' && !Array.isArray(d.dati) ? d.dati : {};
    if (!TIPI.has(tipo)) return { ok: false, error: 'tipo' };
    if (pesa(dati) > DATI_MAX_BYTE) return { ok: false, error: 'troppo', limite: DATI_MAX_BYTE };
    const s = this._strato(wc);
    if (!s) return { ok: false };
    clearTimeout(s.timerVuoto);
    const id = `r${++this.seq}`;
    const richiesta = { id, tipo, dati: this._datiPuliti(tipo, dati, sender, wc), pagina: this._pagina(wc) };
    if (tipo === 'modifica') s.inPagina.set(id, sender.frame || null);
    // Chi apre un riquadro scrive lì: la tastiera va allo strato appena c'è.
    s.vuoleTastiera = true;
    if (s.pronta) this._consegna(s, richiesta);
    else s.coda.push(richiesta);
    return { ok: true, id };
  }

  // Il riquadro si posa sulle misure della finestra dello strato: prima di aprirlo lo strato prende quelle della pagina,
  // o una risposta nata in uno strato largo zero sceglierebbe il lato sbagliato e non lo cambierebbe più.
  _consegna(s, richiesta) {
    const b = this._area(s.wc);
    if (b) {
      s.vista.setBounds(b);
      this._inCima(s);
    }
    this._manda(s, 'riquadri:apri', { ...richiesta, misura: b ? { w: b.width, h: b.height } : null });
  }

  _datiPuliti(tipo, dati, sender, wc) {
    const testo = (v) => String(v == null ? '' : v);
    if (tipo === 'feedback') return { testo: testo(dati.testo) };
    if (tipo === 'modifica') return { testo: testo(dati.testo) };
    if (tipo === 'redteam') return {};
    if (tipo === 'aiuto') {
      const c = dati.invocazione && typeof dati.invocazione === 'object' ? dati.invocazione : null;
      return { invocazione: c ? { source: testo(c.source), title: testo(c.title), url: testo(c.url) } : null };
    }
    let zoom = 1;
    try { zoom = wc.getZoomFactor() || 1; } catch (_) { zoom = 1; }
    let principale = true;
    try { principale = !sender.frame || !sender.frame.parent; } catch (_) { principale = true; }
    // Un riquadro incorporato conosce solo la sua finestra: l'ancora è l'ultimo punto del puntatore sulla scheda.
    let ancora = principale ? ancoraNellaVista(dati.anchor, zoom) : null;
    if (!principale) {
      const p = wc._filoUltimoPuntatore;
      if (p && Date.now() - p.alle < PUNTATORE_MS) ancora = { x: p.x, y: p.y, top: p.y, bottom: p.y };
    }
    return {
      action: testo(dati.action),
      payload: dati.payload && typeof dati.payload === 'object' ? dati.payload : {},
      title: testo(dati.title),
      anchor: ancora,
    };
  }

  _pagina(wc) {
    const s = this.scheda(wc) || {};
    let url = '';
    let origine = '';
    try { url = String(wc.getURL() || ''); origine = String(wc.mainFrame.origin || ''); } catch (_) {}
    return { url, origine, titolo: String(s.title || '') };
  }

  // Dallo strato: cosa ha aperto (posa e tastiera), un'azione sulla pagina (Sostituisci della Modifica), i gesti del vuoto.
  _dalloStrato(s, canale, d) {
    if (canale === 'riquadri:stato') {
      const prima = s.aperti;
      s.aperti = Math.max(0, Math.min(1000, Number(d && d.aperti) || 0));
      s.riquadri = Math.max(0, Math.min(1000, Number(d && d.riquadri) || 0));
      s.modale = !!(d && d.modale);
      // Un Aiuto chiuso mentre Filo risponde non si vede ma c'è: la sua risposta resta da aprire (#1432).
      s.aiuto = !!(d && d.aiuto);
      if (!s.aperti && prima) this._restituisci(s);
      clearTimeout(s.timerVuoto);
      const vuoto = () => !s.aperti && !s.aiuto;
      if (vuoto()) s.timerVuoto = setTimeout(() => { if (vuoto() && this.strati.get(s.wc) === s) this._butta(s); }, VUOTO_MS);
      this.posa();
      return;
    }
    if (canale === 'riquadri:in-pagina') {
      const id = String((d && d.id) || '');
      const frame = s.inPagina.get(id);
      if (!id || id.length > ID_MAX || !s.inPagina.has(id)) return;
      s.inPagina.delete(id);
      if (!d || d.cosa !== 'sostituisci' || typeof d.testo !== 'string' || pesa(d.testo) > DATI_MAX_BYTE) return;
      // Il testo va nel campo della pagina col fuoco già tornato a lei, come una battuta.
      this._restituisci(s, { forza: true });
      const dati = { type: msg().RIQUADRO_SOSTITUISCI, id, testo: d.testo };
      try {
        if (frame && !frame.detached) frame.send('filo:broadcast', dati);
        else s.wc.send('filo:broadcast', dati);
      } catch (_) {}
      return;
    }
    if (canale === 'riquadri:vuoto') s.vuoto.inoltra(d);
  }

  // L'Aiuto nello strato chiede alla pagina sotto (#1509.3): la domanda va al suo frame principale, che risponde con
  // AIUTO_ESITO. Una pagina che non risponde (andata via, ferma) dà un esito mancato, mai un'attesa senza fine.
  _allaPagina(s, op, args) {
    if (!Object.prototype.hasOwnProperty.call(OP_PAGINA, op) || !vivo(s.wc)) return Promise.resolve({ ok: false });
    if (pesa(args) > DATI_MAX_BYTE) return Promise.resolve({ ok: false, error: 'troppo', limite: DATI_MAX_BYTE });
    const rid = `a${++this.seq}`;
    return new Promise((fatto) => {
      let timer = null;
      const chiudi = (r) => { if (!s.attese.delete(rid)) return; clearTimeout(timer); fatto(r); };
      s.attese.set(rid, chiudi);
      timer = setTimeout(() => chiudi({ ok: false, error: 'tempo' }), OP_PAGINA[op]);
      try { s.wc.send('filo:broadcast', { type: msg().AIUTO_DALLO_STRATO, rid, op, args: args == null ? {} : args }); } catch (_) { chiudi({ ok: false }); }
    });
  }

  // AIUTO_ESITO dal frame principale della pagina.
  esitoDallaPagina(sender, d) {
    const s = sender && !sender.strato ? this.strati.get(sender.wc) : null;
    const principale = principaleDi(sender);
    const rid = String((d && d.rid) || '');
    if (!s || !principale || !rid || rid.length > ID_MAX || !s.attese.has(rid)) return { ok: false };
    if (pesa(d.esito) > DATI_MAX_BYTE) { s.attese.get(rid)({ ok: false, error: 'troppo', limite: DATI_MAX_BYTE }); return { ok: false }; }
    s.attese.get(rid)({ ok: true, esito: d.esito === undefined ? null : d.esito });
    return { ok: true };
  }

  // AIUTO_ALLO_STRATO dalla pagina: l'icona Aiuto premuta di nuovo, l'Aiuto spento, il passo evidenziato che la
  // cornice deve scoprire, il gesto dell'utente sul passo indicato. Senza un Aiuto vivo nello strato non va da nessuna parte.
  comandoAiuto(sender, d) {
    const s = sender && !sender.strato ? this.strati.get(sender.wc) : null;
    const comando = String((d && d.comando) || '');
    if (!s || !s.pronta || !s.aiuto || !COMANDI_AIUTO.has(comando) || !vivo(s.vista.webContents)) return { ok: false };
    // Il passo e la sua cornice stanno nel documento principale: un riquadro incorporato non li ha.
    if ((comando === 'evita' || comando === 'azione') && !principaleDi(sender)) return { ok: false };
    const out = { comando };
    if (comando === 'chiudi') out.davvero = !!d.davvero;
    if (comando === 'evita') {
      let zoom = 1;
      try { zoom = s.wc.getZoomFactor() || 1; } catch (_) { zoom = 1; }
      const r = {};
      for (const k of ['left', 'top', 'right', 'bottom']) {
        const v = numero(d.rect && d.rect[k]);
        if (v === undefined) return { ok: false };
        r[k] = v * zoom;
      }
      out.rect = r;
    }
    if (comando === 'azione') {
      out.id = Math.max(0, Math.min(1e9, Math.round(Number(d.id) || 0)));
      out.etichetta = String(d.etichetta == null ? '' : d.etichetta);
      out.daUrl = String(d.daUrl == null ? '' : d.daUrl);
      if (pesa(out) > DATI_MAX_BYTE) return { ok: false };
    }
    this._manda(s, 'riquadri:aiuto', out);
    return { ok: true };
  }

  // Chiamata dal layout: lo strato si vede solo sopra la sua pagina, quando è davanti e ha qualcosa aperto.
  posa() {
    if (!this.win || this.win.isDestroyed()) return;
    for (const s of this.strati.values()) {
      const b = s.pronta && s.aperti > 0 ? this._area(s.wc) : null;
      if (!b) { this._nascondi(s); continue; }
      s.vista.setBounds(b);
      this._inCima(s);
      if (!s.visibile) {
        s.visibile = true;
        s.vista.setVisible(true);
      }
      if (s.vuoleTastiera) { s.vuoleTastiera = false; this._tastiera(s); }
    }
  }

  inCima() {
    for (const s of this.strati.values()) if (s.visibile) this._inCima(s);
  }

  // Subito sopra la sua pagina: avvisi, conferme, barra e menu restano sopra, come sopra la pagina.
  _inCima(s) {
    const cv = this.win.contentView;
    let sotto = null;
    try { sotto = this.sopraA(s.wc); } catch (_) { sotto = null; }
    const figli = () => cv.children || [];
    const i = sotto ? figli().indexOf(sotto) : -1;
    const mia = figli().indexOf(s.vista);
    if (i < 0) {
      if (mia !== figli().length - 1) cv.addChildView(s.vista);
    } else if (mia !== i + 1) {
      if (mia >= 0) cv.removeChildView(s.vista);
      cv.addChildView(s.vista, figli().indexOf(sotto) + 1);
    }
  }

  _nascondi(s) {
    if (!s.visibile) return;
    s.visibile = false;
    const aveva = this._haTastiera(s);
    try { s.vista.setVisible(false); } catch (_) {}
    if (aveva) this._restituisci(s, { forza: true });
  }

  _area(wc) {
    let b = null;
    try { b = this.area(wc); } catch (_) { b = null; }
    return b && b.width > 0 && b.height > 0 ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
  }

  _haTastiera(s) {
    try { return WebContents.getFocusedWebContents() === s.vista.webContents; } catch (_) { return false; }
  }

  // Chi apre un riquadro ci scrive: lo strato prende la tastiera, anche da un menu o dalla barra laterale. Solo chi
  // scriveva nella barra in alto la tiene.
  _tastiera(s) {
    if (!this.win.isFocused() || !s.visibile) return;
    let col = null;
    try { col = WebContents.getFocusedWebContents(); } catch (_) { col = null; }
    const shell = this.win._filoShell && this.win._filoShell.webContents;
    if (col && (col === this.win.webContents || col === shell)) return;
    try { s.vista.webContents.focus(); } catch (_) {}
  }

  _restituisci(s, { forza = false } = {}) {
    if (!this.win || this.win.isDestroyed() || !this.win.isFocused() || !vivo(s.wc)) return;
    if (!forza && !this._haTastiera(s)) return;
    try { s.wc.focus(); } catch (_) {}
  }

  // Esc sulla pagina con un riquadro aperto lo chiude, prima di ogni altro uso del tasto (schermo intero compreso).
  tasto(wc, input) {
    const s = this.strati.get(wc);
    if (!s || !s.visibile || !s.riquadri || !input || input.type !== 'keyDown') return false;
    if (input.key !== 'Escape' && input.code !== 'Escape') return false;
    this._manda(s, 'riquadri:esc', {});
    return true;
  }

  // La scorciatoia che lavora sulla selezione va dove l'utente sta scrivendo o leggendo: nello strato, se ha la tastiera.
  conTastiera(wc) {
    const s = this.strati.get(wc);
    return s && s.visibile && this._haTastiera(s) ? s.vista.webContents : null;
  }

  // Quello che l'utente vede sopra la pagina: i gesti del vuoto delle viste più in alto vanno qui, non alla pagina.
  vistaSopra(wc) {
    const s = this.strati.get(wc);
    return s && s.visibile ? s.vista : null;
  }

  // Con un riquadro che copre la pagina (feedback, Modifica, red-team) la tastiera che torna alla scheda va a lui.
  tastieraPer(wc) {
    const s = this.strati.get(wc);
    return s && s.visibile && s.modale && vivo(s.vista.webContents) ? s.vista.webContents : null;
  }

  stato(wc) {
    const s = this.strati.get(wc);
    if (!s) return null;
    return {
      pronta: s.pronta, aperti: s.aperti, riquadri: s.riquadri, modale: s.modale, visibile: !!s.visibile,
      vista: vivo(s.vista.webContents) ? s.vista.webContents.id : null,
      bounds: s.vista.getBounds(),
      tastiera: this._haTastiera(s),
    };
  }

  _manda(s, canale, dati) {
    try { if (vivo(s.vista.webContents)) s.vista.webContents.send(canale, dati); } catch (_) {}
  }

  // Una pagina nuova, chiusa o morta si porta via i suoi riquadri, come quando stavano nel suo documento. Si segue da
  // quando la pagina nasce: il primo riquadro chiesto da un riquadro incorporato ha già bisogno dell'ultimo puntatore.
  segui(wc) {
    if (this.seguite.has(wc)) return;
    this.seguite.add(wc);
    const via = () => { const s = this.strati.get(wc); if (s) this._butta(s); };
    wc.once('destroyed', via);
    wc.on('render-process-gone', via);
    wc.on('did-navigate', via);
    // Il punto dove l'utente ha appena cliccato o selezionato: l'ancora di una risposta chiesta da un riquadro incorporato.
    wc.on('input-event', (_e, input) => {
      const t = input && input.type;
      if ((t === 'mouseDown' || t === 'mouseUp') && Number.isFinite(input.x) && Number.isFinite(input.y)) {
        wc._filoUltimoPuntatore = { x: input.x, y: input.y, alle: Date.now() };
      }
    });
  }

  _strato(wc) {
    const c = this.strati.get(wc);
    if (c && vivo(c.vista.webContents)) return c;
    if (c) this._butta(c);
    const { WebContentsView } = require('electron');
    const vista = new WebContentsView({
      webPreferences: {
        // Come le schede web: i riquadri nel mondo isolato, in sandbox; la pagina dello strato non ha né Node né lo shim.
        preload: percorsoDelPreload(PRELOAD),
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
    const s = {
      wc, vista, pronta: false, coda: [], aperti: 0, riquadri: 0, modale: false, visibile: false,
      vuoleTastiera: false, inPagina: new Map(),
    };
    s.vuoto = new VuotoDellaVista({
      vista: () => s.vista,
      scheda: () => (vivo(s.wc) ? this._vistaDellaPagina(s.wc) : null),
      canale: 'riquadri:cursore',
      primaDelClic: () => this._restituisci(s),
    });
    this.strati.set(wc, s);
    perVista.set(vista.webContents, { strato: this, s });
    this.segui(wc);
    const v = vista.webContents;
    v.setWindowOpenHandler(() => ({ action: 'deny' }));
    v.on('will-navigate', (e) => e.preventDefault());
    collegaScorciatoie(v, this.win);
    // Scrivendo in un riquadro i tasti del browser (chiudi, indietro, salto di scheda) e quelli dello zoom valgono come
    // nella pagina sotto: lo zoom è suo, anche col fuoco qui.
    v.on('before-input-event', (e, input) => {
      let preso = false;
      try { preso = vivo(s.wc) && (this.tastoDellaScheda(s.wc, input) || zoomDaTasto(s.wc, input)); } catch (_) { preso = false; }
      if (preso) e.preventDefault();
    });
    // Un gesto sui riquadri è dell'interfaccia di Filo: vale per ciò che Filo fa (appunti, il suo menu), mai per il sito.
    v.on('input-event', (_e, input) => {
      try { require('./services/permessiPagine').gestoNelloStrato(s.wc, input); } catch (_) {}
    });
    v.on('ipc-message', (_e, canale, dati) => {
      if (/^riquadri:(stato|in-pagina|vuoto)$/.test(canale)) this._dalloStrato(s, canale, dati);
    });
    v.on('ipc-message-sync', (e, canale) => {
      if (canale !== 'riquadri:chi') return;
      e.returnValue = vivo(s.wc) ? this._pagina(s.wc) : null;
    });
    v.once('did-finish-load', () => {
      // I px dello strato devono essere quelli della scheda: uno zoom rimasto sull'host «riquadri» li sposterebbe.
      try { v.setZoomFactor(1); } catch (_) {}
      s.pronta = true;
      for (const r of s.coda.splice(0)) this._consegna(s, r);
      this.posa();
    });
    // Ctrl+rotella sopra un riquadro zooma la pagina sotto, come quando il riquadro stava nel suo documento.
    v.on('zoom-changed', (_e, dir) => {
      try { v.setZoomFactor(1); } catch (_) {}
      if (vivo(s.wc)) rotellaZoom(s.wc, dir);
    });
    v.on('render-process-gone', () => this._butta(s));
    // Carica FUORI dalla finestra (ci entra alla prima posa): dentro si prenderebbe la tastiera di chi scrive.
    // L'ancora dice di quale pagina è: con più schede gli strati sono uguali.
    v.loadURL(`${INDIRIZZO}#${wc.id}`);
    return s;
  }

  _vistaDellaPagina(wc) {
    let sotto = null;
    try { sotto = this.sopraA(wc); } catch (_) { sotto = null; }
    return sotto || { webContents: wc, getBounds: () => ({ x: 0, y: 0 }) };
  }

  _butta(s) {
    clearTimeout(s.timerVuoto);
    if (this.strati.get(s.wc) === s) this.strati.delete(s.wc);
    const aveva = s.visibile && this._haTastiera(s);
    s.visibile = false;
    const v = s.vista;
    try { perVista.delete(v.webContents); } catch (_) {}
    try { if (this.win && !this.win.isDestroyed()) this.win.contentView.removeChildView(v); } catch (_) {}
    try { if (vivo(v.webContents)) v.webContents.close(); } catch (_) {}
    if (aveva) this._restituisci(s, { forza: true });
  }
}

// Chi sta sotto uno strato: la pagina per cui parla. null se il webContents non è uno strato dei riquadri.
function paginaDelloStrato(wc) {
  const r = wc ? perVista.get(wc) : null;
  if (!r || !vivo(r.s.wc)) return null;
  return { wc: r.s.wc, win: r.strato.win };
}

// Lo strato pronto sopra una pagina: le spinte che vanno alla pagina vanno anche a lui, ritagliate per lei.
function stratoDellaPagina(wc) {
  for (const [v, r] of perVista) if (r.s.wc === wc && r.s.pronta && vivo(v)) return v;
  return null;
}

module.exports = { StratoDeiRiquadri, paginaDelloStrato, stratoDellaPagina, ancoraNellaVista, INDIRIZZO, TIPI };
