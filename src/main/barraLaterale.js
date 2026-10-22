// Barra laterale dal bordo sinistro (#871), una per finestra: una vista sopra la scheda, stretta
// quanto la striscia d'indizio da chiusa e quanto il pannello da aperta. Un sito non ci arriva.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

const path = require('node:path');
const { collegaScorciatoie } = require('./shortcuts');
const { VuotoDellaVista } = require('./vuotoDellaVista');
const Layout = require('./services/layoutIcone');
const RedteamGate = require('./services/redteamGate');
const { tastoPremuto } = require('./tastoDelMouse');
const RisposteInAttesa = require('./risposteInAttesa');

const STRISCIA = 4;
const PANNELLO = 56;
const OMBRA = 16;
// Il tempo dell'animazione di chiusura (barra.css): prima la vista resta larga, o il pannello sparisce di colpo.
const CHIUSURA_MS = 220;
// A finestra non massimizzata i primi pixel dentro il bordo li prende il sistema per ridimensionare una finestra
// senza cornice (Electron, FramelessView): lì la vista non riceve niente. La sosta la guarda il main, e la parte
// viva della striscia (clic, tasto destro) comincia dopo la fascia.
const BORDO = 5;
const VICINO = 24;
const SONDA_MS = 50;
// Col puntatore fuori dalla pagina (fila delle schede, fuori dalla finestra) si guarda più di rado.
const SONDA_LONTANO_MS = 150;
// Dopo un ridimensionamento o uno spostamento della finestra il bordo non spinge: era il sistema al lavoro.
const QUIETE_MS = 600;
// Le pagine elencate dal tasto destro su Indietro e Avanti; le altre si contano in fondo, non spariscono.
const PAGINE_NEL_MENU = 15;

const FISSE = new Set(['history', 'apps', 'redteam', 'settings', 'account']);
const MENU_DELLA_SHELL = new Set(['apps', 'settings', 'account']);
const PAGINE_FISSE = {
  // Il quaderno delle memorie ha preso il posto della Cronologia (#872): il comando tiene il suo nome per le disposizioni salvate.
  history: 'filo://quaderno/quaderno.html',
  redteam: 'filo://redteam/redteam.html',
};
const NOME_VAR = /^--[a-z][a-z0-9-]*$/;
// Le icone che un'azione della pagina può cambiare (lo stesso bottone traduce o riporta all'originale).
const ICONE_DELLA_PAGINA = { translate: new Set(['translate', 'showOriginal']) };
// Perché l'icona Aiuto è spenta, nel suggerimento: chiavi i18n per i motivi che la pagina riferisce.
const MOTIVI_AIUTO_SPENTO = { aiuto: 'aiuto_spento_barra', sito: 'aiuto_spento_sito', pagina: 'aiuto_spento_pagina' };
const PAGINE_DAL_MENU = {
  ai: 'filo://history/history.html',
  preferenze: 'filo://preferences/preferences.html',
  regola: 'filo://preferences/preferences.html#sec-barra',
};

const numero = (v, min = -10000, max = 10000) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));
const testo = (v) => (typeof v === 'string' ? v : String(v == null ? '' : v));
const opzioniDi = (v) => (globalThis.SN_CONST && globalThis.SN_CONST.opzioniBarraLaterale
  ? globalThis.SN_CONST.opzioniBarraLaterale(v)
  : { spinta: true, attesaMs: 250, uscitaMs: 400, striscia: true, schedeInAlto: true });

class BarraLaterale {
  constructor(win, tabs, { alto = () => 0 } = {}) {
    this.win = win;
    this.tabs = tabs;
    this.alto = alto;
    this.vista = null;
    this.pronta = false;
    this.aperta = false;
    this.motivo = null;
    this.dentro = false;
    this.layout = null;
    // «Altro…» aperto o chiuso: vale per la finestra finché resta aperta, come lo lascia l'utente.
    this.altroAperto = false;
    this.tema = {};
    this.account = null;
    this.suggerimento = false;
    this.timer = { uscita: null, stringi: null, sonda: null };
    this.ultimoNav = '';
    this.opzioni = opzioniDi(null);
    this.spentiSu = [];
    this.bordo = false;
    this.bordoDal = 0;
    this.tasti = { scheda: false, shell: false };
    this.puntoFermo = null;
    this.quieteFino = 0;
    this.ultimaSonda = 0;
    this.etichettePagina = null;
    this.ultimaPagina = '';
    this.comandoInAttesa = null;
    this.strisciaPx = STRISCIA;
    this.vuoto = new VuotoDellaVista({
      vista: () => (this.vista && !this.vista.webContents.isDestroyed() ? this.vista : null),
      scheda: () => this.tabs.vistaSottoIlVuoto(),
      canale: 'barra:cursore',
      // Un clic arrivato alla pagina chiude la barra come ogni clic sulla pagina, e la tastiera torna a lei.
      primaDelClic: (tasto) => { if (tasto === 'left') this.chiudi(); this._restituisciTastiera(); },
    });
    // Il Red Team in pausa (#896) compare in fondo alla barra solo a chi lo vede, e sparisce senza riavviare.
    this._smettiRedteam = RedteamGate.suCambio(() => this._invia());
    if (win && typeof win.once === 'function') win.once('closed', () => { this._smettiRedteam(); this._butta(); });
    if (win && typeof win.on === 'function') {
      const quiete = () => { this.quieteFino = Date.now() + QUIETE_MS; this.puntoFermo = this._punto(); this._segnaBordo(false); this._guarda(); };
      for (const ev of ['will-resize', 'resize', 'move']) win.on(ev, quiete);
      for (const ev of ['focus', 'show', 'restore']) win.on(ev, () => this._guarda());
      for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore']) win.on(ev, () => this.posa());
    }
    // La fila delle schede: chi trascina una scheda fino al bordo tiene premuto un tasto lì, non nella pagina.
    const shell = win && win.webContents;
    if (shell && typeof shell.on === 'function') shell.on('input-event', (_e, input) => this._inputDellaShell(input));
    Layout.leggi({ incognito: this._incognito() }).then((l) => this.disposizione(l)).catch(() => {});
    try {
      const letta = globalThis.SN_STORAGE?.getSettings?.();
      if (letta && typeof letta.then === 'function') letta.then((st) => this.impostazioni(st && st.barraLaterale, st && st.blocklist)).catch(() => {});
    } catch (_) {}
  }

