// A schermo intero, quello di Filo e non quello chiesto da un sito, la fila delle schede scende col puntatore fermo sul
// bordo alto e risale quando lo si porta sulla pagina (#1246): il gesto della barra laterale, con le sue attese.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

const { tastoPremuto } = require('./tastoDelMouse');

// Il bordo è la prima riga di pixel: a schermo intero lì il puntatore si ferma contro lo schermo.
const BORDO_PX = 2;
// Appena scese, la pagina si sposta sotto il puntatore: un movimento arrivato in quell'istante non è un'uscita.
const ASSESTAMENTO_MS = 150;
// Il mondo isolato in cui si chiede alla pagina dove comincia sullo schermo: la pagina non lo vede.
const MONDO = 1343;
// Un trascinamento si segue sul puntatore del sistema quando la pagina tace: sopra un riquadro di un altro sito i suoi
// eventi possono non arrivare a nessuno (#1343). La pagina ne parla ogni 100 ms finché lo vede; oltre, decide il puntatore.
const TRASCINA_OGNI_MS = 50;
const PAGINA_FRESCA_MS = 250;
// Un trascinamento finito fuori dalla finestra non lo dice nessuno: dopo questo silenzio non lo si segue più.
const TRASCINA_MAX_MS = 10000;

class SchedeInAlto {
  // tabs: il TabManager della finestra (contentFullscreen, pageFullscreen, barra.opzioni, layout()).
  constructor(win, tabs) {
    this.win = win;
    this.tabs = tabs;
    this.visibili = false;
    this.scese = 0;
    this.premuto = false;
    // Un trascinamento fermo contro il bordo (lo dice la pagina): i movimenti a tasto giù non fermano la sua spinta.
    this.trascinaSulBordo = false;
    this.trascino = null;
    // I movimenti visti dal riquadro principale: uno che arriva solo da un altro riquadro non li fa crescere.
    this.mossePagina = 0;
    // Dove comincia la pagina sullo schermo (per scheda), e la domanda in volo: un movimento lontano dal bordo la annulla.
    this.cimaSulloSchermo = null;
    this.sondaCima = null;
    this.timer = { spinta: null, uscita: null, trascina: null };
    const shell = win && win.webContents;
    if (shell && typeof shell.on === 'function') shell.on('input-event', (_e, input) => this._dallaShell(input));
  }

  _opzioni() {
    return (this.tabs.barra && this.tabs.barra.opzioni) || { schede: true, attesaMs: 250, uscitaMs: 400 };
  }

  // Lo schermo pieno di un video è del sito: lì in alto c'è solo la pillola che dice chi l'ha preso.
  _attivo() {
    return !!this.tabs.contentFullscreen && !this.tabs.pageFullscreen && this._opzioni().schede !== false;
  }

  // Il puntatore sulla pagina che l'utente vede (la scheda, o l'avviso del sito che la copre).
  dallaPagina(wc, input) {
    if (!input || !wc) return;
    const sotto = typeof this.tabs.vistaSottoIlVuoto === 'function' ? this.tabs.vistaSottoIlVuoto() : null;
    if (!sotto || sotto.webContents !== wc) return;
    if (input.type === 'mouseLeave') { this._lasciaSpinta(); return; }
    if (input.type === 'mouseDown' || input.type === 'mouseUp') { this._tasto(input.type === 'mouseDown'); return; }
    if (input.type !== 'mouseMove') return;
    this.mossePagina += 1;
    // Il movimento porta lo stato vero del tasto: un rilascio perso fuori dalla finestra non tiene le schede giù.
    this.premuto = !!tastoPremuto(input);
    if (!this._attivo()) { this.nascondi(); return; }
    if (this.visibili) {
      if (!this.premuto && Date.now() - this.scese > ASSESTAMENTO_MS) this._programmaUscita();
      return;
    }
    const y = Number(input.y);
    // Chi seleziona o trascina arriva in alto con un tasto premuto: non sta chiedendo le schede.
    if (Number.isFinite(y) && y <= BORDO_PX && !tastoPremuto(input)) {
      if (!this.timer.spinta) {
        this.timer.spinta = setTimeout(() => { this.timer.spinta = null; this.mostra(); }, this._opzioni().attesaMs);
      }
    } else {
      this._lasciaSpinta();
    }
  }

  // Chi porta un collegamento o un'immagine contro il bordo cerca una scheda su cui lasciarlo: a tasto giù il main non
  // lo distingue da una selezione, la pagina sì (src/preload/trascina-bordo.js). Le schede restano fino al rilascio.
  // stato: 'bordo' | 'via' dalla pagina o da un suo riquadro, 'fine' al rilascio.
  dalTrascinamento(wc, stato) {
    const sotto = typeof this.tabs.vistaSottoIlVuoto === 'function' ? this.tabs.vistaSottoIlVuoto() : null;
    if (!sotto || sotto.webContents !== wc) return;
    if (stato === 'fine' || !this._attivo() || this.visibili) { this._fineTrascinamento(); return; }
    const ora = Date.now();
    this.trascino = { bordo: stato === 'bordo', detto: ora, fino: ora + TRASCINA_MAX_MS };
    if (!this.timer.trascina) this.timer.trascina = setInterval(() => this._seguiTrascinamento(), TRASCINA_OGNI_MS);
    this._seguiTrascinamento();
  }

