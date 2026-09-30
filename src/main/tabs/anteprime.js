// Anteprime delle schede per la carta al passaggio sulla barra (#430): si fotografano PRIMA che servano,
// così la carta non aspetta mai. Non decide cosa mostrare né dove: quello è di popup-anteprima.js e della shell.
// Regole: patterns/l-anteprima-di-una-scheda-si-scatta-prima-che-serva.md

const LARGHEZZA = 720;
const QUALITA = 78;
// Una scheda nata in secondo piano non si è mai disegnata: la si allarga sotto quella davanti e la si aspetta.
const ATTESA_DISEGNO = 350;
const TETTO_DISEGNO = 2500;
const RITENTA = 4000;
const TENTATIVI = 3;
// Feed, posta, video: il contenuto arriva dopo il caricamento, e alla prima foto la pagina è ancora vuota.
const RIPRESA = 3000;
// Una pagina dietro mai vista si rifotografa quando cambia, non a orari fissi: una spia nel suo mondo isolato conta
// i cambi del DOM e le immagini arrivate. Fra due foto per cambio l'attesa raddoppia, così un ticker costa poco.
const SEGUI = 90_000;
const GIRO = 1500;
const QUIETE = 600;
const PASSO = 3000;
const SENZA_QUIETE = 4000;
const MONDO = 1430;
const SPIA = `(() => {
  let s = window.__filoAnteprima;
  if (!s) {
    s = window.__filoAnteprima = { n: 0, t: performance.now() };
    const tocca = () => { s.n++; s.t = performance.now(); };
    try {
      s.o = new MutationObserver(tocca);
      s.o.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch (_) {}
    s.f = tocca;
    try { document.addEventListener('load', tocca, true); } catch (_) {}
  }
  return { n: s.n, quiete: performance.now() - s.t };
})()`;
const SPEGNI = `(() => {
  const s = window.__filoAnteprima;
  if (!s) return;
  try { s.o && s.o.disconnect(); } catch (_) {}
  try { document.removeEventListener('load', s.f, true); } catch (_) {}
  window.__filoAnteprima = null;
})()`;

const pausa = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });

function vivo(tab) {
  try { return !!(tab && tab.view && !tab.view.webContents.isDestroyed()); } catch (_) { return false; }
}

// Di una pagina più alta che larga si tiene la cima: la carta è orizzontale.
function daCattura(img) {
  if (!img || img.isEmpty()) return null;
  let { width, height } = img.getSize();
  if (!width || !height) return null;
  const altezzaMax = Math.round(width * 3 / 4);
  if (height > altezzaMax) { img = img.crop({ x: 0, y: 0, width, height: altezzaMax }); height = altezzaMax; }
  if (width > LARGHEZZA) {
    img = img.resize({ width: LARGHEZZA, quality: 'good' });
    ({ width, height } = img.getSize());
  }
  return { src: 'data:image/jpeg;base64,' + img.toJPEG(QUALITA).toString('base64'), w: width, h: height };
}

class AnteprimeSchede {
  // manager: il TabManager della finestra. suNuova(id, dato): un'anteprima pronta, da portare alla carta.
  constructor(manager, { suNuova = () => {}, suTolte = () => {}, ripresa = RIPRESA, segui = SEGUI, giro = GIRO, passo = PASSO, quiete = QUIETE } = {}) {
    this.m = manager;
    this.suNuova = suNuova;
    this.suTolte = suTolte;
    this.ripresa = ripresa;
    this.tempi = { segui, giro, passo, quiete };
    this._giro = null;
    this.foto = new Map();
    this.seq = 0;
    this.coda = [];
    this.sotto = null;
    this.lavorando = false;
    this.spento = false;
  }

  get(id) { return this.foto.get(id) || null; }

  // Nata in secondo piano: resta «visibile» a 0×0 finché non ha la sua foto (nascosta non si disegna più).
  nataDietro(tab) {
    tab._anteprimaAttesa = TENTATIVI;
    tab._anteprimaRipresa = false;
    this._segui(tab, { nuova: true });
  }

  // Una scheda di dietro che passa da sola a un'altra pagina (un rimando, un aggiornamento): la foto di prima
  // non è più sua. Torna sveglia come una nata dietro, e al caricamento si rifotografa.
  // Senza ricaricare (un sito a pagina unica) nessun caricamento segue: la foto la chiede la spia.
  navigata(tab, { inPagina = false } = {}) {
    if (this.spento || !vivo(tab) || tab.id === this.m.activeId) return;
    if (inPagina) { this._segui(tab, { sporca: true }); return; }
    this.nataDietro(tab);
    try { tab.view.setVisible?.(true); } catch (_) {}
  }

  // Si è vista davanti: la sua foto la prende congeda() quando torna dietro.
  mostrata(tab) {
    this._fineAttesa(tab);
    this._smetti(tab);
  }

  tieneSveglia(tab) {
    return !!(tab && tab._anteprimaAttesa > 0);
  }

  // Durante la foto di una scheda di dietro, il layout le dà l'area della pagina, sotto quella davanti.
  inCattura(tab) {
    return !!(tab && this.sotto === tab.id);
  }

