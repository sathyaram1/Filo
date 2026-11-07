// Una pagina già caricata e nascosta che la scheda nuova prende (#1128): la home, che rinasce a ogni consegna, o la voce
// del menu Impostazioni preparata mentre il menu è aperto (#1129). Non è una scheda: fuori da tabs, barra, sessione,
// cronologia e conti; riceve gli annunci delle pagine aperte (`vistePerAnnunci`). Prove: tests/riserva-*.spec.mjs.

const { randomUUID } = require('node:crypto');

const HOME = 'filo://newtab/';
// All'avvio la riserva aspetta che le schede vere abbiano cominciato a caricarsi.
const DOPO_AVVIO_MS = 1500;
// Un renderer che muore di continuo non si rianima a raffica.
const DOPO_CROLLO_MS = 5000;

// Le prove che contano o cercano le viste partono senza (playwright.config.js); quella della riserva la riaccende.
function accesa(variabile = 'FILO_RISERVA_NUOVA_SCHEDA') {
  return process.env[variabile] !== '0';
}

class RiservaNuovaScheda {
  // `rinasce`: buttata per un crollo, la riserva si ricrea da sola; quella del menu no, la chiede la prossima apertura.
  constructor(manager, { url = HOME, rinasce = true, variabile = 'FILO_RISERVA_NUOVA_SCHEDA' } = {}) {
    this.m = manager;
    this.url = url;
    this.rinasce = rinasce;
    this.vista = null;
    // L'id della scheda che diventerà: chi le risponde mentre si carica parla già con quella scheda.
    this.id = null;
    // Quello che la pagina dice della sua scheda prima di esserlo (colore, risposta all'Esc), e la sua icona.
    this.campi = {};
    this.icone = null;
    this.spenta = !accesa(variabile);
    this._timer = null;
  }

  webContents() {
    try {
      const wc = this.vista && this.vista.webContents;
      return wc && !wc.isDestroyed() ? wc : null;
    } catch (_) { return null; }
  }

  possiede(wc) {
    return !!wc && wc === this.webContents();
  }

  // I campi della scheda `id` finché è ancora la riserva; null per ogni altro id.
  campiPer(id) {
    return id && id === this.id && this.webContents() ? this.campi : null;
  }

  prepara({ fra = DOPO_AVVIO_MS } = {}) {
    if (this.spenta || this.vista || this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this._crea(); }, fra);
    this._timer.unref?.();
  }

  // Subito la pagina `url`: quella già pronta sullo stesso indirizzo resta, un'altra si butta. Vero se c'è.
  preparaSubito(url) {
    if (this.spenta || typeof url !== 'string' || !url) return false;
    if (this.vista && this.url === url && this.webContents() && !this.webContents().isCrashed()) return true;
    this._butta();
    this.url = url;
    this._crea();
    return !!this.vista;
  }

  _crea() {
    const m = this.m;
    if (this.spenta || this.vista || !m.win || m.win.isDestroyed()) return;
    const url = this.url;
    const vista = m._makeView(url, m._partitionFor(url));
    const wc = vista.webContents;
    this.vista = vista;
    this.id = randomUUID();
    this.campi = {};
    this.icone = null;
    // Nascosta si disegna lo stesso (`document.hidden` nelle viste di Filo non cambia): che non sia davanti agli occhi
    // lo sa la home dal main, e i popup dell'avvio aspettano la consegna.
    vista.setVisible(false);
    this.posa();
    const mia = () => this.vista === vista;
    // Una vista che si carica dentro la finestra si prende la tastiera: la riserva ci entra a caricamento finito, in
    // fondo sotto tutto, e se la tastiera le arriva lo stesso torna alla scheda davanti.
    const entra = () => {
      if (!mia() || m.win.isDestroyed()) return;
      try { m.win.contentView.addChildView(vista, 0); } catch (_) {}
      this.posa();
    };
    wc.once('did-finish-load', entra);
    wc.once('did-fail-load', entra);
    wc.on('focus', () => setImmediate(() => { if (mia()) m._tastieraAllaSchedaAttiva(); }));
    wc.on('page-favicon-updated', (_e, icone) => { if (mia()) this.icone = icone; });
    wc.on('render-process-gone', () => { if (mia()) this._butta({ poi: DOPO_CROLLO_MS }); });
    wc.on('did-fail-load', (_e, code, _d, _u, principale) => {
      if (principale && code !== -3 && mia()) this._butta({ poi: DOPO_CROLLO_MS });
    });
    // Finché nessuno la guarda non apre finestre; consegnata, la regola è quella della scheda.
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    try { wc.loadURL(url); } catch (_) { this._butta({ poi: DOPO_CROLLO_MS }); }
  }

  // Grande quanto la scheda davanti (stessa cornice, compatta o intera): consegnata non si ridispone.
  posa() {
    const vista = this.vista;
    if (!vista || !this.webContents()) return;
    try { vista.setBounds(this.m._areaPagina()); } catch (_) {}
  }

  // La riserva per una scheda su `url` nella sessione `ses`, staccata e pronta a diventarlo; null se non c'è.
  prendi(url, ses) {
    if (this.spenta || !this.vista || url !== this.url) return null;
    const wc = this.webContents();
    if (!wc || wc.isCrashed() || !ses || wc.session !== ses) return null;
    let corrente = '';
    try { corrente = String(wc.getURL() || ''); } catch (_) {}
    if (corrente && !corrente.startsWith(this.url)) return null;
    const presa = { vista: this.vista, id: this.id, campi: this.campi, icone: this.icone };
    this.vista = null;
    this.id = null;
    this.campi = {};
    this.icone = null;
    return presa;
  }

  _butta({ poi = null } = {}) {
    const vista = this.vista;
    this.vista = null;
    this.id = null;
    if (vista) {
      try { this.m.win.contentView.removeChildView(vista); } catch (_) {}
      try { if (!vista.webContents.isDestroyed()) vista.webContents.close(); } catch (_) {}
    }
    if (poi != null && this.rinasce) this.prepara({ fra: poi });
  }

  // La pagina `url` pronta e non presa si butta; una presa, o già sostituita da un'altra, resta a chi ce l'ha.
  scarta(url) {
    if (this.vista && this.url === url) this._butta();
  }

  spegni() {
    this.spenta = true;
    clearTimeout(this._timer);
    this._timer = null;
    this._butta();
  }
}

// Le riserve di `tm` (la home e la voce del menu), quelle che ci sono.
function riserveDi(tm) {
  return tm ? [tm.riserva, tm.preparata].filter(Boolean) : [];
}

// Le pagine a cui arrivano gli annunci delle schede di `tm`: le schede, e le riserve, che si tengono allineate come loro.
function vistePerAnnunci(tm) {
  if (!tm) return [];
  const viste = (tm.tabs || []).map((t) => ({ wc: t.view && t.view.webContents, inVista: t.id === tm.activeId }));
  for (const r of riserveDi(tm)) {
    const wc = r.webContents();
    if (wc) viste.push({ wc, inVista: false });
  }
  return viste;
}

module.exports = { RiservaNuovaScheda, vistePerAnnunci, riserveDi, HOME };