  _seguiTrascinamento() {
    const t = this.trascino;
    const ora = Date.now();
    if (!t || ora > t.fino || !this._attivo() || this.visibili) { this._fineTrascinamento(); return; }
    const bordo = ora - t.detto < PAGINA_FRESCA_MS ? t.bordo : this._puntatoreSulBordo();
    this.trascinaSulBordo = bordo;
    if (bordo) this._sulBordo(0);
    else this._ferma('spinta');
  }

  _cursore() {
    return require('electron').screen.getCursorScreenPoint();
  }

  _puntatoreSulBordo() {
    try {
      const p = this._cursore();
      const cb = this.win.getContentBounds();
      const sotto = this.tabs.vistaSottoIlVuoto();
      const v = sotto ? sotto.getBounds() : { x: 0, y: 0, width: cb.width };
      const x = p.x - cb.x - v.x;
      return x >= 0 && x < v.width && p.y - cb.y - v.y <= BORDO_PX;
    } catch (_) { return false; }
  }

  _fineTrascinamento() {
    this.trascino = null;
    if (this.timer.trascina) { clearInterval(this.timer.trascina); this.timer.trascina = null; }
    if (this.trascinaSulBordo) { this.trascinaSulBordo = false; this._ferma('spinta'); }
  }

  _lasciaSpinta() {
    if (!this.trascinaSulBordo) this._ferma('spinta');
  }

  // `input-event` vede solo il riquadro principale: sopra un riquadro di un altro sito in cima alla pagina il bordo non
  // arriverebbe mai (#1343 r2). `before-mouse-event` passa da ogni riquadro, ma con la y del riquadro: la y della pagina
  // si ricava dalla posizione sullo schermo meno la cima della pagina sullo schermo (screenY, chiesto una volta).
  dalRiquadro(wc, input) {
    if (!input || !wc) return;
    const sotto = typeof this.tabs.vistaSottoIlVuoto === 'function' ? this.tabs.vistaSottoIlVuoto() : null;
    if (!sotto || sotto.webContents !== wc || !this._attivo()) return;
    if (input.type === 'mouseDown' || input.type === 'mouseUp') { this._tasto(input.type === 'mouseDown'); return; }
    if (input.type !== 'mouseMove') return;
    const prima = this.mossePagina;
    setImmediate(() => {
      if (this.mossePagina !== prima || !this._attivo()) return;
      if (this.visibili) {
        this.premuto = !!tastoPremuto(input);
        if (!this.premuto && Date.now() - this.scese > ASSESTAMENTO_MS) this._programmaUscita();
        return;
      }
      const gy = Number(input.globalY);
      if (tastoPremuto(input) || !Number.isFinite(gy)) { this._lasciaSpinta(); return; }
      if (this.cimaSulloSchermo && this.cimaSulloSchermo.wc === wc) { this._sulBordo(gy - this.cimaSulloSchermo.y); return; }
      if (this.sondaCima) return;
      const sonda = this._cimaDellaPagina(wc).then((y) => {
        if (this.sondaCima !== sonda) return;
        this.sondaCima = null;
        if (!Number.isFinite(y) || this.visibili || !this._attivo()) return;
        this.cimaSulloSchermo = { wc, y };
        this._sulBordo(gy - y);
      });
      this.sondaCima = sonda;
    });
  }

  // A tasto giù sulla pagina le schede restano: se salissero, la pagina scorrerebbe sotto un clic o una selezione a
  // metà e il rilascio cadrebbe altrove. Se ne vanno dopo il rilascio, con l'attesa di sempre.
  _tasto(giu) {
    this.premuto = giu;
    if (giu) this._ferma('uscita');
    else if (this.visibili && this._attivo()) this._programmaUscita();
  }

  _sulBordo(y) {
    if (y > BORDO_PX) { this._ferma('spinta'); return; }
    if (!this.timer.spinta) this.timer.spinta = setTimeout(() => { this.timer.spinta = null; this.mostra(); }, this._opzioni().attesaMs);
  }

  _cimaDellaPagina(wc) {
    try {
      return wc.executeJavaScriptInIsolatedWorld(MONDO, [{ code: 'screenY' }]).then((v) => Number(v), () => NaN);
    } catch (_) { return Promise.resolve(NaN); }
  }

  _dallaShell(input) {
    if (!this.visibili || !input) return;
    if (input.type === 'mouseMove' || input.type === 'mouseDown' || input.type === 'mouseEnter') this._ferma('uscita');
  }

  mostra() {
    this.trascinaSulBordo = false;
    if (this.visibili || !this._attivo()) return;
    this.visibili = true;
    this.scese = Date.now();
    this.tabs.layout();
  }

  // La modalità è cambiata: lo stato riparte da capo, e il layout lo rifà chi l'ha cambiata.
  azzera() {
    this._fineTrascinamento();
    this._ferma('spinta');
    this._ferma('uscita');
    this.visibili = false;
    this.premuto = false;
    this.trascinaSulBordo = false;
    this.cimaSulloSchermo = null;
  }

  nascondi() {
    this._ferma('spinta');
    this._ferma('uscita');
    if (!this.visibili) return;
    this.visibili = false;
    this.tabs.layout();
  }

  _programmaUscita() {
    if (this.timer.uscita) return;
    this.timer.uscita = setTimeout(() => { this.timer.uscita = null; if (!this.premuto) this.nascondi(); }, this._opzioni().uscitaMs);
  }

  _ferma(nome) {
    if (nome === 'spinta') this.sondaCima = null;
    if (this.timer[nome]) { clearTimeout(this.timer[nome]); this.timer[nome] = null; }
  }
}

module.exports = { SchedeInAlto };
