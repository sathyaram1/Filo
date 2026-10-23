// Il bordo destro delle pagine di Filo che hanno un pannello (#1433): la sosta del puntatore, la striscia che si
// accende mentre aspetta, il tasto e la chiusura di chi se ne va senza entrare. Il pannello lo disegna la pagina.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

// Le stesse misure della barra di sinistra (barraLaterale.js): la fascia del sistema e la zona di chi si avvicina.
const BORDO = 5;
const VICINO = 24;
const SONDA_MS = 50;
const SONDA_LONTANO_MS = 150;
const QUIETE_MS = 600;
// Sul bordo destro sta la barra di scorrimento: chi scorre in verticale la sta mirando. Conta solo il puntatore fermo,
// con il tremolio di una mano appoggiata al mouse.
const TREMOLIO = 2;

const opzioniDi = (v) => (globalThis.SN_CONST && globalThis.SN_CONST.opzioniPannelloDestro
  ? globalThis.SN_CONST.opzioniPannelloDestro(v)
  : { spinta: true, attesaMs: 250, uscitaMs: 400, striscia: true, bloccato: false });

class BordoDestro {
  // `barra`: la barra laterale della stessa finestra, da cui arrivano i gesti della pagina e della fila delle schede.
  constructor(barra) {
    this.barra = barra;
    this.win = barra.win;
    this.tabs = barra.tabs;
    this.alto = barra.alto;
    this.opzioni = opzioniDi(null);
    this.bordo = false;
    this.bordoDal = 0;
    this.ultimo = null;
    this.puntoFermo = null;
    this.quieteFino = 0;
    this.ultimaSonda = 0;
    this.schedaAccesa = null;
    this.timer = { sonda: null, uscita: null };
    const win = this.win;
    if (win && typeof win.on === 'function') {
      const quiete = () => { this.quieteFino = Date.now() + QUIETE_MS; this.puntoFermo = this._punto(); this._segnaBordo(false); this._guarda(); };
      for (const ev of ['will-resize', 'resize', 'move']) win.on(ev, quiete);
      for (const ev of ['focus', 'show', 'restore']) win.on(ev, () => this._guarda());
    }
    if (win && typeof win.once === 'function') win.once('closed', () => { for (const k of Object.keys(this.timer)) this._ferma(k); });
  }

  impostazioni(v) {
    this.opzioni = opzioniDi(v);
    if (!this.opzioni.spinta) { this._ferma('sonda'); this._segnaBordo(false); } else this._guarda();
  }

  // La scheda davanti, se ha un pannello e l'utente la vede (sotto l'avviso del sito il bordo è dell'avviso).
  _scheda() {
    const t = this._lista().find((x) => x.id === this.tabs.activeId) || null;
    if (!t || !t.pannelloApp || !t.view) return null;
    if (typeof this.tabs.vistaSottoIlVuoto === 'function' && this.tabs.vistaSottoIlVuoto() !== t.view) return null;
    return t;
  }

  _lista() { return (this.tabs && Array.isArray(this.tabs.tabs)) ? this.tabs.tabs : []; }

  // ── dalla pagina ─────────────────────────────────────────────────────────

  statoDallaScheda(tab) {
    const p = tab && tab.pannelloApp;
    if (!p || !p.aperto || p.dentro) this._ferma('uscita');
    if (tab && tab.id === this.tabs.activeId) {
      if (p && p.aperto) this._segnaBordo(false);
      this._guarda();
    }
  }

  // Cambio di scheda, navigazione, avviso del sito: il bordo riparte da capo per quella davanti.
  aggiorna() {
    const t = this._scheda();
    if (this.schedaAccesa && (!t || t.id !== this.schedaAccesa)) this._segnaBordo(false);
    if (!t) { this._ferma('sonda'); this._ferma('uscita'); return; }
    this._guarda();
  }

  // Input vero della scheda sotto la barra (barra.inputAltrove) e della fila delle schede.
  input(input) {
    if (!input) return;
    if (input.type === 'mouseLeave') this._guarda();
    else if (input.type === 'mouseMove') this._forseBordo();
  }

  inputDellaShell(input) {
    if (input && (input.type === 'mouseMove' || input.type === 'mouseLeave')) this._guarda();
  }

  // Il tasto del pannello, da qualunque vista della finestra abbia il fuoco. true = preso; sui siti passa.
  tasto(input) {
    if (!input || input.type !== 'keyDown') return false;
    const T = globalThis.SN_TASTI;
    if (!T || !T.comandoPannello(input)) return false;
    const t = this._scheda();
    if (!t) return false;
    if (!input.isAutoRepeat) this.comanda(t, 'commuta', 'tasto');
    return true;
  }

  // Dalla chat, dal menu dei tasti su Mac: la scheda davanti, se ha il pannello. false se non c'è.
  comandaDavanti(azione, motivo = 'chat') {
    const t = this._scheda();
    if (!t) return false;
    this.comanda(t, azione, motivo);
    return true;
  }

  comanda(tab, azione, motivo = '') {
    if (azione === 'apri' || azione === 'commuta') this._segnaBordo(false);
    if (azione === 'apri' && tab.pannelloApp) {
      tab.pannelloApp = { ...tab.pannelloApp, aperto: true, dentro: false, motivo };
      if (motivo === 'spinta') this._sonda();
    }
    this._manda(tab, { azione, motivo });
  }

  _manda(tab, dati) {
    const tipo = globalThis.SN_MSG?.MSG?.PANNELLO_APP_COMANDO || 'pannello_app_comando';
    try { tab.view.webContents.mainFrame.send('filo:broadcast', { type: tipo, ...dati }); } catch (_) {}
  }

