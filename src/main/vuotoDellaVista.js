// Il vuoto di una vista sopra la pagina (margine, ombra) è della pagina: i gesti che ci cadono tornano alla
// scheda sotto, e il puntatore della pagina torna alla vista. Lo usano gli avvisi e la barra laterale.
// Regole: patterns/la-shell-non-disegna-sopra-la-pagina.md

const GESTI = new Set(['mouseDown', 'mouseUp', 'mouseMove', 'mouseLeave', 'mouseWheel']);
const TASTI = new Set(['left', 'middle', 'right']);
const MODIFICATORI = new Set(['shift', 'control', 'alt', 'meta', 'leftButtonDown', 'middleButtonDown', 'rightButtonDown']);

const testo = (v) => (typeof v === 'string' ? v : String(v == null ? '' : v));
const coord = (v) => Math.max(-10000, Math.min(10000, Math.round(Number(v) || 0)));
const passo = (v) => Math.max(-5000, Math.min(5000, Number(v) || 0));

class VuotoDellaVista {
  // vista(): la WebContentsView sopra la pagina; scheda(): quella della scheda sotto (o null);
  // canale: dove la vista ascolta il puntatore; primaDelClic(tasto): chiamato prima di rigirare un mouseDown.
  constructor({ vista, scheda, canale, primaDelClic = () => {} }) {
    this.vista = vista;
    this.scheda = scheda;
    this.canale = canale;
    this.primaDelClic = primaDelClic;
    this.inoltroSu = null;
    this.cursori = new WeakSet();
    this.forme = new WeakMap();
  }

  inoltra(d) {
    const tipo = testo(d && d.tipo);
    const vista = this.vista();
    const v = this.scheda();
    if (!GESTI.has(tipo) || !vista || !v) return;
    const wc = v.webContents;
    const b = vista.getBounds();
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
    this.segui(wc);
    // Rientrando nel vuoto la pagina non ridice un puntatore che per lei non è cambiato: lo si ridà da qui.
    if (this.inoltroSu && prima !== wc) this._puntatore(this.forme.get(wc) || '');
    if (tipo === 'mouseDown') { try { this.primaDelClic(ev.button); } catch (_) {} }
    try { wc.sendInputEvent(ev); } catch (_) {}
  }

  // Sopra il vuoto il puntatore è quello che mostrerebbe la pagina (mano su un link, barra sul testo).
  // Si ascolta da quando la vista copre la scheda, così si sa anche quello che la pagina ha detto prima.
  segui(wc) {
    if (!wc || this.cursori.has(wc)) return;
    this.cursori.add(wc);
    wc.on('cursor-changed', (_e, forma) => {
      this.forme.set(wc, testo(forma));
      if (this.inoltroSu === wc) this._puntatore(forma);
    });
  }

  _puntatore(forma) {
    const vista = this.vista();
    if (!vista || vista.webContents.isDestroyed()) return;
    try { vista.webContents.send(this.canale, testo(forma)); } catch (_) {}
  }
}

module.exports = { VuotoDellaVista };
