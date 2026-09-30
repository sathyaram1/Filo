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
    if (this._giro) { clearInterval(this._giro); this._giro = null; }
  }

  // Il periodo si allunga a ogni cambio di pagina; una pagina nuova riparte da zero.
  _segui(tab, { nuova = false, sporca = false } = {}) {
    if (this.spento) return;
    let s = tab._anteprimaSegui;
    if (!s || nuova) {
      s = { n: null, ultima: Date.now(), passo: this.tempi.passo, dal: 0, sporca: false, inVolo: false };
      tab._anteprimaSegui = s;
    }
    s.fino = Date.now() + this.tempi.segui;
    if (sporca) s.sporca = true;
    if (!this._giro) {
      this._giro = setInterval(() => this._guarda(), this.tempi.giro);
      this._giro.unref?.();
    }
  }

  _smetti(tab) {
    if (!tab || !tab._anteprimaSegui) return;
    tab._anteprimaSegui = null;
    this._spia(tab, SPEGNI);
  }

  // Ogni giro chiede a ogni pagina seguita se è cambiata dall'ultima foto; ferma da poco, o cambiata da un pezzo, si rifà.
  _guarda() {
    const ora = Date.now();
    let seguite = 0;
    for (const tab of this.m.tabs) {
      const s = tab._anteprimaSegui;
      if (!s) continue;
      if (this.spento || tab.id === this.m.activeId || ora > s.fino || !vivo(tab)) { this._smetti(tab); continue; }
      seguite++;
      if (tab.loading || s.inVolo) continue;
      s.inVolo = true;
      this._spia(tab, SPIA).then((r) => {
        s.inVolo = false;
        if (!r || typeof r.n !== 'number' || tab._anteprimaSegui !== s) return;
        if (s.n === null && !s.sporca) { s.n = r.n; return; }
        if (!s.sporca && r.n === s.n) return;
        const adesso = Date.now();
        if (!s.dal) s.dal = adesso;
        if (adesso - s.ultima < s.passo) return;
        if (r.quiete < this.tempi.quiete && adesso - s.dal < SENZA_QUIETE) return;
        s.n = r.n;
        s.sporca = false;
        s.dal = 0;
        s.passo *= 2;
        this._risveglia(tab);
      });
    }
    if (!seguite && this._giro) { clearInterval(this._giro); this._giro = null; }
  }

  // Col tetto: una pagina ferma su un avviso del browser non deve tenere la spia in volo per sempre.
  _spia(tab, codice) {
    let wc;
    try { wc = tab.view.webContents; } catch (_) { return Promise.resolve(null); }
    if (!wc || typeof wc.executeJavaScriptInIsolatedWorld !== 'function') return Promise.resolve(null);
    let timer;
    const tetto = new Promise((r) => { timer = setTimeout(() => r(null), 1000); timer.unref?.(); });
    const p = Promise.resolve()
      .then(() => wc.executeJavaScriptInIsolatedWorld(MONDO, [{ code: codice }]))
      .catch(() => null);
    return Promise.race([p, tetto]).then((r) => { clearTimeout(timer); return r || null; });
  }

  // La foto di un cambio non chiama una ripresa: i cambi successivi li vede la spia.
  _risveglia(tab) {
    if (this.spento || !vivo(tab) || tab.id === this.m.activeId) return;
    tab._anteprimaAttesa = TENTATIVI;
    tab._anteprimaRipresa = true;
    try { tab.view.setVisible?.(true); } catch (_) {}
    this.caricata(tab);
  }

  // Dopo ogni foto di una pagina seguita la spia riparte da lì (e al primo giro si installa).
  _fotografata(tab) {
    const s = tab._anteprimaSegui;
    if (!s) return;
    s.ultima = Date.now();
    this._spia(tab, SPIA).then((r) => {
      if (r && typeof r.n === 'number' && tab._anteprimaSegui === s) { s.n = r.n; s.sporca = false; }
    });
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
          this._fotografata(tab);
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
