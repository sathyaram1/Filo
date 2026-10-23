// Pillola «<sito> è a schermo intero · Esc per uscire» sopra la pagina che si è presa lo schermo pieno (#1526), una
// per finestra: nel documento del sito la pagina la coprirebbe o la imiterebbe. Non tiene né fuoco né tasti.
// Regole: patterns/un-avviso-su-una-pagina-non-sta-dentro-la-pagina.md

const path = require('node:path');
const { VuotoDellaVista } = require('./vuotoDellaVista');

// Il puntatore entro questi pixel dal bordo alto la fa ricomparire.
const BORDO_ALTO_PX = 2;
// Uscendo dalla pillola col puntatore, quanto resta ancora al massimo.
const DOPO_IL_PUNTATORE_MS = 1500;

const testo = (v) => (typeof v === 'string' ? v : String(v == null ? '' : v));
const lato = (v) => Math.max(0, Math.min(10000, Math.round(Number(v) || 0)));
const coord = (v) => Math.max(-10000, Math.min(10000, Math.round(Number(v) || 0)));

// Come si chiama chi c'è a quell'indirizzo: l'host (punycode, come lo dà URL), o il tipo di pagina se non ne ha uno.
function nomeDi(url) {
  let u = null;
  try { u = new URL(testo(url)); } catch (_) { u = null; }
  if (u && u.protocol === 'blob:') {
    try { u = new URL(u.origin); } catch (_) { u = null; }
  }
  if (!u) return { tipo: 'senza' };
  if (u.protocol === 'http:' || u.protocol === 'https:') return u.hostname ? { host: u.hostname } : { tipo: 'senza' };
  if (u.protocol === 'file:') return { tipo: 'file' };
  if (u.protocol === 'filo:') return { tipo: 'filo' };
  if (u.protocol === 'about:') return { tipo: 'about' };
  return { tipo: 'senza' };
}

const CHIAVE_TIPO = { file: 'schermo_pieno_file', filo: 'schermo_pieno_filo' };

function stringa(chiave) {
  const S = globalThis.SN_I18N && globalThis.SN_I18N.STRINGS;
  return (S && typeof S[chiave] === 'string' && S[chiave]) || chiave;
}

function pezzo(n) {
  if (n.host) return { t: n.host, sito: true };
  return { t: stringa(CHIAVE_TIPO[n.tipo] || 'schermo_pieno_senza_indirizzo') };
}

// Il modello con i suoi %s, a pezzi: i nomi restano pezzi a sé, così la vista li scrive come testo e mai come markup.
function riempi(modello, sostituti) {
  const pezzi = testo(modello).split('%s');
  const out = [];
  pezzi.forEach((p, i) => {
    if (p) out.push({ t: p });
    if (i < pezzi.length - 1 && sostituti[i]) out.push(sostituti[i]);
  });
  return out;
}

// La frase della pillola. `chiede`: l'indirizzo del frame che ha chiesto lo schermo (un riquadro di un altro sito si
// nomina accanto alla pagina); un about: eredita il sito di chi l'ha scritto, quindi vale la pagina.
function partiDellAvviso(urlPagina, urlChiede = '', tasto = 'Esc') {
  const pagina = nomeDi(urlPagina);
  const chiede = urlChiede ? nomeDi(urlChiede) : pagina;
  const chiave = (n) => (n.host ? `h:${n.host}` : `t:${n.tipo}`);
  const altro = chiede.tipo !== 'about' && chiave(chiede) !== chiave(pagina);
  const frase = altro
    ? riempi(stringa('schermo_pieno_riquadro'), [pezzo(chiede), pezzo(pagina)])
    : riempi(stringa('schermo_pieno_sito'), [pezzo(pagina)]);
  const primo = frase[0];
  if (primo && !primo.sito && primo.t) frase[0] = { ...primo, t: primo.t.charAt(0).toUpperCase() + primo.t.slice(1) };
  return [...frase, { t: ' · ' }, ...riempi(stringa('schermo_pieno_esci'), [{ t: testo(tasto) || 'Esc', tasto: true }])];
}

class AvvisoSchermoPieno {
  // area(): dove sta la scheda che si vede a schermo pieno (o null); sotto(): la vista che l'utente vede sotto, dove
  // vanno i gesti del vuoto. esci(): lo schermo intero si spegne; regola(): apre la durata in Preferenze.
  constructor(win, { area = () => null, sotto = () => null, restituisciTastiera = () => {}, dopoInCima = () => {}, esci = () => {}, regola = () => {} } = {}) {
    this.win = win;
    this.area = area;
    this.sotto = sotto;
    this.restituisciTastiera = restituisciTastiera;
    this.dopoInCima = dopoInCima;
    this.esci = esci;
    this.regola = regola;
    this.vista = null;
    this.pronta = false;
    this.attivo = false;
    this.giro = 0;
    this.parti = null;
    this.durata = 3000;
    this.tema = null;
    this.misura = { giro: 0, w: 0, h: 0 };
    this.timer = null;
    this.armato = false;
    this.sopra = false;
    this.vuoto = new VuotoDellaVista({
      vista: () => this.vista,
      scheda: () => this._sotto(),
      canale: 'schermo-pieno:cursore',
      primaDelClic: () => this.restituisciTastiera(),
    });
    if (win && typeof win.once === 'function') win.once('closed', () => this._butta());
  }

