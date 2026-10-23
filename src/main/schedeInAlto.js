// A schermo intero, quello di Filo e non quello chiesto da un sito, la fila delle schede scende col puntatore fermo sul
// bordo alto e risale quando lo si porta sulla pagina (#1246): il gesto della barra laterale, con le sue attese.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

const { tastoPremuto } = require('./tastoDelMouse');

// Il bordo è la prima riga di pixel: a schermo intero lì il puntatore si ferma contro lo schermo.
const BORDO_PX = 2;
// Appena scese, la pagina si sposta sotto il puntatore: un movimento arrivato in quell'istante non è un'uscita.
const ASSESTAMENTO_MS = 150;

class SchedeInAlto {
  // tabs: il TabManager della finestra (contentFullscreen, pageFullscreen, barra.opzioni, layout()).
  constructor(win, tabs) {
    this.tabs = tabs;
    this.visibili = false;
    this.scese = 0;
    this.timer = { spinta: null, uscita: null };
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
    if (input.type === 'mouseLeave') { this._ferma('spinta'); return; }
    if (input.type !== 'mouseMove') return;
    if (!this._attivo()) { this.nascondi(); return; }
    if (this.visibili) {
      if (Date.now() - this.scese > ASSESTAMENTO_MS) this._programmaUscita();
      return;
    }
    const y = Number(input.y);
    // Chi seleziona o trascina arriva in alto con un tasto premuto: non sta chiedendo le schede.
    if (Number.isFinite(y) && y <= BORDO_PX && !tastoPremuto(input)) {
      if (!this.timer.spinta) {
        this.timer.spinta = setTimeout(() => { this.timer.spinta = null; this.mostra(); }, this._opzioni().attesaMs);
      }
    } else {
      this._ferma('spinta');
    }
  }

  _dallaShell(input) {
    if (!this.visibili || !input) return;
    if (input.type === 'mouseMove' || input.type === 'mouseDown' || input.type === 'mouseEnter') this._ferma('uscita');
  }

  mostra() {
    if (this.visibili || !this._attivo()) return;
    this.visibili = true;
    this.scese = Date.now();
    this.tabs.layout();
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
    this.timer.uscita = setTimeout(() => { this.timer.uscita = null; this.nascondi(); }, this._opzioni().uscitaMs);
  }

  _ferma(nome) {
    if (this.timer[nome]) { clearTimeout(this.timer[nome]); this.timer[nome] = null; }
  }
}

module.exports = { SchedeInAlto, BORDO_PX };
