// Barra laterale dal bordo sinistro (#871), una per finestra: una vista sopra la scheda, stretta
// quanto la striscia d'indizio da chiusa e quanto il pannello da aperta. Un sito non ci arriva.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

const path = require('node:path');
const { collegaScorciatoie } = require('./shortcuts');
const Layout = require('./services/layoutIcone');

const STRISCIA = 4;
const PANNELLO = 56;
const OMBRA = 16;
// Il tempo dell'animazione di chiusura (barra.css): prima la vista resta larga, o il pannello sparisce di colpo.
const CHIUSURA_MS = 220;
const USCITA_MS = 400;
// Dopo un trascinamento dal menu la barra resta un attimo, per vedere dove è finita l'icona.
const DOPO_POSA_MS = 900;

const FISSE = new Set(['history', 'apps', 'redteam', 'settings', 'account']);
const MENU_DELLA_SHELL = new Set(['apps', 'settings', 'account']);
const PAGINE_FISSE = {
  history: 'filo://archive/archive.html',
  redteam: 'filo://redteam/redteam.html',
};
const FASI_FUORI = new Set(['muovi', 'rilascia', 'annulla']);
const NOME_VAR = /^--[a-z][a-z0-9-]*$/;

const numero = (v, min = -10000, max = 10000) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));
const testo = (v) => (typeof v === 'string' ? v : String(v == null ? '' : v));

class BarraLaterale {
  constructor(win, tabs, { alto = () => 0 } = {}) {
    this.win = win;
    this.tabs = tabs;
    this.alto = alto;
    this.vista = null;
    this.pronta = false;
    this.aperta = false;
    this.motivo = null;
    this.dentro = false;
    this.layout = null;
    this.tema = {};
    this.account = null;
    this.misure = [];
    this.mira = null;
    this.trascinamento = null;
    this.suggerimento = false;
    this.timer = { uscita: null, stringi: null, fine: null };
    this.ultimoNav = '';
    if (win && typeof win.once === 'function') win.once('closed', () => this._butta());
    Layout.leggi({ incognito: this._incognito() }).then((l) => this.disposizione(l)).catch(() => {});
  }

  _incognito() { return !!(this.win && this.win._filoIncognito); }

  // ── apertura e chiusura ──────────────────────────────────────────────────

  // motivo: 'spinta' | 'clic' | 'tasto' | 'trascina'. Da tastiera la barra prende il fuoco.
  apri(motivo = 'clic') {
    this._ferma('stringi');
    this._ferma('uscita');
    const giaAperta = this.aperta;
    this.aperta = true;
    if (!giaAperta || motivo === 'tasto') this.motivo = motivo;
    if (!giaAperta) this.dentro = false;
    this.posa();
    this._invia({ fuoco: motivo === 'tasto' });
    if (motivo === 'tasto' && this.vista) { try { this.vista.webContents.focus(); } catch (_) {} }
  }

  chiudi() {
    this._ferma('uscita');
    this._ferma('fine');
    if (!this.aperta) return;
    const avevaFuoco = this._haFuoco();
    this.aperta = false;
    this.motivo = null;
    this.dentro = false;
    this.mira = null;
    this._nascondiSuggerimento();
    this._invia();
    this._ferma('stringi');
    this.timer.stringi = setTimeout(() => { this.timer.stringi = null; if (!this.aperta) this.posa(); }, CHIUSURA_MS);
    if (avevaFuoco) this._restituisciTastiera();
  }

  commuta(motivo = 'clic') {
    if (this.aperta) this.chiudi();
    else this.apri(motivo);
  }

  // Tasto della barra ed Esc, da qualunque vista della finestra abbia il fuoco. true = preso.
  tasto(input) {
    if (!input || input.type !== 'keyDown') return false;
    const T = globalThis.SN_TASTI;
    if (T && T.comandoBarra(input)) {
      if (!input.isAutoRepeat) this.commuta('tasto');
      return true;
    }
    if (this.aperta && String(input.key || '') === 'Escape') {
      this.chiudi();
      return true;
    }
    return false;
  }