  // Preferenze → Avanzate, la chat e il tasto destro sulla striscia: tutte le scritture passano da applySettingsUpdate.
  // `spentiSu`: i siti dove l'utente ha spento Filo (#843), dove le azioni sulla pagina non partono.
  impostazioni(v, spentiSu) {
    this.opzioni = opzioniDi(v);
    if (Array.isArray(spentiSu)) this.spentiSu = spentiSu.filter((x) => typeof x === 'string');
    if (!this.opzioni.spinta) { this._ferma('sonda'); this._segnaBordo(false); } else this._guarda();
    this._invia();
  }

  _incognito() { return !!(this.win && this.win._filoIncognito); }

  // ── apertura e chiusura ──────────────────────────────────────────────────

  // motivo: 'spinta' | 'clic' | 'tasto' | 'chat'. Da tastiera la barra prende il fuoco.
  apri(motivo = 'clic') {
    RedteamGate.aggiorna();
    this._ferma('stringi');
    this._ferma('uscita');
    this._segnaBordo(false);
    const giaAperta = this.aperta;
    this.aperta = true;
    if (!giaAperta || motivo === 'tasto') this.motivo = motivo;
    if (!giaAperta) this.dentro = false;
    this.posa();
    this._invia({ fuoco: motivo === 'tasto' });
    if (motivo === 'tasto' && this.vista) { try { this.vista.webContents.focus(); } catch (_) {} }
    if (!giaAperta) this._chiediEtichette();
    // Aperta dal bordo che la vista non vede: la sonda resta a guardare dove va il puntatore.
    if (motivo === 'spinta' && !giaAperta) this._sonda();
  }

  chiudi() {
    this._ferma('uscita');
    if (!this.aperta) return;
    // Da tastiera il fuoco l'ha preso lei: torna alla scheda anche se il sistema non lo dice ancora.
    const avevaFuoco = this._haFuoco() || this.motivo === 'tasto';
    this.aperta = false;
    this.motivo = null;
    this.dentro = false;
    this._nascondiSuggerimento();
    this._invia();
    this._ferma('stringi');
    this.timer.stringi = setTimeout(() => { this.timer.stringi = null; if (!this.aperta) this.posa(); }, require('./movimento').ms(CHIUSURA_MS));
    if (avevaFuoco) this._restituisciTastiera();
    // Chiusa col puntatore fermo sul bordo (scorciatoia, Esc): si riapre solo se il puntatore si muove.
    this.puntoFermo = this._punto();
    this._ferma('sonda');
    this._guarda();
  }

  commuta(motivo = 'clic') {
    if (this.aperta) this.chiudi();
    else this.apri(motivo);
  }

  // Tasto della barra ed Esc, da qualunque vista della finestra abbia il fuoco. true = preso.
  tasto(input) {
    if (!input || input.type !== 'keyDown') return false;
    const T = globalThis.SN_TASTI;
    if (T && T.comandoBarra(input)) {
      if (!input.isAutoRepeat) this.commuta('tasto');
      return true;
    }
    if (this.aperta && String(input.key || '') === 'Escape') {
      this.chiudi();
      return true;
    }
    return false;
  }

  // Input vero di una vista della finestra: conta solo quello di ciò che l'utente vede sotto la barra (l'avviso del
  // sito quando copre la scheda, sennò la scheda), la stessa regola del vuoto (#871 giro 6).
  inputDa(wc, input) {
    const sotto = this.tabs.vistaSottoIlVuoto();
    if (wc && sotto && sotto.webContents === wc) this.inputAltrove(input);
  }

  inputAltrove(input) {
    if (!input) return;
    this._tasti('scheda', input);
    if (!this.aperta) {
      // Uscendo dalla pagina il puntatore può andare dove la pagina non lo vede più (la fascia del sistema,
      // fuori dalla finestra): da lì lo guarda il main, anche arrivando di corsa.
      if (input.type === 'mouseLeave') this._guarda();
      else if (input.type === 'mouseMove') this._forseBordo();
    }
    if (!this.aperta) return;
    if (input.type === 'mouseDown' && (input.button || 'left') === 'left') { this.chiudi(); return; }
    if (input.type !== 'mouseMove') return;
    // La pagina riceve il puntatore solo dove la barra non c'è: vale più di un'uscita persa per strada.
    this.dentro = false;
    // Aperta da tastiera o dalla chat, il mouse che si muove sulla pagina non la chiude.
    if (this.motivo !== 'tasto' && this.motivo !== 'chat') this._programmaUscita();
  }

  _programmaUscita() {
    if (this.timer.uscita) return;
    this.timer.uscita = setTimeout(() => {
      this.timer.uscita = null;
      if (!this.dentro) this.chiudi();
    }, this.opzioni.uscitaMs);
  }

  // ── il bordo che la vista non vede ───────────────────────────────────────
  // Finché il puntatore non è dentro la pagina lontano dal bordo, il main lo guarda da sé: chi ci arriva di
  // corsa, o rientra da fuori della finestra, nella pagina non lascia traccia.

  // Dalla pagina: il puntatore si muove, forse verso il bordo.
  _forseBordo() {
    if (this.timer.sonda) return;
    const ora = Date.now();
    if (ora - this.ultimaSonda < 40) return;
    this.ultimaSonda = ora;
    if (this._dovePuntatore() !== 'lontano') this._guarda();
  }

  // Il puntatore potrebbe essere fuori dalla pagina: la guardia parte, e si ferma da sola quando ci rientra.
  _guarda() {
    if (this.aperta || this.timer.sonda || !this.opzioni.spinta || !this._guardabile()) return;
    this._sonda(0);
  }

  _guardabile() {
    return !!(this.win && !this.win.isDestroyed() && this.win.isVisible() && !this.win.isMinimized());
  }