  // In vista adesso (posata e visibile).
  mostrata() {
    return !!(this.attivo && this.vista && !this.vista.webContents.isDestroyed() && this.vista.getBounds().width > 0);
  }

  // La durata e il tema si leggono a ogni avviso: un cambio in Preferenze vale dal prossimo.
  async mostra(parti) {
    const giro = ++this.giro;
    this._ferma();
    this.armato = false;
    this.sopra = false;
    this.attivo = true;
    this.parti = Array.isArray(parti) ? parti.map((p) => ({ t: testo(p && p.t), ...(p && p.sito ? { sito: true } : {}), ...(p && p.tasto ? { tasto: true } : {}) })) : [];
    let s = {};
    try { s = (await globalThis.SN_STORAGE?.getSettings?.()) || {}; } catch (_) { s = {}; }
    if (giro !== this.giro || !this.attivo) return;
    const C = globalThis.SN_CONST;
    this.durata = C && C.opzioniAvvisoSchermoPieno ? C.opzioniAvvisoSchermoPieno(s.avvisoSchermoPieno).durataMs : 3000;
    try { this.tema = require('./confermeSopraPagina').temaDi(s); } catch (_) { this.tema = null; }
    if (!this._vista()) return;
    this._invia();
    this.posa();
  }

  // Il puntatore sul bordo alto: torna la frase di quella scheda, e se è già lì riparte il suo tempo.
  ricompari(parti) {
    if (!Array.isArray(parti) || !parti.length) return;
    if (this.attivo && this.parti && JSON.stringify(parti) === JSON.stringify(this.parti)) {
      if (this.mostrata() && !this.sopra) this._arma(this.durata);
      return;
    }
    this.mostra(parti);
  }

  nascondi() {
    this.giro++;
    this.attivo = false;
    this.sopra = false;
    this._ferma();
    this._togli();
  }

  // Chiamata dal layout delle schede e a ogni misura della pillola.
  posa() {
    const vista = this.vista;
    if (!vista || vista.webContents.isDestroyed() || !this.win || this.win.isDestroyed()) return;
    let a = null;
    try { a = this.attivo && this.pronta ? this.area() : null; } catch (_) { a = null; }
    const m = this.misura.giro === this.giro ? this.misura : { w: 0, h: 0 };
    if (!a || !(a.width > 0) || !(a.height > 0) || !m.w || !m.h) { this._togli(); return; }
    const w = Math.min(m.w, a.width);
    const h = Math.min(m.h, a.height);
    // In cima alla scheda: il margine attorno alla pillola (l'ombra) è della pagina, che ne riceve i gesti.
    vista.setBounds({ x: a.x + Math.round((a.width - w) / 2), y: a.y, width: w, height: h });
    this._inCima();
    vista.setVisible(true);
    const sotto = this._sotto();
    if (sotto) this.vuoto.segui(sotto.webContents);
    // Il tempo parte quando la pillola si vede, non quando è stata chiesta: la prima vista della finestra carica.
    if (!this.armato) { this.armato = true; this._arma(this.durata); }
  }

  // #1526 — dalla scheda: il puntatore è arrivato sul bordo alto?
  sulBordoAlto(input) {
    const y = Number(input && input.y);
    return !!input && input.type === 'mouseMove' && Number.isFinite(y) && y <= BORDO_ALTO_PX;
  }