  // Input vero arrivato alla scheda o alla fila delle schede, cioè fuori dalla barra.
  inputAltrove(input) {
    if (!this.aperta || this.trascinamento || !input) return;
    if (input.type === 'mouseDown' && (input.button || 'left') === 'left') { this.chiudi(); return; }
    if (input.type === 'mouseMove' && this.motivo !== 'tasto') this._programmaUscita();
  }

  _programmaUscita() {
    if (this.timer.uscita || this.trascinamento) return;
    this.timer.uscita = setTimeout(() => {
      this.timer.uscita = null;
      if (!this.dentro && !this.trascinamento) this.chiudi();
    }, USCITA_MS);
  }

  _ferma(nome) {
    if (this.timer[nome]) { clearTimeout(this.timer[nome]); this.timer[nome] = null; }
  }

  _haFuoco() {
    try { return !!(this.vista && this.vista.webContents.isFocused()); } catch (_) { return false; }
  }

  _restituisciTastiera() {
    try { this.tabs._tastieraAllaSchedaAttiva(); } catch (_) {}
  }

  // ── posa e stato ─────────────────────────────────────────────────────────

  posa() {
    if (!this.win || this.win.isDestroyed()) return;
    const vista = this._vista();
    if (!vista) return;
    const [, H] = this.win.getContentSize();
    const y = Math.max(0, Math.round(this.alto()));
    const largo = this.aperta || this.timer.stringi;
    const w = largo ? PANNELLO + OMBRA : STRISCIA;
    vista.setBounds({ x: 0, y, width: w, height: Math.max(0, H - y) });
    this._inCima();
    vista.setVisible(true);
  }

  // Ogni scheda nuova entra in cima alle viste della finestra: la barra deve tornarle sopra.
  _inCima() {
    const cv = this.win.contentView;
    const figli = cv.children || [];
    if (figli[figli.length - 1] !== this.vista) cv.addChildView(this.vista);
  }

  disposizione(layout) {
    const D = globalThis.SN_DISPOSIZIONE_ICONE;
    if (!D || !D.valida(layout)) return;
    this.layout = { primary: [...layout.primary], secondary: [...layout.secondary], bar: [...(layout.bar || [])] };
    this._invia();
  }

  // La scheda è cambiata (navigazione, caricamento, schermo intero): si ridice solo se cambia qualcosa.
  aggiornaNav() {
    const n = JSON.stringify(this._nav());
    if (n === this.ultimoNav) return;
    this.ultimoNav = n;
    this._invia();
  }

  _nav() {
    const t = this._attiva();
    return {
      scheda: !!t,
      indietro: !!(t && t.canBack),
      avanti: !!(t && t.canFwd),
      schermoIntero: !!this.tabs.contentFullscreen,
    };
  }

  _attiva() {
    return this.tabs.tabs.find((t) => t.id === this.tabs.activeId) || null;
  }

