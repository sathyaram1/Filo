// A schermo intero le schede compaiono portando il puntatore contro il bordo in alto e spariscono allontanandosi
// (#1246), come la barra laterale dal bordo sinistro: stessa attesa, stessa uscita, stesso interruttore di Preferenze.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

const { tastoPremuto } = require('./tastoDelMouse');

// Il bordo da spingere: a schermo intero il puntatore si ferma sulla prima riga di pixel.
const LINEA = 2;

class SchedeInAlto {
  constructor(win, tabs) {
    this.win = win;
    this.tabs = tabs;
    this.visibili = false;
    this.premuto = false;
    this.timer = { spinta: null, uscita: null };
    const shell = win && win.webContents;
    if (shell && typeof shell.on === 'function') shell.on('input-event', (_e, input) => this._dallaShell(input));
    if (win && typeof win.once === 'function') win.once('closed', () => { this._ferma('spinta'); this._ferma('uscita'); });
  }

  _opzioni() {
    const o = this.tabs.barra && this.tabs.barra.opzioni;
    return o || { spinta: true, attesaMs: 250, uscitaMs: 400, schedeInAlto: true };
  }

  // Lo schermo intero di Filo, non quello che un video si prende col suo pulsante: lì in alto ci sono i suoi comandi.
  attivo() {
    return !!this.tabs.contentFullscreen && !this.tabs.pageFullscreen && this._opzioni().schedeInAlto !== false;
  }

  // Conta il puntatore di ciò che l'utente vede: l'avviso del sito quando copre la scheda, sennò la scheda.
  inputDa(wc, input) {
    const sotto = this.tabs.vistaSottoIlVuoto();
    if (wc && sotto && sotto.webContents === wc) this._dallaPagina(input);
  }

  _dallaPagina(input) {
    if (!input) return;
    const t = input.type;
    if (!this.attivo()) {
      this._ferma('spinta');
      if (this.visibili) this.nascondi();
      return;
    }
    if (this.visibili) {
      // Tornato sulla pagina: le schede se ne vanno dopo l'attesa d'uscita; un clic sulla pagina le chiude subito.
      if (t === 'mouseDown') this.nascondi();
      else if (t === 'mouseMove') this._programmaUscita();
      return;
    }
    if (t !== 'mouseMove') {
      if (t === 'mouseLeave' || t === 'mouseDown') this._ferma('spinta');
      return;
    }
    // Chi seleziona o trascina arriva in alto con un tasto premuto: non spinge.
    if (tastoPremuto(input) || !(Number(input.y) < LINEA)) { this._ferma('spinta'); return; }
    if (this.timer.spinta) return;
    this.timer.spinta = setTimeout(() => {
      this.timer.spinta = null;
      if (this.attivo()) this.mostra();
    }, Number(this._opzioni().attesaMs) || 250);
  }

  _dallaShell(input) {
    if (!this.visibili || !input) return;
    const t = input.type;
    if (t === 'mouseDown') { this.premuto = true; this._ferma('uscita'); }
    else if (t === 'mouseUp') this.premuto = false;
    else if (t === 'mouseMove') this._ferma('uscita');
    else if (t === 'mouseLeave') this._programmaUscita();
  }

  _programmaUscita() {
    if (this.timer.uscita || this.premuto) return;
    this.timer.uscita = setTimeout(() => {
      this.timer.uscita = null;
      if (this.visibili) this.nascondi();
    }, Number(this._opzioni().uscitaMs) || 400);
  }

  mostra() {
    this._ferma('uscita');
    if (this.visibili) return;
    this.visibili = true;
    this.tabs.layout();
  }

  nascondi() {
    this._ferma('uscita');
    this.premuto = false;
    if (!this.visibili) return;
    this.visibili = false;
    this.tabs.layout();
  }

  // Lo schermo intero è cambiato: si riparte con le schede nascoste, senza rifare il layout (lo fa chi chiama).
  azzera() {
    this._ferma('spinta');
    this._ferma('uscita');
    this.visibili = false;
    this.premuto = false;
  }

  _ferma(nome) {
    if (this.timer[nome]) { clearTimeout(this.timer[nome]); this.timer[nome] = null; }
  }
}

module.exports = { SchedeInAlto };