  _sonda(dopo = SONDA_MS) {
    this._ferma('sonda');
    this.timer.sonda = setTimeout(() => {
      this.timer.sonda = null;
      const { dove, punto, nellaPagina } = this._puntatore();
      if (this.aperta) {
        // Aperta dal bordo: se il puntatore se ne va senza passare dal pannello, si chiude come uscendo.
        if (this.motivo !== 'spinta' || this.dentro) return;
        if (dove === 'lontano') this._programmaUscita();
        else this._sonda();
        return;
      }
      if (!this.opzioni.spinta || !this._guardabile()) { this._segnaBordo(false); return; }
      const quiete = Date.now() < this.quieteFino;
      // Finito un ridimensionamento dal bordo il puntatore è ancora lì: conta solo quando si muove di nuovo.
      if (quiete && punto) this.puntoFermo = punto;
      const fermo = this.tasti.scheda || this.tasti.shell || quiete;
      if (dove === 'bordo' && !fermo && this._mosso(punto)) {
        if (!this.bordoDal) this.bordoDal = Date.now();
        this._segnaBordo(true);
        if (Date.now() - this.bordoDal >= this.opzioni.attesaMs) { this.apri('spinta'); return; }
      } else {
        this._segnaBordo(false);
      }
      // Dentro la pagina, lontano dal bordo, il puntatore lo racconta lei.
      if (dove === 'lontano' && nellaPagina) return;
      this._sonda(dove === 'lontano' ? SONDA_LONTANO_MS : SONDA_MS);
    }, dopo);
  }

  // Dopo un rilascio o una chiusura il bordo conta solo quando il puntatore si muove: chi finisce lì una
  // selezione o il trascinamento di una scheda, o chiude la barra col puntatore sul bordo, non sta spingendo.
  _mosso(p) {
    const f = this.puntoFermo;
    if (!f || !p) return true;
    if (p.x === f.x && p.y === f.y) return false;
    this.puntoFermo = null;
    return true;
  }

  // Chi trascina o seleziona arriva sul bordo con un tasto premuto: non spinge. Il movimento dice se il
  // tasto è ancora giù, anche quando il rilascio è andato a un'altra vista.
  _tasti(chi, input) {
    const t = input && input.type;
    if (t === 'mouseDown') this.tasti[chi] = true;
    else if (t === 'mouseUp') {
      this.tasti[chi] = false;
      this.puntoFermo = this._punto();
      this._guarda();
    } else if (t === 'mouseMove') {
      this.tasti[chi] = Boolean(tastoPremuto(input));
    }
  }

  _inputDellaShell(input) {
    if (!input) return;
    this._tasti('shell', input);
    // Dalla fila delle schede il puntatore scende lungo il bordo senza passare dalla pagina.
    if (input.type === 'mouseMove' || input.type === 'mouseLeave') this._guarda();
  }

  _punto() {
    try { return require('electron').screen.getCursorScreenPoint(); } catch (_) { return null; }
  }

  _dovePuntatore() { return this._puntatore().dove; }