  // La scheda davanti sta per andare dietro: l'ultima cosa che l'utente ci ha visto è la sua anteprima.
  congeda(tab) {
    if (!vivo(tab) || this.spento) return;
    this._fineAttesa(tab);
    const n = ++this.seq;
    tab._anteprimaSeq = n;
    let p;
    try { p = tab.view.webContents.capturePage(); } catch (_) { return; }
    Promise.resolve(p).then((img) => {
      if (tab._anteprimaSeq !== n) return;
      this._salva(tab, daCattura(img));
    }).catch(() => {});
  }

  // Finito di caricare: una scheda di dietro mai fotografata entra in coda.
  caricata(tab) {
    if (!this.tieneSveglia(tab) || tab.id === this.m.activeId) return;
    if (!this.coda.includes(tab.id)) this.coda.push(tab.id);
    this._prossima();
  }

  // Qualcosa copre la pagina o la scheda davanti sparisce: nessuna scheda di dietro può restare allargata.
  interrompi() {
    if (!this.sotto) return;
    this.sotto = null;
    try { this.m.layout(); } catch (_) {}
  }

  riprendi() { this._prossima(); }

  pota(idsVivi) {
    const tolte = [];
    for (const id of this.foto.keys()) if (!idsVivi.has(id)) tolte.push(id);
    for (const id of tolte) this.foto.delete(id);
    this.coda = this.coda.filter((id) => idsVivi.has(id));
    if (tolte.length) this.suTolte(tolte);
  }

  tutte() { return [...this.foto.entries()]; }

  chiudi() {
    this.spento = true;
    this.coda = [];
    this.sotto = null;
  }

  // La visibilità la rimette in riga il prossimo cambio di scheda, come per ogni scheda aperta dietro.
  _fineAttesa(tab) {
    if (!tab) return;
    tab._anteprimaAttesa = 0;
    tab._anteprimaRipresa = false;
    this.coda = this.coda.filter((id) => id !== tab.id);
  }

  _salva(tab, dato) {
    if (!dato || this.spento) return false;
    if (!this.m.tabs.some((t) => t.id === tab.id)) return false;
    this.foto.set(tab.id, dato);
    try { this.suNuova(tab.id, dato); } catch (_) {}
    return true;
  }

  // La scheda davanti deve coprirla per intero, e la finestra deve disegnare: altrimenti si vedrebbe o non verrebbe.
  _siPuo(tab) {
    const m = this.m;
    if (this.spento || !vivo(tab) || !this.tieneSveglia(tab) || tab.id === m.activeId || tab.loading) return false;
    const davanti = m.tabs.find((t) => t.id === m.activeId);
    if (!vivo(davanti) || m._attivaNascosta) return false;
    const w = m.win;
    if (!w || w.isDestroyed() || !w.isVisible() || w.isMinimized()) return false;
    return true;
  }

  async _prossima() {
    if (this.lavorando || this.spento) return;
    this.lavorando = true;
    try {
      while (this.coda.length && !this.spento) {
        const id = this.coda.shift();
        const tab = this.m.tabs.find((t) => t.id === id);
        if (!tab || !this.tieneSveglia(tab)) continue;
        if (!this._siPuo(tab)) { this._piuTardi(tab); continue; }
        const ok = await this._sotto(tab);
        if (!ok) this._piuTardi(tab);
      }
    } finally {
      this.lavorando = false;
    }
  }

  // La prima foto di una scheda di dietro ne chiama una seconda poco dopo; alla seconda la scheda si riaddormenta.
  _dopoFoto(tab) {
    if (tab._anteprimaRipresa) { this._fineAttesa(tab); return; }
    tab._anteprimaRipresa = true;
    const t = setTimeout(() => this.caricata(tab), this.ripresa);
    t.unref?.();
  }

  _piuTardi(tab) {
    if (!this.tieneSveglia(tab) || tab.loading) return;
    tab._anteprimaAttesa -= 1;
    if (!this.tieneSveglia(tab)) return;
    const t = setTimeout(() => this.caricata(tab), RITENTA);
    t.unref?.();
  }

  async _sotto(tab) {
    const m = this.m;
    this.sotto = tab.id;
    try {
      m.win.contentView.addChildView(tab.view, 0);
      m.layout();
      await pausa(ATTESA_DISEGNO);
      const fine = Date.now() + TETTO_DISEGNO;
      while (this.sotto === tab.id && vivo(tab)) {
        let img = null;
        try { img = await tab.view.webContents.capturePage(); } catch (_) { img = null; }
        if (this.sotto !== tab.id) return false;
        const dato = daCattura(img);
        if (dato) {
          if (!this.tieneSveglia(tab)) return true;
          // Una foto di congeda() ancora in volo è più vecchia di questa.
          tab._anteprimaSeq = ++this.seq;
          this._salva(tab, dato);
          this.sotto = null;
          m.layout();
          this._dopoFoto(tab);
          return true;
        }
        if (Date.now() > fine) return false;
        await pausa(150);
      }
      return false;
    } finally {
      if (this.sotto === tab.id) {
        this.sotto = null;
        try { m.layout(); } catch (_) {}
      }
    }
  }
}

module.exports = { AnteprimeSchede, daCattura };
