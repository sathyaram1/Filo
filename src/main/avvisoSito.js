// Vista che disegna sopra la scheda attiva l'avviso del sito pericoloso o sospetto (#813.5), una per finestra.
// Non sta nel documento del sito: la pagina non ne sente i tasti, non la copre e non la cancella.
// Regole: patterns/un-avviso-su-una-pagina-non-sta-dentro-la-pagina.md

const path = require('node:path');

const LIVELLI = new Set(['pericoloso', 'sospetto']);
const SCELTE = new Set(['procedi', 'continua', 'indietro']);

const testo = (v) => (typeof v === 'string' ? v : String(v == null ? '' : v));
const coord = (v) => Math.max(-10000, Math.min(10000, Math.round(Number(v) || 0)));

class AvvisoSito {
  // schedaAttiva: la scheda del TabManager in primo piano (o null). scegli(tab, scelta, dati): un pulsante o una voce
  // del tasto destro. restituisciTastiera: tolto l'avviso, i tasti tornano alla scheda attiva.
  // inCima: dopo che l'avviso è salito, chi deve restargli sopra (la barra laterale) ci risale.
  // cambiata: la scheda coperta è cambiata (la barra spegne o riaccende le azioni della pagina).
  // input(wc, input): il puntatore sull'avviso, che la barra sente come quello sulla pagina.
  constructor(win, { schedaAttiva = () => null, scegli = () => {}, menu = () => [], restituisciTastiera = () => {}, inCima = () => {}, cambiata = () => {}, input = () => {} } = {}) {
    this.win = win;
    this.input = input;
    this.dopoInCima = inCima;
    this.cambiata = cambiata;
    this.schedaAttiva = schedaAttiva;
    this.scegli = scegli;
    this.vociMenu = menu;
    this.restituisciTastiera = restituisciTastiera;
    this.vista = null;
    this.pronta = false;
    this.su = null;
    this.inviato = null;
    this.nascosta = false;
    if (win && typeof win.once === 'function') win.once('closed', () => this._butta());
    // La finestra che torna in primo piano (un menu chiuso, un'altra app) ridà la tastiera all'avviso a schermo.
    if (win && typeof win.on === 'function') win.on('focus', () => setTimeout(() => this.prendiTastiera(), 0));
  }

  // La scheda che l'avviso copre adesso, o null.
  coperta() { return this.su; }

  webContents() {
    return this.su && this.vista && !this.vista.webContents.isDestroyed() ? this.vista.webContents : null;
  }

  // La shell nasconde la scheda attiva per un suo menu a tendina: l'avviso va via con lei e torna con lei.
  nascondi(on) {
    this.nascosta = !!on;
    this.posa();
  }

  // Chiamata dal layout delle schede e a ogni verdetto.
  posa() {
    const tab = this._daCoprire();
    // Nascosto sotto un menu della barra, l'avviso non rende la tastiera: la pagina sotto la riprenderebbe.
    if (!tab) { this._togli(!this.nascosta); return; }
    const vista = this._vista();
    if (!vista) return;
    vista.setBounds(tab.view.getBounds());
    this._inCima();
    vista.setVisible(true);
    const prima = this.su;
    this.su = tab;
    this._invia();
    if (prima !== tab) {
      this.prendiTastiera();
      this._cambiata();
    }
  }

  _cambiata() { try { this.cambiata(); } catch (_) {} }

  // I tasti di chi stava scrivendo nella pagina vanno all'avviso; la barra che scrive li tiene.
  prendiTastiera() {
    const wc = this.webContents();
    if (!wc || !this.win || this.win.isDestroyed() || !this.win.isFocused()) return;
    let col = null;
    try { col = require('electron').webContents.getFocusedWebContents(); } catch (_) {}
    if (col === wc || col === this.win.webContents) return;
    try { wc.focus(); } catch (_) {}
  }

  _daCoprire() {
    let tab = null;
    try { tab = this.schedaAttiva(); } catch (_) { tab = null; }
    if (!tab || this.nascosta || !tab.sbAvviso || !LIVELLI.has(tab.sbAvviso.level)) return null;
    const wc = tab.view && tab.view.webContents;
    if (!wc || wc.isDestroyed()) return null;
    const b = tab.view.getBounds();
    return b.width > 0 && b.height > 0 ? tab : null;
  }

  _togli(restituisci) {
    const era = this.su;
    this.su = null;
    const vista = this.vista;
    if (vista && !vista.webContents.isDestroyed()) {
      let aveva = false;
      try { aveva = require('electron').webContents.getFocusedWebContents() === vista.webContents; } catch (_) {}
      vista.setVisible(false);
      vista.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      if (era && aveva && restituisci) this.restituisciTastiera();
    }
    // Per ultima: chi la sente può far arrivare un verdetto che rimette l'avviso, e qui non va più nascosto.
    if (era) this._cambiata();
  }