  // dove: 'bordo' nella fascia del sistema, 'vicino' sulla pagina a due passi, 'lontano' altrove.
  // nellaPagina: sopra la scheda, sotto la fila delle schede.
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
    const dx = p.x - cb.x;
    const inAltezza = p.y >= alto && p.y < cb.y + cb.height;
    const nellaPagina = inAltezza && dx >= BORDO && dx < cb.width;
    if (!inAltezza || dx < 0 || dx >= VICINO) return { dove: 'lontano', punto: p, nellaPagina };
    return { dove: dx < BORDO ? 'bordo' : 'vicino', punto: p, nellaPagina };
  }

  _segnaBordo(v) {
    if (!v) this.bordoDal = 0;
    if (this.bordo === !!v) return;
    this.bordo = !!v;
    this._invia();
  }

  _ferma(nome) {
    if (this.timer[nome]) { clearTimeout(this.timer[nome]); this.timer[nome] = null; }
  }

  _haFuoco() {
    try { return !!(this.vista && this.vista.webContents.isFocused()); } catch (_) { return false; }
  }

  _restituisciTastiera() {
    try { this.tabs._tastieraAllaSchedaAttiva(); } catch (_) {}
  }

  // ── posa e stato ─────────────────────────────────────────────────────────

  posa() {
    if (!this.win || this.win.isDestroyed()) return;
    const vista = this._vista();
    if (!vista) return;
    const [, H] = this.win.getContentSize();
    const y = Math.max(0, Math.round(this.alto()));
    const largo = this.aperta || this.timer.stringi;
    const chiusa = this._larghezzaChiusa();
    const w = largo ? PANNELLO + OMBRA : chiusa;
    vista.setBounds({ x: 0, y, width: w, height: Math.max(0, H - y) });
    this._inCima();
    vista.setVisible(true);
    const sotto = this.aperta ? this.tabs.vistaSottoIlVuoto() : null;
    if (sotto) this.vuoto.segui(sotto.webContents);
    if (chiusa !== this.strisciaPx) { this.strisciaPx = chiusa; this._invia(); }
    // Il layout cambia anche per lo schermo intero: la voce che lo dice va ridetta.
    this.aggiornaNav();
  }

  // Dove il sistema si prende la fascia del bordo, la striscia chiusa è larga anche oltre: lì si clicca.
  _larghezzaChiusa() {
    let fascia = false;
    try { fascia = !this.tabs.contentFullscreen && !this.win.isMaximized() && !this.win.isFullScreen(); } catch (_) {}
    return fascia ? BORDO + STRISCIA : STRISCIA;
  }

  // Ogni scheda nuova entra in cima alle viste della finestra: la barra deve tornarle sopra, e sopra
  // l'avviso del sito pericoloso che copre la scheda (Indietro serve proprio lì) e la conferma a schermo sopra
  // la scheda (#592.6), che sta sopra gli avvisi; senza conferma gli avvisi restano l'ultima vista.
  _inCima() {
    if (!this.vista || !this.win || this.win.isDestroyed()) return;
    const cv = this.win.contentView;
    const figli = () => cv.children || [];
    const daCoprire = new Set(this.tabs.tabs.map((t) => t.view));
    const sito = this.tabs.avvisoSito && this.tabs.avvisoSito.vista;
    if (sito) daCoprire.add(sito);
    const conferme = this.tabs.conferme;
    try { if (conferme && conferme.vista && conferme.vista.getBounds().width > 0) daCoprire.add(conferme.vista); } catch (_) {}
    // La barra aperta copre l'email proposta sotto un campo che le sta accanto: è un gesto dell'utente, la proposta no.
    const proposta = this.tabs.propostaEmail;
    if (proposta && proposta.mostrata && proposta.vista) daCoprire.add(proposta.vista);
    const mia = figli().indexOf(this.vista);
    if (mia >= 0 && !figli().slice(mia + 1).some((v) => daCoprire.has(v))) return;
    if (mia >= 0) cv.removeChildView(this.vista);
    const avvisi = this.tabs.avvisi && this.tabs.avvisi.vista;
    const ultimaCoperta = figli().reduce((m, v, i) => (daCoprire.has(v) ? i : m), -1);
    const sotto = avvisi ? figli().indexOf(avvisi) : -1;
    if (sotto > ultimaCoperta) cv.addChildView(this.vista, sotto);
    else if (ultimaCoperta >= 0 && ultimaCoperta < figli().length - 1) cv.addChildView(this.vista, ultimaCoperta + 1);
    else cv.addChildView(this.vista);
  }

  disposizione(layout) {
    const D = globalThis.SN_DISPOSIZIONE_ICONE;
    if (!D || !D.valida(layout)) return;
    this.layout = { primary: [...layout.primary], secondary: [...layout.secondary], bar: [...(layout.bar || [])] };
    this._invia();
  }

  _zonaDi(id) {
    if (!this.layout) return null;
    if (this.layout.bar.includes(id)) return 'bar';
    if (this.layout.secondary.includes(id)) return 'secondary';
    return null;
  }

  // Le azioni della pagina che si vedono adesso: quelle della barra, e quelle di «Altro…» se è aperto.
  _idInVista() {
    if (!this.layout) return [];
    return [...this.layout.bar, ...(this.altroAperto ? this.layout.secondary : [])];
  }

  apriAltro(aperto) {
    const v = !!aperto;
    if (v === this.altroAperto) return;
    this.altroAperto = v;
    this._invia();
    if (v && this.aperta) this._chiediEtichette();
  }

  // Ogni posa fatta qui è un cambio dell'utente (#867.1): il registro lo scrive dicendo da dove viene.
  _posa(drop) {
    const R = require('./services/registroCambi');
    return R.con({ via: 'interfaccia', dove: 'barra' }, () => Layout.posa(drop, { incognito: this._incognito() })).catch(() => null);
  }

  // La scheda è cambiata (navigazione, caricamento, schermo intero): si ridice solo se cambia qualcosa.
  aggiornaNav() {
    const t = this._attiva();
    const dove = t ? `${t.id}|${t.url || ''}` : '';
    const cambiataPagina = dove !== this.ultimaPagina;
    this.ultimaPagina = dove;
    this._consegnaInAttesa();
    if (cambiataPagina && this.aperta) this._chiediEtichette();
    const n = JSON.stringify(this._nav());
    if (n === this.ultimoNav && !cambiataPagina) return;
    this.ultimoNav = n;
    this._invia();
  }

  _nav() {
    const t = this._attiva();
    return {
      scheda: !!t,
      // Sotto l'avviso del sito pericoloso la pagina non si vede: le sue azioni aspettano la conferma (regola del vuoto).
      pagina: !!t && this.tabs.vistaSottoIlVuoto() === t.view,
      // Lì il content script non le esegue (#843): accese, sembrerebbero premute a vuoto (#1343 r2).
      spento: !!t && this._spentoSu(t),
      // Filo non c'è nella pagina e non sta arrivando (la stessa notizia dell'Aiuto): un clic andrebbe perso.
      senzaFilo: !!t && !t.aiuto && !t.loading,
      indietro: !!(t && t.canBack),
      avanti: !!(t && t.canFwd),
      schermoIntero: !!this.tabs.contentFullscreen,
      aiuto: this._aiuto(t),
      risposta: !!t && RisposteInAttesa.inAttesa(t),
    };
  }

  // L'icona Aiuto (#1432) da quello che la scheda davanti riferisce del suo pannello. `spenta` dove la voce «Aiuto» del
  // tasto destro non c'è; sotto l'avviso del sito il clic è la domanda a Filo su quel sito, come dalla scorciatoia.
  _aiuto(t) {
    if (!t) return { spenta: 'pagina' };
    const a = t.aiuto;
    if (this.tabs.vistaSottoIlVuoto() !== t.view) return { pannello: 'chiuso', spenta: a && a.spento === 'aiuto' ? 'aiuto' : '' };
    // Nessuna notizia dalla pagina: si sta ancora caricando, o Filo lì dentro non c'è (il visore PDF).
    if (!a) return t.loading ? { pannello: 'chiuso' } : { spenta: 'pagina' };
    if (a.spento) return { spenta: a.spento };
    return { pannello: a.pannello, voce: a.voce, risposta: RisposteInAttesa.inAttesa(t, 'aiuto') };
  }

  _attiva() {
    return this.tabs.tabs.find((t) => t.id === this.tabs.activeId) || null;
  }

  _spentoSu(t) {
    if (!this.spentiSu || !this.spentiSu.length) return false;
    let url = '';
    try { url = String(t.view.webContents.getURL() || ''); } catch (_) { url = ''; }
    try { return require('./services/handlers/filoSpento').vociCheSpengono(this.spentiSu, [url]).length > 0; } catch (_) { return false; }
  }

  // Tema e profilo li tiene la shell, come per gli avvisi: qui arrivano già calcolati.
  dallaShell(dati) {
    const vars = {};
    const v = dati && dati.tema;
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) if (NOME_VAR.test(k) && typeof val === 'string') vars[k] = val;
    }
    this.tema = vars;
    const a = dati && dati.account;
    this.account = a && typeof a === 'object'
      ? { dentro: a.dentro === true, foto: testo(a.foto).slice(0, 2048), etichetta: testo(a.etichetta).slice(0, 200) }
      : null;
    this._invia();
  }

  _owner() {
    try { return !!require('./auth/google-auth').isAdmin(); } catch (_) { return false; }
  }

  _icone(zona = 'bar') {
    const D = globalThis.SN_DISPOSIZIONE_ICONE;
    const I18n = globalThis.SN_I18N;
    if (!D || !this.layout) return [];
    const nav = this._nav();
    const owner = this._owner();
    const dallaPagina = this._etichetteAttive();
    const out = [];
    for (const id of this.layout[zona] || []) {
      const d = D.ICONE[id];
      if (!d || (d.soloOwner && !owner)) continue;
      if (d.tipo === 'aiuto') { out.push(this._iconaAiuto(id, nav.aiuto)); continue; }
      let icona = d.icona;
      let chiave = d.etichetta;
      if (id === 'fullscreen' && nav.schermoIntero) { icona = 'shrink'; chiave = 'menu_exit_fullscreen'; }
      let etichetta = I18n ? I18n.t(chiave) : id;
      const sp = dallaPagina && dallaPagina[id];
      if (sp) { icona = sp.icona; if (sp.etichetta) etichetta = sp.etichetta; }
      const spenta = (id === 'back' && !nav.indietro) || (id === 'forward' && !nav.avanti)
        || ((id === 'reload' || id === 'closeTab') && !nav.scheda) || (d.tipo === 'pagina' && (!nav.pagina || nav.spento || nav.senzaFilo));
      const tasto = id === 'fullscreen' && globalThis.SN_TASTI ? globalThis.SN_TASTI.etichettaSchermoIntero() : '';
      const perche = d.tipo !== 'pagina' ? '' : nav.spento ? 'Filo è spento su questo sito'
        : nav.senzaFilo ? 'Su questa pagina Filo non può agire' : '';
      out.push({ id, icona, etichetta, tasto, perche, spenta, accesa: id === 'fullscreen' && nav.schermoIntero, pagina: d.tipo === 'pagina', contagocce: !!d.contagocce });
    }
    return out;
  }

  _iconaAiuto(id, a) {
    const D = globalThis.SN_DISPOSIZIONE_ICONE;
    const I18n = globalThis.SN_I18N;
    const t = (k) => (I18n ? I18n.t(k) : k);
    const aspetto = D.aspettoAiuto(a);
    const spenta = !!a.spenta;
    const T = globalThis.SN_TASTI;
    const tasto = !spenta && aspetto.icona === 'help' && T ? T.etichettaFilo(T.scorciatoiaFilo('open-help-sidebar')) : '';
    return {
      id, icona: aspetto.icona, etichetta: t(aspetto.etichetta), tasto, spenta,
      motivo: spenta ? t(MOTIVI_AIUTO_SPENTO[a.spenta] || MOTIVI_AIUTO_SPENTO.pagina) : '',
      accesa: !spenta && aspetto.ascolta, ascolta: !spenta && aspetto.ascolta, risposta: !spenta && !!a.risposta, pagina: false,
    };
  }

  // ── le azioni della pagina, col nome che hanno sulla pagina ──────────────

  _etichetteAttive() {
    const e = this.etichettePagina;
    const t = this._attiva();
    return e && t && e.tabId === t.id && e.url === (t.url || '') ? e.voci : null;
  }

  _chiediEtichette() {
    const D = globalThis.SN_DISPOSIZIONE_ICONE;
    const t = this._attiva();
    if (!D || !t || !this.layout) return;
    const ids = this._idInVista().filter((id) => D.ICONE[id] && D.ICONE[id].tipo === 'pagina');
    if (!ids.length) return;
    const tipo = globalThis.SN_MSG?.MSG?.BARRA_ETICHETTE_CHIEDI || 'barra_etichette_chiedi';
    try { t.view.webContents.mainFrame.send('filo:broadcast', { type: tipo, ids }); } catch (_) {}
  }

  // Dalla scheda davanti (handler barra.js): nomi e icone di adesso, solo per le sue azioni che stanno nella barra.
  etichette(tabId, voci) {
    const D = globalThis.SN_DISPOSIZIONE_ICONE;
    const t = this._attiva();
    if (!D || !t || t.id !== tabId || !this.layout) return;
    const prima = this.etichettePagina && this.etichettePagina.tabId === tabId && this.etichettePagina.url === (t.url || '')
      ? this.etichettePagina.voci : {};
    const mappa = { ...prima };
    for (const v of (Array.isArray(voci) ? voci : []).slice(0, 50)) {
      const id = testo(v && v.id);
      const d = D.noto(id) ? D.ICONE[id] : null;
      if (!d || d.tipo !== 'pagina' || !this._zonaDi(id)) continue;
      const ammesse = ICONE_DELLA_PAGINA[id];
      const icona = ammesse && ammesse.has(testo(v.icona)) ? testo(v.icona) : d.icona;
      mappa[id] = { etichetta: testo(v.etichetta).slice(0, 200), icona };
    }
    this.etichettePagina = { tabId, url: t.url || '', voci: mappa };
    this._invia();
  }

  _stato() {
    const T = globalThis.SN_TASTI;
    return {
      aperta: this.aperta,
      tastiera: this.motivo === 'tasto',
      incognito: this._incognito(),
      icone: this._icone('bar'),
      altro: this._icone('secondary'),
      altroAperto: this.altroAperto,
      owner: this._owner(),
      redteam: RedteamGate.visibile(),
      account: this.account,
      tema: this.tema,
      tasto: T ? T.etichettaBarra() : 'Ctrl+Shift+B',
      bordo: this.bordo,
      // Una risposta di Filo da leggere nella scheda davanti (#1432).
      risposta: this._nav().risposta,
      strisciaPx: this.strisciaPx || STRISCIA,
      opzioni: { spinta: this.opzioni.spinta, attesaMs: this.opzioni.attesaMs, striscia: this.opzioni.striscia },
    };
  }

  _invia(extra = {}) {
    if (!this.pronta || !this.vista || this.vista.webContents.isDestroyed()) return;
    try { this.vista.webContents.send('barra:stato', { ...this._stato(), ...extra }); } catch (_) {}
  }

  // ── azioni ──────────────────────────────────────────────────────────────

  // `colore`: il #rrggbb che il contagocce della barra ha preso, per l'icona che lo chiede.
  esegui(id, { colore = '' } = {}) {
    const D = globalThis.SN_DISPOSIZIONE_ICONE;
    const d = D && D.noto(id) ? D.ICONE[id] : null;
    if (!d || !this._zonaDi(id)) return;
    if (d.soloOwner && !this._owner()) return;
    const tabs = this.tabs;
    const attiva = this._attiva();
    if (d.tipo === 'aiuto') { this._passoAiuto(attiva); return; }
    if (d.tipo === 'pagina') {
      const nav = this._nav();
      if (!attiva || !nav.pagina || nav.spento || nav.senzaFilo) return;
      this.chiudi();
      this._restituisciTastiera();
      const conColore = d.contagocce && /^#[0-9a-f]{6}$/i.test(testo(colore)) ? { colore: testo(colore) } : {};
      this.comandoInAttesa = { tabId: attiva.id, iconId: id, ...conColore, scade: Date.now() + ATTESA_DELLA_PAGINA_MS };
      this._consegnaInAttesa();
      return;
    }
    const daTastiera = this.motivo === 'tasto';
    switch (id) {
      case 'back': tabs.navigaCronologia('indietro'); break;
      case 'forward': tabs.navigaCronologia('avanti'); break;
      case 'reload': if (attiva) tabs.reload(attiva.id); break;
      case 'home':
        if (attiva) tabs.navigate(attiva.id, 'filo://newtab/');
        else tabs.openTab('filo://newtab/');
        break;
      case 'newTab': tabs.openTab('filo://newtab/'); break;
      case 'closeTab': if (attiva) tabs.closeTab(attiva.id); break;
      case 'fullscreen': tabs.toggleContentFullscreen(); break;
      case 'incognito': try { require('./window').createIncognitoWindow(); } catch (_) {} break;
      case 'openOptions': tabs.openTab('filo://options/options.html'); break;
      case 'editorApp': tabs.openTab('filo://editor/editor.html'); break;
      case 'feedbackApp': tabs.openTab('filo://feedback/feedback.html'); break;
      default: return;
    }
    // Da tastiera si torna a chi scriveva; col mouse la barra resta finché il puntatore ci sta sopra.
    if (daTastiera) this.chiudi();
  }

  // Un'azione premuta su una pagina che sta ancora arrivando aspetta che Filo ci sia dentro (#1343 r2): mandata
  // prima, nessuno l'ascolterebbe. Vale per la scheda su cui si è premuto, finché resta davanti.
  _consegnaInAttesa() {
    const c = this.comandoInAttesa;
    if (!c) return;
    const t = this._attiva();
    if (!t || t.id !== c.tabId || Date.now() > c.scade) { this.comandoInAttesa = null; return; }
    if (!t.aiuto) return;
    this.comandoInAttesa = null;
    const nav = this._nav();
    if (!nav.pagina || nav.spento) return;
    // Il clic è nella barra, non nella pagina: vale come un gesto dato a Filo su quella scheda (i suoi appunti), mai
    // come un gesto della pagina, che non apre finestre né permessi.
    try { require('./services/permessiPagine').gestoDiFilo(t.view.webContents); } catch (_) {}
    const tipo = globalThis.SN_MSG?.MSG?.TOP_FRAME_COMMAND || 'top_frame_command';
    const colore = c.colore ? { colore: c.colore } : {};
    try { t.view.webContents.mainFrame.send('filo:broadcast', { type: tipo, iconId: c.iconId, daBarra: true, ...colore }); } catch (_) {}
  }

  // Col mouse la barra resta aperta: il secondo clic, senza spostarsi, detta. La pagina decide dal suo stato vero, e
  // la consegna aspetta i suoi pezzi di Filo se si sta ancora caricando.
  _passoAiuto(attiva) {
    if (!attiva) return;
    const a = this._aiuto(attiva);
    if (a.spenta) return;
    const daTastiera = this.motivo === 'tasto';
    if (this.tabs.vistaSottoIlVuoto() !== attiva.view) {
      require('./services/interruttoreAiuto').seAcceso(this.win, () => this.tabs._sbScelta(attiva, 'chiedi'));
      if (daTastiera) this.chiudi();
      return;
    }
    this._restituisciTastiera();
    try { attiva.view.webContents.send('shortcut:triggered', { command: 'aiuto-dalla-barra' }); } catch (_) {}
    if (daTastiera) this.chiudi();
  }

  sistema(comando, dati) {
    if (!FISSE.has(comando)) return;
    if (comando === 'redteam' && !RedteamGate.visibile()) return;
    if (PAGINE_FISSE[comando]) {
      this.tabs.openTab(PAGINE_FISSE[comando]);
      if (this.motivo === 'tasto') this.chiudi();
      return;
    }
    if (!MENU_DELLA_SHELL.has(comando) || !this.vista) return;
    const b = this.vista.getBounds();
    const anchor = { x: b.x + PANNELLO + 6, y: b.y + numero(dati && dati.y, 0, 10000) };
    try { this.win.webContents.send('shell:trigger-button', { command: comando, anchor }); } catch (_) {}
  }

  // Tasto destro su un'icona della barra: la sua azione, e la strada per rimetterla nel menu.
  _menu(dati) {
    if (!this.vista || !this.win || this.win.isDestroyed()) return;
    const d = dati && typeof dati === 'object' ? dati : {};
    let voci = null;
    let scegli = null;
    if (d.striscia) {
      ({ voci, scegli } = this._vociDelBordo());
    } else if (d.ora) {
      ({ voci, scegli } = this._vociDellOra());
    } else if (FISSE.has(testo(d.comando))) {
      if (testo(d.comando) === 'redteam' && !RedteamGate.visibile()) return;
      ({ voci, scegli } = this._vociFisse(testo(d.comando), d));
    } else {
      const id = testo(d.id);
      const zona = this._zonaDi(id);
      const icona = zona ? this._icone(zona).find((i) => i.id === id) : null;
      if (!icona) return;
      voci = [];
      const scheda = this._attiva();
      // Indietro e Avanti: le pagine a cui si può andare, dalla più vicina, come in ogni browser.
      const pagine = (id === 'back' || id === 'forward') && scheda && typeof this.tabs.vociCronologia === 'function'
        ? this.tabs.vociCronologia(id === 'back' ? 'indietro' : 'avanti', scheda.id) : [];
      for (const p of pagine.slice(0, PAGINE_NEL_MENU)) {
        voci.push({ label: (p.titolo || p.url).slice(0, 200), action: `barra:voce:${p.indice}` });
      }
      if (pagine.length > PAGINE_NEL_MENU) {
        const altre = pagine.length - PAGINE_NEL_MENU;
        voci.push({ label: `…e ${altre === 1 ? 'un\'altra pagina' : `altre ${altre} pagine`} ${id === 'back' ? 'più indietro' : 'più avanti'}`, disabled: true });
      }
      if (pagine.length) voci.push({ type: 'separator' });
      else if (!icona.spenta) voci.push({ label: icona.etichetta, action: 'barra:esegui' });
      else if (icona.motivo) voci.push({ label: icona.motivo, disabled: true });
      // Se si può mettere da parte, si può anche riportare in vista: le due voci sono la stessa posa.
      if (zona === 'bar') voci.push({ label: 'Metti in «Altro…»', action: 'barra:altro' });
      else voci.push({ label: 'Porta in vista nella barra', action: 'barra:in-vista' });
      scegli = (a) => {
        if (a === 'barra:esegui') this.esegui(id);
        else if (a === 'barra:altro') this._posa({ id, target: 'secondary', beforeId: null });
        else if (a === 'barra:in-vista') this._posa({ id, target: 'bar', beforeId: null });
        else if (a.startsWith('barra:voce:') && scheda) {
          this.tabs.vaiAllaVoce(scheda.id, Number(a.slice('barra:voce:'.length)));
          if (this.motivo === 'tasto') this.chiudi();
        }
      };
    }
    if (!voci || !voci.length) return;
    const b = this.vista.getBounds();
    this._nascondiSuggerimento();
    this._ferma('uscita');
    this.dentro = true;
    this._apriMenu(voci, b.x + numero(d.x, 0, 10000), b.y + numero(d.y, 0, 10000), scegli);
  }

  // Tasto destro sulla linguetta nella fila delle schede: le stesse scelte della striscia (coordinate della finestra).
  menuDellaManiglia(dati) {
    if (!this.win || this.win.isDestroyed()) return;
    const d = dati && typeof dati === 'object' ? dati : {};
    const { voci, scegli } = this._vociDelBordo();
    this._apriMenu(voci, numero(d.x, 0, 10000), numero(d.y, 0, 10000), scegli);
  }

  _apriMenu(voci, x, y, scegli) {
    const { showPopupMenu } = require('./popup-menu');
    showPopupMenu(this.win, voci, x, y, (scelta) => {
      const s = testo(scelta);
      if (s.startsWith('@action:')) { try { scegli(s.slice(8)); } catch (_) {} }
    });
  }

  _vociDelBordo() {
    const o = this.opzioni;
    const voci = [
      { label: 'Apri la barra laterale', action: 'barra:apri' },
      { type: 'separator' },
      { label: o.striscia ? 'Nascondi la striscia sul bordo' : 'Mostra la striscia sul bordo', action: 'barra:striscia' },
      { label: o.spinta ? 'Non aprirla spingendo sul bordo' : 'Aprila spingendo sul bordo', action: 'barra:spinta' },
      { label: 'Regola la barra laterale…', action: 'barra:regola' },
    ];
    const scegli = (a) => {
      if (a === 'barra:apri') this.apri('clic');
      else if (a === 'barra:striscia') this._scriviOpzioni({ striscia: !this.opzioni.striscia });
      else if (a === 'barra:spinta') this._scriviOpzioni({ spinta: !this.opzioni.spinta });
      else if (a === 'barra:regola') this._apriPagina('regola');
    };
    return { voci, scegli };
  }

  _vociDellOra() {
    const ora = new Date();
    const data = ora.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const orario = ora.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const voci = [
      { label: `${data.charAt(0).toUpperCase()}${data.slice(1)}, ${orario}`, disabled: true },
      { label: 'Copia data e ora', action: 'barra:copia-ora' },
    ];
    const scegli = (a) => {
      if (a === 'barra:copia-ora') {
        try { Promise.resolve(require('electron').clipboard.writeText(`${data} ${orario}`)).catch(() => {}); } catch (_) {}
      }
    };
    return { voci, scegli };
  }

  _vociFisse(comando, d) {
    const apriQui = { label: '', action: 'barra:sistema' };
    const voci = [];
    if (comando === 'history') {
      voci.push({ ...apriQui, label: 'Apri il quaderno delle memorie' }, { label: 'Cronologia AI', action: 'barra:pagina:ai' });
    } else if (comando === 'redteam') {
      voci.push({ ...apriQui, label: 'Apri Red-team' });
    } else if (comando === 'apps') {
      voci.push({ ...apriQui, label: 'Apri il menu App' });
    } else if (comando === 'account') {
      const a = this.account;
      if (a && a.dentro && a.etichetta) voci.push({ label: a.etichetta, disabled: true });
      voci.push({ ...apriQui, label: a && a.dentro ? 'Apri il menu del profilo' : 'Accedi' });
    } else if (comando === 'settings') {
      voci.push({ ...apriQui, label: 'Apri il menu Impostazioni' }, { label: 'Preferenze', action: 'barra:pagina:preferenze' },
        { label: 'Regola la barra laterale…', action: 'barra:pagina:regola' });
    }
    const scegli = (a) => {
      if (a === 'barra:sistema') this.sistema(comando, { y: d.y });
      else if (a.startsWith('barra:pagina:')) this._apriPagina(a.slice('barra:pagina:'.length));
    };
    return { voci, scegli };
  }

  _apriPagina(chiave) {
    const url = PAGINE_DAL_MENU[chiave];
    if (!url) return;
    try { this.tabs.openTab(url); } catch (_) {}
  }

  _scriviOpzioni(parziale) {
    try {
      const { applySettingsUpdate } = require('./services/handlers');
      Promise.resolve(applySettingsUpdate({ barraLaterale: parziale })).catch(() => {});
    } catch (_) {}
  }

  _mostraSuggerimento(dati) {
    const t = testo(dati && dati.testo).slice(0, 300);
    // L'etichetta è della barra aperta: chiusa, la vista si stringe sotto il puntatore senza dirgli che è uscito,
    // e un'etichetta arrivata in ritardo resterebbe sopra la pagina (#1201).
    if (!t || !this.aperta || !this.vista || !this.win || this.win.isDestroyed()) { this._nascondiSuggerimento(); return; }
    const b = this.vista.getBounds();
    this.suggerimento = true;
    try { require('./popup-tooltip').showTooltip(this.win, t, b.x + numero(dati.x, 0, 10000), b.y + numero(dati.y, 0, 10000)); } catch (_) {}
  }

  _nascondiSuggerimento() {
    if (!this.suggerimento) return;
    this.suggerimento = false;
    try { require('./popup-tooltip').hideTooltip(); } catch (_) {}
  }

  // ── la vista ─────────────────────────────────────────────────────────────

  _messaggio(canale, dati) {
    const d = dati && typeof dati === 'object' ? dati : {};
    switch (canale) {
      case 'barra:pronta': this.pronta = true; this._invia(); break;
      case 'barra:spinta': if (!this.aperta) this.apri('spinta'); break;
      case 'barra:apri': if (!this.aperta) this.apri('clic'); break;
      case 'barra:chiudi': this.chiudi(); break;
      case 'barra:dentro':
        this.dentro = true;
        this._ferma('uscita');
        if (this.motivo === 'tasto' && !this._haFuoco()) this.motivo = 'clic';
        break;
      case 'barra:fuori':
        this.dentro = false;
        this._nascondiSuggerimento();
        if (this.aperta && (this.motivo !== 'tasto' || !this._haFuoco())) this._programmaUscita();
        break;
      case 'barra:azione': this.esegui(testo(d.id), { colore: testo(d.colore) }); break;
      case 'barra:sistema': this.sistema(testo(d.comando), d); break;
      case 'barra:menu': this._menu(d); break;
      case 'barra:suggerimento': this._mostraSuggerimento(d); break;
      case 'barra:posa': {
        const D = globalThis.SN_DISPOSIZIONE_ICONE;
        const id = testo(d.id);
        const target = testo(d.target) || 'bar';
        if (!D || !D.noto(id) || !D.ZONE.includes(target)) break;
        const beforeId = d.beforeId ? testo(d.beforeId) : null;
        this._posa({ id, target, beforeId });
        break;
      }
      case 'barra:altro': this.apriAltro(d.aperto === true); break;
      case 'barra:inoltra': this.vuoto.inoltra(d); break;
      case 'barra:chiedi': this._chiediEtichette(); break;
      default: break;
    }
  }

  _vista() {
    if (this.vista && !this.vista.webContents.isDestroyed()) return this.vista;
    if (!this.win || this.win.isDestroyed()) return null;
    const { WebContentsView } = require('electron');
    const vista = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'barra-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    vista.setBackgroundColor('#00000000');
    vista.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    this.vista = vista;
    this.pronta = false;
    const wc = vista.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    // Il fuoco è della barra solo quando la si apre da tastiera: un clic lo rende a chi scriveva.
    wc.on('focus', () => setTimeout(() => { if (this.motivo !== 'tasto') this._restituisciTastiera(); }, 0));
    wc.on('before-input-event', (event, input) => {
      if (this.tasto(input)) { event.preventDefault(); return; }
      // I tasti del browser valgono anche col fuoco qui, sulla scheda attiva; poi la tastiera torna a lei.
      const attiva = this._attiva();
      if (attiva && typeof this.tabs.tastoDelBrowser === 'function' && this.tabs.tastoDelBrowser(input, attiva)) {
        event.preventDefault();
        this.chiudi();
        return;
      }
      // Cmd+freccia su Mac vale qui come Cmd+[ (#685.1): naviga se nella barra non si scrive.
      const verso = input.type === 'keyDown' && globalThis.SN_TASTI?.comandoNavigazioneFuoriDalCampo?.(input);
      if (attiva && verso && typeof this.tabs._navigaSeNonScrive === 'function') {
        this.tabs._navigaSeNonScrive(wc, verso, attiva.id).then((fatto) => { if (fatto) this.chiudi(); }, () => {});
      }
    });
    collegaScorciatoie(wc, this.win);
    wc.on('ipc-message', (_e, canale, dati) => this._messaggio(canale, dati));
    wc.on('render-process-gone', () => this._butta({ rinasci: true }));
    wc.loadURL('filo://shell/barra.html' + (this._incognito() ? '?incognito=1' : ''));
    return vista;
  }

  _butta({ rinasci = false } = {}) {
    const vista = this.vista;
    this.vista = null;
    this.pronta = false;
    for (const k of Object.keys(this.timer)) this._ferma(k);
    this._nascondiSuggerimento();
    if (vista) {
      try { if (this.win && !this.win.isDestroyed()) this.win.contentView.removeChildView(vista); } catch (_) {}
      try { if (!vista.webContents.isDestroyed()) vista.webContents.close(); } catch (_) {}
    }
    this.aperta = false;
    this.motivo = null;
    if (rinasci && this.win && !this.win.isDestroyed()) setTimeout(() => this.posa(), 0);
  }
}

module.exports = { BarraLaterale, STRISCIA, PANNELLO };