  // ── il bordo che la pagina non vede ──────────────────────────────────────

  _forseBordo() {
    if (this.timer.sonda) return;
    const ora = Date.now();
    if (ora - this.ultimaSonda < 40) return;
    this.ultimaSonda = ora;
    if (this._puntatore().dove !== 'lontano') this._guarda();
  }

  _guarda() {
    if (this.timer.sonda || !this._guardabile()) return;
    const t = this._scheda();
    if (!t) return;
    const p = t.pannelloApp;
    if (p.aperto ? (p.motivo !== 'spinta' || p.dentro) : !this.opzioni.spinta) return;
    this._sonda(0);
  }

  _guardabile() {
    return !!(this.win && !this.win.isDestroyed() && this.win.isVisible() && !this.win.isMinimized());
  }

  _sonda(dopo = SONDA_MS) {
    this._ferma('sonda');
    this.timer.sonda = setTimeout(() => {
      this.timer.sonda = null;
      const t = this._scheda();
      if (!t || !this._guardabile()) { this._segnaBordo(false); return; }
      const { dove, punto, nellaPagina } = this._puntatore();
      const p = t.pannelloApp;
      if (p.aperto) {
        // Aperto dal bordo: chi se ne va senza passare dal pannello lo chiude, come uscendo.
        if (p.motivo !== 'spinta' || p.dentro) return;
        if (dove === 'lontano') this._programmaUscita(t);
        else { this._ferma('uscita'); this._sonda(); }
        return;
      }
      if (!this.opzioni.spinta) { this._segnaBordo(false); return; }
      const quiete = Date.now() < this.quieteFino;
      if (quiete && punto) this.puntoFermo = punto;
      const b = this.barra;
      const fermo = !!b.trascinamento || b.tasti.scheda || b.tasti.shell || quiete;
      if (dove === 'bordo' && !fermo && this._mosso(punto)) {
        if (!this.ultimo || Math.abs(punto.x - this.ultimo.x) > TREMOLIO || Math.abs(punto.y - this.ultimo.y) > TREMOLIO) {
          this.ultimo = punto;
          this.bordoDal = Date.now();
        }
        this._segnaBordo(true, t);
        if (Date.now() - this.bordoDal >= this.opzioni.attesaMs) { this.comanda(t, 'apri', 'spinta'); return; }
      } else {
        this._segnaBordo(false);
      }
      if (dove === 'lontano' && nellaPagina) return;
      this._sonda(dove === 'lontano' ? SONDA_LONTANO_MS : SONDA_MS);
    }, dopo);
  }

  _programmaUscita(tab) {
    if (this.timer.uscita) return;
    this.timer.uscita = setTimeout(() => {
      this.timer.uscita = null;
      const p = tab.pannelloApp;
      if (!p || !p.aperto || p.dentro || p.motivo !== 'spinta') return;
      if (this._puntatore().dove !== 'lontano') { this._sonda(); return; }
      this._manda(tab, { azione: 'chiudi', motivo: 'uscita' });
    }, this.opzioni.uscitaMs);
  }

  // Dopo un rilascio, un ridimensionamento o una chiusura il bordo conta solo quando il puntatore si muove.
  _mosso(p) {
    const f = this.puntoFermo;
    if (!f || !p) return true;
    if (p.x === f.x && p.y === f.y) return false;
    this.puntoFermo = null;
    return true;
  }

  rilascio() {
    this.puntoFermo = this._punto();
    this._guarda();
  }

  _punto() {
    try { return require('electron').screen.getCursorScreenPoint(); } catch (_) { return null; }
  }

  // 'bordo' negli ultimi pixel a destra, 'vicino' a due passi, 'lontano' altrove: la fila delle schede (riduci,
  // ingrandisci, chiudi), fuori dalla finestra, un altro schermo. nellaPagina: sopra la scheda.
  _puntatore() {
    const via = { dove: 'lontano', punto: null, nellaPagina: false };
    if (!this._guardabile()) return via;
    let p = null;
    let cb = null;
    try {
      p = require('electron').screen.getCursorScreenPoint();
      cb = this.win.getContentBounds();
    } catch (_) { return via; }
    const alto = cb.y + Math.max(0, Math.round(this.alto()));
    const dx = cb.x + cb.width - 1 - p.x;
    const inAltezza = p.y >= alto && p.y < cb.y + cb.height;
    const nellaPagina = inAltezza && p.x >= cb.x && dx >= BORDO;
    if (!inAltezza || dx < 0 || dx >= VICINO) return { dove: 'lontano', punto: p, nellaPagina };
    return { dove: dx < BORDO ? 'bordo' : 'vicino', punto: p, nellaPagina };
  }

  _segnaBordo(v, tab = null) {
    if (!v) { this.bordoDal = 0; this.ultimo = null; }
    if (this.bordo === !!v) return;
    this.bordo = !!v;
    const t = v ? tab : this._lista().find((x) => x.id === this.schedaAccesa);
    this.schedaAccesa = v && tab ? tab.id : null;
    if (t && t.view) this._manda(t, { azione: 'bordo', acceso: !!v });
  }

  _ferma(nome) {
    if (this.timer[nome]) { clearTimeout(this.timer[nome]); this.timer[nome] = null; }
  }

  // Lo stato per le prove e per chi lo chiede.
  stato() {
    const t = this._scheda();
    return { bordo: this.bordo, scheda: t ? { id: t.id, ...t.pannelloApp } : null, opzioni: { ...this.opzioni } };
  }
}

module.exports = { BordoDestro, BORDO, TREMOLIO };