  _arma(ms) {
    this._ferma();
    const giro = this.giro;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (giro === this.giro && !this.sopra) this.nascondi();
    }, Math.max(0, Number(ms) || 0));
    try { this.timer.unref?.(); } catch (_) {}
  }

  _ferma() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  _sotto() {
    let v = null;
    try { v = this.sotto(); } catch (_) { v = null; }
    return v && v.webContents && !v.webContents.isDestroyed() ? v : null;
  }

  _togli() {
    const vista = this.vista;
    if (!vista || vista.webContents.isDestroyed()) return;
    let aveva = false;
    try { aveva = require('electron').webContents.getFocusedWebContents() === vista.webContents; } catch (_) {}
    vista.setVisible(false);
    vista.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    if (aveva) this.restituisciTastiera();
  }

  // Ogni scheda nuova entra in cima alle viste della finestra: la pillola deve tornarle sopra.
  _inCima() {
    const cv = this.win.contentView;
    const figli = cv.children || [];
    if (figli[figli.length - 1] !== this.vista) cv.addChildView(this.vista);
    try { this.dopoInCima(); } catch (_) {}
  }

  _invia() {
    if (!this.pronta || !this.vista || this.vista.webContents.isDestroyed() || !this.attivo) return;
    let max = 640;
    try {
      const a = this.area();
      const larga = a && a.width > 0 ? a.width : (this.win.getContentSize()[0] || 0);
      max = Math.max(160, larga - 32);
    } catch (_) {}
    let vars = {};
    try { vars = require('./movimento').variabili(); } catch (_) {}
    try { this.vista.webContents.send('schermo-pieno:stato', { giro: this.giro, parti: this.parti, max, tema: this.tema, vars }); } catch (_) {}
  }

  _menu(d) {
    if (!this.mostrata() || !this.win || this.win.isDestroyed()) return;
    const T = (k) => stringa(k);
    const voci = [
      { label: T('schermo_pieno_menu_esci'), icon: 'close', action: 'schermo-pieno:esci' },
      { label: T('schermo_pieno_menu_regola'), action: 'schermo-pieno:regola' },
    ];
    const b = this.vista.getBounds();
    const { showPopupMenu } = require('./popup-menu');
    // Le voci valgono anche se intanto la pillola è scaduta: il menu è una finestra sua.
    showPopupMenu(this.win, voci, b.x + coord(d && d.x), b.y + coord(d && d.y), (scelta) => {
      const s = testo(scelta);
      if (s === '@action:schermo-pieno:esci') this.esci();
      else if (s === '@action:schermo-pieno:regola') this.regola();
    });
  }

  _vista() {
    if (this.vista && !this.vista.webContents.isDestroyed()) return this.vista;
    if (!this.win || this.win.isDestroyed()) return null;
    const { WebContentsView } = require('electron');
    const vista = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'schermo-pieno-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        // Nasce nascosta: senza, il primo disegno potrebbe restare fermo fino a che si vede.
        backgroundThrottling: false,
      },
    });
    vista.setBackgroundColor('#00000000');
    vista.setVisible(false);
    vista.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    this.vista = vista;
    this.pronta = false;
    this.misura = { giro: 0, w: 0, h: 0 };
    const wc = vista.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    // La tastiera non è sua: l'Esc deve arrivare alla guardia della scheda (#648). Un clic gliela dà, e torna
    // subito alla scheda, al giro dopo: durante l'evento il fuoco risulta ancora a chi l'aveva.
    wc.on('focus', () => setTimeout(() => this.restituisciTastiera(), 0));
    // Nel millisecondo in cui il fuoco è suo, l'Esc vale quello della barra: esce subito.
    wc.on('before-input-event', (e, input) => {
      if (input && input.type === 'keyDown' && String(input.key || '') === 'Escape') { e.preventDefault(); this.esci(); }
    });
    try { require('./shortcuts').collegaScorciatoie(wc, this.win); } catch (_) {}
    wc.on('ipc-message', (_e, canale, dati) => {
      const giro = Number(dati && dati.giro) || 0;
      if (canale === 'schermo-pieno:misura') {
        this.misura = { giro, w: lato(dati && dati.w), h: lato(dati && dati.h) };
        this.posa();
        return;
      }
      if (canale === 'schermo-pieno:inoltra') { this.vuoto.inoltra(dati); return; }
      // Un clic arrivato per una pillola che non c'è più (o per quella di prima) non vale.
      if (giro !== this.giro || !this.mostrata()) return;
      if (canale === 'schermo-pieno:clic') this.esci();
      else if (canale === 'schermo-pieno:menu') this._menu(dati);
      else if (canale === 'schermo-pieno:sopra') {
        this.sopra = !!(dati && dati.sopra === true);
        if (this.sopra) this._ferma();
        else this._arma(Math.min(this.durata, DOPO_IL_PUNTATORE_MS));
      }
    });
    wc.once('did-finish-load', () => { this.pronta = true; this._invia(); });
    // Se la vista muore, il prossimo avviso ne fa nascere un'altra.
    wc.on('render-process-gone', () => this._butta());
    // Carica FUORI dalla finestra (ci entra alla prima posa): dentro si prenderebbe la tastiera della pagina.
    // Da filo://shell come la shell: un file:// farebbe scattare chi controlla che nessuna vista apra file locali.
    wc.loadURL('filo://shell/schermo-pieno.html');
    return vista;
  }

  _butta() {
    const vista = this.vista;
    this.vista = null;
    this.pronta = false;
    this._ferma();
    if (!vista) return;
    try { if (this.win && !this.win.isDestroyed()) this.win.contentView.removeChildView(vista); } catch (_) {}
    try { if (!vista.webContents.isDestroyed()) vista.webContents.close(); } catch (_) {}
  }
}

module.exports = { AvvisoSchermoPieno, partiDellAvviso, nomeDi };