  // Tema e profilo li tiene la shell, come per gli avvisi: qui arrivano già calcolati.
  dallaShell(dati) {
    const vars = {};
    const v = dati && dati.tema;
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) if (NOME_VAR.test(k) && typeof val === 'string') vars[k] = val;
    }
    this.tema = vars;
    const a = dati && dati.account;
    this.account = a && typeof a === 'object'
      ? { dentro: a.dentro === true, foto: testo(a.foto).slice(0, 2048), etichetta: testo(a.etichetta).slice(0, 200) }
      : null;
    this._invia();
  }

  _owner() {
    try { return !!require('./auth/google-auth').isAdmin(); } catch (_) { return false; }
  }

  _icone() {
    const D = globalThis.SN_DISPOSIZIONE_ICONE;
    const I18n = globalThis.SN_I18N;
    if (!D || !this.layout) return [];
    const nav = this._nav();
    const owner = this._owner();
    const out = [];
    for (const id of this.layout.bar) {
      const d = D.ICONE[id];
      if (!d || (d.soloOwner && !owner)) continue;
      let icona = d.icona;
      let chiave = d.etichetta;
      if (id === 'fullscreen' && nav.schermoIntero) { icona = 'shrink'; chiave = 'menu_exit_fullscreen'; }
      const spenta = (id === 'back' && !nav.indietro) || (id === 'forward' && !nav.avanti)
        || ((id === 'reload' || id === 'closeTab' || d.tipo === 'pagina') && !nav.scheda);
      out.push({ id, icona, etichetta: I18n ? I18n.t(chiave) : id, spenta, accesa: id === 'fullscreen' && nav.schermoIntero });
    }
    return out;
  }

  _stato() {
    const T = globalThis.SN_TASTI;
    return {
      aperta: this.aperta,
      tastiera: this.motivo === 'tasto',
      incognito: this._incognito(),
      icone: this._icone(),
      owner: this._owner(),
      account: this.account,
      tema: this.tema,
      mira: this.mira,
      trascinamento: !!this.trascinamento,
      tasto: T ? T.etichettaBarra() : 'Ctrl+Shift+B',
    };
  }

  _invia(extra = {}) {
    if (!this.pronta || !this.vista || this.vista.webContents.isDestroyed()) return;
    try { this.vista.webContents.send('barra:stato', { ...this._stato(), ...extra }); } catch (_) {}
  }

  // ── azioni ──────────────────────────────────────────────────────────────

  esegui(id) {
    const D = globalThis.SN_DISPOSIZIONE_ICONE;
    const d = D && D.noto(id) ? D.ICONE[id] : null;
    if (!d || !this.layout || !this.layout.bar.includes(id)) return;
    if (d.soloOwner && !this._owner()) return;
    const tabs = this.tabs;
    const attiva = this._attiva();
    if (d.tipo === 'pagina') {
      if (!attiva) return;
      this.chiudi();
      this._restituisciTastiera();
      const tipo = globalThis.SN_MSG?.MSG?.TOP_FRAME_COMMAND || 'top_frame_command';
      try { attiva.view.webContents.mainFrame.send('filo:broadcast', { type: tipo, iconId: id }); } catch (_) {}
      return;
    }
    const daTastiera = this.motivo === 'tasto';
    switch (id) {
      case 'back': tabs.navigaCronologia('indietro'); break;
      case 'forward': tabs.navigaCronologia('avanti'); break;
      case 'reload': if (attiva) tabs.reload(attiva.id); break;
      case 'home':
        if (attiva) tabs.navigate(attiva.id, 'filo://newtab/');
        else tabs.openTab('filo://newtab/');
        break;
      case 'newTab': tabs.openTab('filo://newtab/'); break;
      case 'closeTab': if (attiva) tabs.closeTab(attiva.id); break;
      case 'fullscreen': tabs.toggleContentFullscreen(); break;
      case 'incognito': try { require('./window').createIncognitoWindow(); } catch (_) {} break;
      case 'openOptions': tabs.openTab('filo://options/options.html'); break;
      case 'editorApp': tabs.openTab('filo://editor/editor.html'); break;
      case 'feedbackApp': tabs.openTab('filo://feedback/feedback.html'); break;
      default: return;
    }
    // Da tastiera si torna a chi scriveva; col mouse la barra resta finché il puntatore ci sta sopra.
    if (daTastiera) this.chiudi();
  }

  sistema(comando, dati) {
    if (!FISSE.has(comando)) return;
    if (PAGINE_FISSE[comando]) {
      this.tabs.openTab(PAGINE_FISSE[comando]);
      if (this.motivo === 'tasto') this.chiudi();
      return;
    }
    if (!MENU_DELLA_SHELL.has(comando) || !this.vista) return;
    const b = this.vista.getBounds();
    const anchor = { x: b.x + PANNELLO + 6, y: b.y + numero(dati && dati.y, 0, 10000) };
    try { this.win.webContents.send('shell:trigger-button', { command: comando, anchor }); } catch (_) {}
  }

  // Tasto destro su un'icona della barra: la sua azione, e la strada per rimetterla nel menu.
  _menu(dati) {
    const id = testo(dati && dati.id);
    const icona = this._icone().find((i) => i.id === id);
    if (!icona || !this.vista || !this.win || this.win.isDestroyed()) return;
    this._nascondiSuggerimento();
    const voci = [];
    if (!icona.spenta) voci.push({ label: icona.etichetta, action: 'barra:esegui' });
    voci.push({ label: 'Rimetti nel menu del tasto destro', action: 'barra:al-menu' });
    const b = this.vista.getBounds();
    const { showPopupMenu } = require('./popup-menu');
    this._ferma('uscita');
    this.dentro = true;
    showPopupMenu(this.win, voci, b.x + numero(dati.x, 0, 10000), b.y + numero(dati.y, 0, 10000), (scelta) => {
      const s = testo(scelta);
      if (s === '@action:barra:esegui') this.esegui(id);
      else if (s === '@action:barra:al-menu') Layout.posa({ id, target: 'secondary', beforeId: null }, { incognito: this._incognito() }).catch(() => {});
    });
  }

  _mostraSuggerimento(dati) {
    const t = testo(dati && dati.testo).slice(0, 300);
    if (!t || !this.vista || !this.win || this.win.isDestroyed()) { this._nascondiSuggerimento(); return; }
    const b = this.vista.getBounds();
    this.suggerimento = true;
    try { require('./popup-tooltip').showTooltip(this.win, t, b.x + numero(dati.x, 0, 10000), b.y + numero(dati.y, 0, 10000)); } catch (_) {}
  }

  _nascondiSuggerimento() {
    if (!this.suggerimento) return;
    this.suggerimento = false;
    try { require('./popup-tooltip').hideTooltip(); } catch (_) {}
  }

  // ── trascinamenti ────────────────────────────────────────────────────────

  // Da una scheda: il menu del tasto destro trascina un'icona verso la barra. La scheda ha il
  // puntatore per tutto il trascinamento, quindi le coordinate arrivano da lei (px della pagina).
  dallaScheda(msg, tabId) {
    const D = globalThis.SN_DISPOSIZIONE_ICONE;
    const fase = testo(msg.fase);
    const attiva = this._attiva();
    if (!attiva || attiva.id !== tabId) return { ok: false };
    let zoom = 1;
    try { zoom = attiva.view.webContents.getZoomFactor() || 1; } catch (_) { zoom = 1; }
    const yLocale = (y) => {
      const tb = attiva.view.getBounds();
      const vb = this.vista ? this.vista.getBounds() : { y: tb.y };
      return Math.round(tb.y + Number(y || 0) * zoom - vb.y);
    };
    if (fase === 'inizio') {
      const id = testo(msg.id);
      if (!D || !D.noto(id)) return { ok: false };
      this._ferma('fine');
      this.trascinamento = { id, tabId };
      if (!this.aperta) this.apri('trascina');
      else this._invia();
      return { ok: true, larghezza: Math.ceil((PANNELLO + 8) / zoom) };
    }
    if (!this.trascinamento || this.trascinamento.tabId !== tabId) return { ok: false };
    if (fase === 'sopra') {
      this.mira = msg.y == null ? null : { y: yLocale(msg.y) };
      this._invia();
      return { ok: true };
    }
    if (fase === 'posa') {
      const id = this.trascinamento.id;
      const beforeId = this._primaDi(yLocale(msg.y), id);
      this.mira = null;
      this.trascinamento.posata = true;
      Layout.posa({ id, target: 'bar', beforeId }, { incognito: this._incognito() }).catch(() => {});
      return { ok: true };
    }
    if (fase === 'fine') {
      const posata = !!this.trascinamento.posata;
      this.trascinamento = null;
      this.mira = null;
      this._invia();
      if (this.motivo === 'trascina' && !this.dentro) {
        this.timer.fine = setTimeout(() => { this.timer.fine = null; if (!this.dentro) this.chiudi(); }, posata ? DOPO_POSA_MS : 0);
      }
      return { ok: true };
    }
    return { ok: false };
  }

  // L'icona davanti alla quale posare, dalle misure che la barra ha mandato (px della vista).
  _primaDi(y, escluso) {
    for (const m of this.misure) {
      if (m.id === escluso) continue;
      if (y < (m.alto + m.basso) / 2) return m.id;
    }
    return null;
  }

  // Dalla barra: un'icona trascinata fuori dal pannello, sopra la pagina. La barra ha il puntatore
  // per tutto il gesto, e la scheda davanti ne riceve le coordinate per il suo menu aperto.
  _fuori(dati) {
    const fase = testo(dati && dati.fase);
    const id = testo(dati && dati.id);
    const D = globalThis.SN_DISPOSIZIONE_ICONE;
    const attiva = this._attiva();
    if (!FASI_FUORI.has(fase) || !D || !D.noto(id) || !attiva || !this.vista) return;
    let zoom = 1;
    try { zoom = attiva.view.webContents.getZoomFactor() || 1; } catch (_) { zoom = 1; }
    const vb = this.vista.getBounds();
    const tb = attiva.view.getBounds();
    const x = (vb.x + numero(dati.x) - tb.x) / zoom;
    const y = (vb.y + numero(dati.y) - tb.y) / zoom;
    const tipo = globalThis.SN_MSG?.MSG?.BARRA_FUORI || 'barra_fuori';
    try { attiva.view.webContents.mainFrame.send('filo:broadcast', { type: tipo, fase, id, x, y }); } catch (_) {}
  }

  // ── la vista ─────────────────────────────────────────────────────────────

  _messaggio(canale, dati) {
    const d = dati && typeof dati === 'object' ? dati : {};
    switch (canale) {
      case 'barra:pronta': this.pronta = true; this._invia(); break;
      case 'barra:spinta': if (!this.aperta) this.apri('spinta'); break;
      case 'barra:apri': if (!this.aperta) this.apri('clic'); break;
      case 'barra:chiudi': this.chiudi(); break;
      case 'barra:dentro':
        this.dentro = true;
        this._ferma('uscita');
        this._ferma('fine');
        if (this.motivo === 'tasto' && !this._haFuoco()) this.motivo = 'clic';
        break;
      case 'barra:fuori':
        this.dentro = false;
        this._nascondiSuggerimento();
        if (this.aperta && (this.motivo !== 'tasto' || !this._haFuoco())) this._programmaUscita();
        break;
      case 'barra:azione': this.esegui(testo(d.id)); break;
      case 'barra:sistema': this.sistema(testo(d.comando), d); break;
      case 'barra:menu': this._menu(d); break;
      case 'barra:suggerimento': this._mostraSuggerimento(d); break;
      case 'barra:misure':
        this.misure = (Array.isArray(d.icone) ? d.icone : []).slice(0, 200)
          .map((m) => ({ id: testo(m && m.id), alto: numero(m && m.alto), basso: numero(m && m.basso) }))
          .filter((m) => m.id);
        break;
      case 'barra:posa': {
        const D = globalThis.SN_DISPOSIZIONE_ICONE;
        const id = testo(d.id);
        if (!D || !D.noto(id)) break;
        const beforeId = d.beforeId ? testo(d.beforeId) : null;
        Layout.posa({ id, target: 'bar', beforeId }, { incognito: this._incognito() }).catch(() => {});
        break;
      }
      case 'barra:trascina-fuori': this._fuori(d); break;
      default: break;
    }
  }

  _vista() {
    if (this.vista && !this.vista.webContents.isDestroyed()) return this.vista;
    if (!this.win || this.win.isDestroyed()) return null;
    const { WebContentsView } = require('electron');
    const vista = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'barra-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    vista.setBackgroundColor('#00000000');
    vista.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    this.vista = vista;
    this.pronta = false;
    const wc = vista.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    // Il fuoco è della barra solo quando la si apre da tastiera: un clic lo rende a chi scriveva.
    wc.on('focus', () => setTimeout(() => { if (this.motivo !== 'tasto') this._restituisciTastiera(); }, 0));
    wc.on('before-input-event', (event, input) => {
      if (this.tasto(input)) event.preventDefault();
    });
    collegaScorciatoie(wc, this.win);
    wc.on('ipc-message', (_e, canale, dati) => this._messaggio(canale, dati));
    wc.on('render-process-gone', () => this._butta({ rinasci: true }));
    wc.loadURL('filo://shell/barra.html' + (this._incognito() ? '?incognito=1' : ''));
    return vista;
  }

  _butta({ rinasci = false } = {}) {
    const vista = this.vista;
    this.vista = null;
    this.pronta = false;
    for (const k of Object.keys(this.timer)) this._ferma(k);
    this._nascondiSuggerimento();
    if (vista) {
      try { if (this.win && !this.win.isDestroyed()) this.win.contentView.removeChildView(vista); } catch (_) {}
      try { if (!vista.webContents.isDestroyed()) vista.webContents.close(); } catch (_) {}
    }
    this.aperta = false;
    this.motivo = null;
    if (rinasci && this.win && !this.win.isDestroyed()) setTimeout(() => this.posa(), 0);
  }
}

module.exports = { BarraLaterale, STRISCIA, PANNELLO };