  // Ogni scheda nuova entra in cima alle viste della finestra: l'avviso deve tornarle sopra.
  _inCima() {
    const cv = this.win.contentView;
    const figli = cv.children || [];
    if (figli[figli.length - 1] !== this.vista) cv.addChildView(this.vista);
    try { this.dopoInCima(); } catch (_) {}
  }

  _stato() {
    const tab = this.su;
    if (!tab || !tab.sbAvviso) return null;
    const a = tab.sbAvviso;
    const m = a.message || {};
    let host = '';
    try { host = new URL(a.url).hostname; } catch (_) {}
    return { scheda: testo(tab.id), level: a.level, title: testo(m.title), body: testo(m.body), host };
  }

  _invia() {
    if (!this.pronta || !this.vista || this.vista.webContents.isDestroyed()) return;
    const s = this._stato();
    if (!s) return;
    const chiave = JSON.stringify(s);
    if (chiave === this.inviato) return;
    this.inviato = chiave;
    this.giro = (this.giro || 0) + 1;
    try { this.vista.webContents.send('avviso-sito:stato', { ...s, giro: this.giro }); } catch (_) {}
  }

  _menu(d) {
    const tab = this.su;
    if (!tab || !this.vista || !this.win || this.win.isDestroyed()) return;
    const voci = this.vociMenu(tab) || [];
    if (!voci.length) return;
    const b = this.vista.getBounds();
    const { showPopupMenu } = require('./popup-menu');
    showPopupMenu(this.win, voci, b.x + coord(d && d.x), b.y + coord(d && d.y), (scelta) => {
      const m = /^@action:avviso-sito:([a-z-]{1,20})$/.exec(testo(scelta));
      if (!m || this.su !== tab) return;
      this.scegli(tab, m[1], {});
    });
  }

  // Tasti dell'avviso: quelli del browser (Ctrl+W, Alt+cifra, indietro…) li decide la scheda, come se li avesse lei.
  _tasto(event, input) {
    const tab = this.su;
    const wc = tab && tab.view && tab.view.webContents;
    if (!wc || wc.isDestroyed()) return;
    let fermato = false;
    try { wc.emit('before-input-event', { daAvvisoSito: true, preventDefault() { fermato = true; } }, input); } catch (_) {}
    if (fermato) event.preventDefault();
  }

  _vista() {
    if (this.vista && !this.vista.webContents.isDestroyed()) return this.vista;
    if (!this.win || this.win.isDestroyed()) return null;
    const { WebContentsView } = require('electron');
    const vista = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'avviso-sito-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    // Il fondo scuro lo disegna la sua pagina: quello della vista non si vede sopra un'altra vista. Mentre la pagina si
    // carica la scheda resta visibile, ma clic e tasti sono già della vista.
    vista.setBackgroundColor('#00000000');
    vista.setVisible(false);
    this.vista = vista;
    this.pronta = false;
    this.inviato = null;
    const wc = vista.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.on('before-input-event', (e, input) => this._tasto(e, input));
    wc.on('input-event', (_e, input) => { try { this.input(wc, input); } catch (_) {} });
    wc.on('ipc-message', (_e, canale, dati) => {
      const tab = this.su;
      if (!tab) return;
      // Un clic arrivato mentre l'avviso passava a un'altra scheda vale per quella che l'utente vedeva.
      if (!dati || testo(dati.scheda) !== testo(tab.id)) return;
      if (canale === 'avviso-sito:scelta') {
        const scelta = testo(dati && dati.scelta);
        if (SCELTE.has(scelta)) this.scegli(tab, scelta, { testo: testo(dati && dati.testo) });
      } else if (canale === 'avviso-sito:menu') {
        this._menu(dati);
      }
    });
    wc.once('did-finish-load', () => { this.pronta = true; this._invia(); this.prendiTastiera(); });
    wc.on('render-process-gone', () => { this._butta(); this.posa(); });
    // Da filo://shell come la shell: un file:// farebbe scattare chi controlla che nessuna vista apra file locali.
    wc.loadURL('filo://shell/avviso-sito.html');
    return vista;
  }

  _butta() {
    const vista = this.vista;
    this.vista = null;
    this.pronta = false;
    this.su = null;
    if (!vista) return;
    try { if (this.win && !this.win.isDestroyed()) this.win.contentView.removeChildView(vista); } catch (_) {}
    try { if (!vista.webContents.isDestroyed()) vista.webContents.close(); } catch (_) {}
  }
}

module.exports = { AvvisoSito };
