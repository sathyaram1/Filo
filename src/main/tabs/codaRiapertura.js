// Alla riapertura di Filo la scheda in vista si carica da sola, poi le altre al massimo due alla volta, dalle vicine (#1127).
// Non sa quali schede si riaprono né come si carica una pagina: glielo dicono restoreSession e `carica`.
// Regole: tests/unit/codaRiapertura.test.mjs

const IN_VOLO = 2;
// Una pagina che non finisce mai di caricarsi non deve tenere ferme le altre: passato il tetto il suo posto si libera.
const TETTO = 15_000;

// La scheda in vista per prima, poi a distanza crescente; a pari distanza la destra, dove porta Ctrl+Tab.
function perVicinanza(schede, attiva) {
  const lista = Array.isArray(schede) ? schede.filter(Boolean) : [];
  const i = lista.indexOf(attiva);
  if (i < 0) return lista;
  const out = [attiva];
  for (let d = 1; out.length < lista.length; d++) {
    if (i + d < lista.length) out.push(lista[i + d]);
    if (i - d >= 0) out.push(lista[i - d]);
  }
  return out;
}

class CodaRiapertura {
  // carica(scheda) avvia il caricamento e torna false se non c'era più niente da caricare (chiusa, già partita da sé).
  constructor({ carica, inVolo = IN_VOLO, tetto = TETTO } = {}) {
    this.carica = carica;
    this.inVolo = inVolo;
    this.tetto = tetto;
    this.attesa = [];
    this.volo = new Map();
    this.attese = [];
    this.spenta = false;
  }

  // Non fa partire niente: la prima la carica chi la mette davanti (activate → subito), poi avanti().
  accoda(schede) {
    if (this.spenta) return;
    for (const t of schede || []) if (t && !this.attesa.includes(t) && !this.volo.has(t)) this.attesa.push(t);
  }

  inCoda(tab) {
    return this.attesa.includes(tab);
  }

  // L'utente l'ha aperta: si carica adesso, e finché non ha finito non ne parte un'altra.
  subito(tab) {
    const v = this.volo.get(tab);
    if (v) { v.inVista = true; return true; }
    const i = this.attesa.indexOf(tab);
    if (i < 0) return false;
    this.attesa.splice(i, 1);
    const partita = this._parti(tab, true);
    if (!partita) this.avanti();
    return partita;
  }

  // Fine del caricamento (riuscito o no) della pagina della scheda.
  caricata(tab) {
    const v = this.volo.get(tab);
    if (!v) return;
    clearTimeout(v.timer);
    this.volo.delete(tab);
    this.avanti();
  }

  // La scheda non è più da caricare da qui: chiusa, o caricata da un'altra strada.
  togli(tab) {
    const i = this.attesa.indexOf(tab);
    if (i >= 0) this.attesa.splice(i, 1);
    if (this.volo.has(tab)) { this.caricata(tab); return; }
    this._forseFinita();
  }

  pota(vive) {
    const restano = new Set(vive || []);
    this.attesa = this.attesa.filter((t) => restano.has(t));
    let tolte = false;
    for (const [t, v] of [...this.volo]) {
      if (restano.has(t)) continue;
      clearTimeout(v.timer);
      this.volo.delete(t);
      tolte = true;
    }
    if (tolte) this.avanti(); else this._forseFinita();
  }

  avanti() {
    if (this.spenta) return;
    const inVista = [...this.volo.values()].some((v) => v.inVista);
    while (!inVista && this.volo.size < this.inVolo && this.attesa.length) this._parti(this.attesa.shift(), false);
    this._forseFinita();
  }

  // Si risolve quando non resta niente in coda né in caricamento.
  finita() {
    if (this._vuota()) return Promise.resolve();
    return new Promise((r) => this.attese.push(r));
  }

  chiudi() {
    this.spenta = true;
    for (const v of this.volo.values()) clearTimeout(v.timer);
    this.volo.clear();
    this.attesa = [];
    this._forseFinita();
  }

  // In volo PRIMA di caricare: `carica` può rientrare (loadURL → did-start-loading → pota), e una scheda né in attesa
  // né in volo fa dire la coda finita con l'ultima pagina appena partita.
  _parti(tab, inVista) {
    const v = { inVista, timer: null };
    this.volo.set(tab, v);
    let partita = false;
    try { partita = this.carica(tab) !== false; } catch (_) { partita = false; }
    if (!partita) {
      if (this.volo.get(tab) === v) this.volo.delete(tab);
      return false;
    }
    // Finita, chiusa o potata mentre partiva: niente tetto da armare.
    if (this.volo.get(tab) !== v) return true;
    v.timer = setTimeout(() => this.caricata(tab), this.tetto);
    v.timer.unref?.();
    return true;
  }

  _vuota() {
    return !this.attesa.length && !this.volo.size;
  }

  _forseFinita() {
    if (!this._vuota() || !this.attese.length) return;
    const attese = this.attese;
    this.attese = [];
    for (const r of attese) r();
  }
}

module.exports = { CodaRiapertura, perVicinanza, IN_VOLO, TETTO };
