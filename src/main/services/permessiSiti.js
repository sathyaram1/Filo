// Custode dei permessi che i siti chiedono: ogni sessione di Electron lo riceve alla nascita (`session-created`).
// Niente di sensibile passa senza un «Consenti» dato fuori dalla pagina, e il silenzio vale no. Regole pure in
// src/shared/permessiSiti.js; racconto in patterns/un-permesso-lo-da-lutente-fuori-dalla-pagina-che-lo-chiede.md.

const path = require('node:path');
const P = require(path.join(__dirname, '..', '..', 'shared', 'permessiSiti.js'));
require(path.join(__dirname, '..', '..', 'shared', 'constants.js'));

const CHIAVE = globalThis.SN_CONST.STORAGE_KEYS.SITE_PERMISSIONS;
// Una pagina che chiede a raffica non gonfia la coda: oltre il tetto la risposta è no, subito.
const TETTO_DOMANDE_PER_SCHEDA = 20;
const TETTO_ATTESE_PER_DOMANDA = 100;
// Chi chiude la domanda tre volte di fila senza rispondere vuol dire «smettila»: Filo smette di chiederla.
const CHIUSURE_PER_SMETTERE = 3;
// Una lettura dei caratteri installati arriva senza richiesta: accende il segno solo appena dopo un gesto vero.
const GESTO_RECENTE_MS = 3000;
const INPUT_VERI = new Set(['mouseDown', 'mouseUp', 'keyDown', 'rawKeyDown', 'char', 'touchStart', 'touchEnd', 'gestureTap']);

let dip = {};
function electron() { return dip.electron || require('electron'); }
function archivio() { return dip.archivio || require('../shim/storage'); }

const stato = {
  scelte: Object.create(null),
  caricato: false,
  caricamento: null,
  ascoltaArchivio: false,
  ambiti: new WeakMap(),
  installate: new WeakSet(),
  attese: new Map(),
  schermoScelto: new Map(),
  usi: new Map(),
  chiusure: new Map(),
  smesso: new Set(),
  dialoghi: new Map(),
  ultimoInput: new WeakMap(),
  cablate: new WeakSet(),
  ascoltatori: new Set(),
  alGestore: null,
};
let prossimoId = 1;
let prossimoAmbito = 1;

function vivo(wc) {
  try { return !!wc && !(wc.isDestroyed && wc.isDestroyed()); } catch (_) { return false; }
}

function urlDi(wc) {
  try { return vivo(wc) ? String(wc.getURL() || '') : ''; } catch (_) { return ''; }
}

function schedaDi(wc) {
  if (dip.schedaDi) return dip.schedaDi(wc);
  if (!vivo(wc)) return null;
  try {
    for (const w of electron().BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm || !Array.isArray(tm.tabs)) continue;
      const tab = tm.tabs.find((t) => {
        const c = t && t.view && t.view.webContents;
        return vivo(c) && c.id === wc.id;
      });
      if (tab) return { tab, manager: tm, win: w };
    }
  } catch (_) {}
  return null;
}

function schedaPerId(tabId) {
  if (dip.schedaPerId) return dip.schedaPerId(tabId);
  try {
    for (const w of electron().BrowserWindow.getAllWindows()) {
      const tab = w._filoTabs && Array.isArray(w._filoTabs.tabs) && w._filoTabs.tabs.find((t) => t && t.id === tabId);
      if (tab) return { tab, manager: w._filoTabs, win: w };
    }
  } catch (_) {}
  return null;
}

function tutteLeSchede() {
  if (dip.tutteLeSchede) return dip.tutteLeSchede();
  const out = [];
  try {
    for (const w of electron().BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm || !Array.isArray(tm.tabs)) continue;
      for (const tab of tm.tabs) out.push({ tab, manager: tm, win: w });
    }
  } catch (_) {}
  return out;
}

// ── memoria delle scelte ────────────────────────────────────────────────────

// Una finestra incognito e le sue schede «da un altro paese» hanno sessioni diverse ma un ambito solo.
function ambitoDi(ses) { return (ses && stato.ambiti.get(ses)) || null; }
function incognito(ses) { return !!ambitoDi(ses); }
function chiaveAmbito(ses) { const a = ambitoDi(ses); return a ? a.chiave : 'normale'; }

function mappaDi(ses) {
  const a = ambitoDi(ses);
  return a ? a.scelte : stato.scelte;
}

// In incognito non si eredita niente e non si scrive niente su disco: la finestra parte da capo.
function scelteDi(ses, origine) {
  const m = mappaDi(ses);
  return Object.prototype.hasOwnProperty.call(m, origine) ? m[origine] : undefined;
}

function copia(scelte) {
  const out = {};
  for (const o of Object.keys(scelte)) out[o] = { ...scelte[o] };
  return out;
}

function carica() {
  if (stato.caricato) return Promise.resolve();
  if (stato.caricamento) return stato.caricamento;
  const A = archivio();
  if (!stato.ascoltaArchivio && typeof A.onChanged === 'function') {
    stato.ascoltaArchivio = true;
    // Un backup importato scrive la chiave da sé: la memoria si riallinea al disco.
    A.onChanged((changes) => {
      if (!changes || !changes[CHIAVE]) return;
      stato.scelte = P.normalizza(changes[CHIAVE].newValue);
      stato.caricato = true;
      rivalutaTutto();
      avvisa();
    });
  }
  stato.caricamento = Promise.resolve()
    .then(() => A.get(CHIAVE))
    .then((v) => { if (!stato.caricato) stato.scelte = P.normalizza(v && v[CHIAVE]); })
    .catch(() => {})
    .then(() => { stato.caricato = true; stato.caricamento = null; });
  return stato.caricamento;
}

function persisti() {
  const A = archivio();
  const scrivi = () => A.set({ [CHIAVE]: copia(stato.scelte) });
  // Una scrittura dell'ambito normale partita da una finestra incognito finirebbe nella RAM di quella finestra.
  const p = typeof A.fuoriIncognito === 'function' ? A.fuoriIncognito(scrivi) : scrivi();
  return Promise.resolve(p).catch(() => {});
}

function scrivi(ses, origine, tipo, scelta) {
  if (!P.origineDi(origine) || P.origineDi(origine) !== origine || !P.ricordabile(tipo)) return false;
  if (scelta !== 'consenti' && scelta !== 'nega' && scelta !== null) return false;
  const m = mappaDi(ses);
  const voce = Object.prototype.hasOwnProperty.call(m, origine) ? m[origine] : Object.create(null);
  if (scelta === null) delete voce[tipo];
  else voce[tipo] = scelta;
  if (Object.keys(voce).length) m[origine] = voce;
  else delete m[origine];
  return true;
}

function salva(ses) {
  if (!incognito(ses)) persisti();
  avvisa();
}

function avvisa() {
  for (const fn of stato.ascoltatori) { try { fn(); } catch (_) {} }
  avvisaPagine();
}

// ── chiusure senza risposta ─────────────────────────────────────────────────

function chiaveChiusura(ses, origine, tipo) { return `${chiaveAmbito(ses)}|${origine}|${tipo}`; }

function haSmesso(ses, origine, tipi) {
  return (tipi || []).some((t) => stato.smesso.has(chiaveChiusura(ses, origine, t)));
}

function contaChiusura(ses, origine, tipi) {
  for (const t of tipi) {
    const k = chiaveChiusura(ses, origine, t);
    const n = (stato.chiusure.get(k) || 0) + 1;
    if (n >= CHIUSURE_PER_SMETTERE) { stato.chiusure.delete(k); stato.smesso.add(k); } else stato.chiusure.set(k, n);
  }
}

function azzeraChiusure(ses, origine, tipi) {
  for (const t of tipi || Object.keys(P.TIPI)) {
    const k = chiaveChiusura(ses, origine, t);
    stato.chiusure.delete(k);
    stato.smesso.delete(k);
  }
}

// ── cosa ha la scheda in questo documento ───────────────────────────────────

// Lo stato vero di una traccia vive nella pagina: qui si sa cosa le è stato consegnato, e cosa negato.
function usiDi(wc, origine) {
  let u = stato.usi.get(wc.id);
  if (!u || u.origine !== origine) {
    u = { origine, ses: wc.session || null, inUso: new Set(), bloccati: new Map() };
    stato.usi.set(wc.id, u);
    cabla(wc);
  }
  return u;
}

function segnaUso(wc, origine, tipi) {
  if (!vivo(wc) || !schedaDi(wc)) return;
  const u = usiDi(wc, origine);
  let cambiato = false;
  for (const t of tipi) {
    if (t !== 'schermo' && !(P.TIPI[t] && P.TIPI[t].continuo)) continue;
    if (!u.inUso.has(t)) { u.inUso.add(t); cambiato = true; }
    if (u.bloccati.delete(t)) cambiato = true;
  }
  if (cambiato) aggiornaScheda(wc);
}

function segnaBlocco(wc, origine, tipi, motivo) {
  if (!vivo(wc) || !schedaDi(wc)) return;
  const u = usiDi(wc, origine);
  let cambiato = false;
  for (const t of tipi) {
    if (!P.eTipo(t) || u.bloccati.get(t) === motivo) continue;
    u.bloccati.set(t, motivo);
    cambiato = true;
  }
  if (cambiato) aggiornaScheda(wc);
}

function togliBlocchi(ses, origine, tipi) {
  for (const [wcId, u] of stato.usi) {
    if (u.origine !== origine || chiaveAmbito(u.ses) !== chiaveAmbito(ses)) continue;
    let cambiato = false;
    for (const t of tipi) if (u.bloccati.delete(t)) cambiato = true;
    if (cambiato) {
      const s = schedaPerIdWc(wcId);
      if (s) aggiornaScheda(s.tab.view.webContents);
    }
  }
}

function schedaPerIdWc(wcId) {
  for (const s of tutteLeSchede()) {
    const c = s.tab && s.tab.view && s.tab.view.webContents;
    if (vivo(c) && c.id === wcId) return s;
  }
  return null;
}

function usiPer(wc) {
  if (!vivo(wc)) return null;
  const u = stato.usi.get(wc.id);
  if (!u || (!u.inUso.size && !u.bloccati.size)) return null;
  return {
    host: P.hostDi(u.origine),
    inUso: Array.from(u.inUso),
    bloccati: Array.from(u.bloccati, ([tipo, motivo]) => ({ tipo, motivo })),
  };
}

// Togliere un permesso non chiude quello che la pagina ha già in mano: lo si dice, da qualunque strada arrivi.
function avvisaAncoraAperti(ses, origine, tipi) {
  const continui = tipi.filter((t) => t === 'schermo' || (P.TIPI[t] && P.TIPI[t].continuo));
  if (!continui.length) return 0;
  let n = 0;
  for (const s of tutteLeSchede()) {
    const wc = s.tab && s.tab.view && s.tab.view.webContents;
    const u = vivo(wc) ? stato.usi.get(wc.id) : null;
    if (!u || u.origine !== origine || chiaveAmbito(u.ses) !== chiaveAmbito(ses)) continue;
    const aperti = continui.filter((t) => u.inUso.has(t));
    if (!aperti.length) continue;
    n++;
    const info = { tabId: s.tab.id, host: P.hostDi(origine), tipi: aperti };
    try {
      if (dip.avvisaAcceso) dip.avvisaAcceso(s, info);
      else if (s.win && s.win.webContents) s.win.webContents.send('shell:permessi-acceso', info);
    } catch (_) {}
  }
  return n;
}

// ── domande in attesa ───────────────────────────────────────────────────────

function aggiornaScheda(wc) {
  const s = schedaDi(wc);
  try { if (s && s.manager && typeof s.manager._broadcast === 'function') s.manager._broadcast(); } catch (_) {}
}

function chiudi(voce, esito) {
  if (!stato.attese.has(voce.id)) return;
  stato.attese.delete(voce.id);
  for (const r of voce.richiami) r(esito);
}

function annullaPer(wcId) {
  let tocca = null;
  for (const v of Array.from(stato.attese.values())) {
    if (v.wcId !== wcId) continue;
    tocca = v.wc;
    chiudi(v, false);
  }
  stato.schermoScelto.delete(wcId);
  const aveva = stato.usi.delete(wcId);
  if (tocca) aggiornaScheda(tocca);
  return aveva;
}

function cabla(wc) {
  if (!vivo(wc) || stato.cablate.has(wc)) return;
  stato.cablate.add(wc);
  const id = wc.id;
  // La domanda riguarda il documento che l'ha fatta: se ne arriva un altro, per quello vecchio la risposta è no.
  try { wc.on('did-navigate', () => { if (annullaPer(id)) aggiornaScheda(wc); }); } catch (_) {}
  try { wc.on('render-process-gone', () => annullaPer(id)); } catch (_) {}
  try { wc.once('destroyed', () => annullaPer(id)); } catch (_) {}
}

function stessoAmbito(a, b) { return chiaveAmbito(a) === chiaveAmbito(b); }

function rivaluta(ses, origine) {
  const toccate = new Set();
  for (const v of Array.from(stato.attese.values())) {
    if (v.origine !== origine || !stessoAmbito(v.ses, ses)) continue;
    const d = P.decidi(scelteDi(v.ses, origine), v.tipi);
    if (d.esito === 'chiedi') continue;
    chiudi(v, d.esito === 'consenti');
    toccate.add(v.wc);
  }
  for (const wc of toccate) aggiornaScheda(wc);
}

function rivalutaTutto() {
  const origini = new Set(Array.from(stato.attese.values()).filter((v) => !incognito(v.ses)).map((v) => v.origine));
  for (const o of origini) rivaluta(null, o);
}

// A schermo intero la pagina copre la striscia: la domanda della scheda che si guarda riporta la cornice.
function scopriLaDomanda(wc) {
  const s = schedaDi(wc);
  try {
    if (s && s.manager && s.manager.contentFullscreen && s.manager.activeId === s.tab.id
      && typeof s.manager.setContentFullscreen === 'function') s.manager.setContentFullscreen(false);
  } catch (_) {}
}

function accoda({ ses, wc, origine, tipi, grezzo, rispondi }) {
  const chiave = `${wc.id}|${origine}|${tipi.join(',')}|${grezzo || ''}`;
  for (const v of stato.attese.values()) {
    if (v.chiave !== chiave) continue;
    if (v.richiami.length >= TETTO_ATTESE_PER_DOMANDA) { rispondi(false); return; }
    v.richiami.push(rispondi);
    return;
  }
  const perScheda = Array.from(stato.attese.values()).filter((v) => v.wcId === wc.id).length;
  if (perScheda >= TETTO_DOMANDE_PER_SCHEDA) { rispondi(false); return; }
  const voce = {
    id: `perm-${prossimoId++}`, chiave, ses, wc, wcId: wc.id, origine, tipi, grezzo: grezzo || '',
    richiami: [rispondi], at: Date.now(),
  };
  stato.attese.set(voce.id, voce);
  cabla(wc);
  scopriLaDomanda(wc);
  aggiornaScheda(wc);
}

function inAttesaPer(wc) {
  if (!vivo(wc)) return [];
  const out = [];
  for (const v of stato.attese.values()) {
    if (v.wcId !== wc.id) continue;
    out.push({
      id: v.id, origine: v.origine, host: P.hostDi(v.origine), tipi: v.tipi.slice(), grezzo: v.grezzo || undefined,
      testo: P.domanda(v.origine, v.tipi, v.grezzo),
    });
  }
  return out;
}

// L'Esc chiude per primo quello che sta sopra la pagina: la domanda, come la ×.
function chiudiPrimaDomanda(wc) {
  if (!vivo(wc)) return false;
  for (const v of stato.attese.values()) {
    if (v.wcId !== wc.id) continue;
    return rispondiDomanda(v.id, 'ignora').ok === true;
  }
  return false;
}

// ── gesti veri ──────────────────────────────────────────────────────────────

function segnaInput(wc, input) {
  if (input && INPUT_VERI.has(input.type)) stato.ultimoInput.set(wc, Date.now());
}

// Un evento finto fabbricato dalla pagina non arriva qui: questo lo vede solo l'input del sistema.
function gestoVeroRecente(wc, ms = GESTO_RECENTE_MS) {
  if (dip.gestoVeroRecente) return dip.gestoVeroRecente(wc, ms);
  const t = wc ? stato.ultimoInput.get(wc) : 0;
  return !!t && Date.now() - t <= ms;
}

// ── fuori da una scheda ─────────────────────────────────────────────────────

// Una finestra di accesso non ha la striscia: si chiede con la finestra di sistema, che la pagina non tocca.
function chiediFuoriScheda({ ses, wc, origine, tipi, grezzo, rispondi }) {
  const E = electron();
  let win = null;
  try { win = E.BrowserWindow && E.BrowserWindow.fromWebContents(wc); } catch (_) { win = null; }
  const visibile = (() => { try { return !!win && !win.isDestroyed() && win.isVisible(); } catch (_) { return false; } })();
  if (!visibile || !E.dialog || typeof E.dialog.showMessageBox !== 'function') return rispondi(false);
  const chiave = `${wc.id}|${origine}|${tipi.join(',')}`;
  let attesa = stato.dialoghi.get(chiave);
  if (!attesa) {
    const schermo = tipi.includes('schermo');
    const ricorda = tipi.some((t) => P.ricordabile(t));
    attesa = Promise.resolve(E.dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Non ora', 'Nega', schermo ? 'Condividi lo schermo' : 'Consenti'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Permesso',
      message: P.domanda(origine, tipi, grezzo),
      detail: ricorda ? 'Filo si ricorda la risposta per questo sito.' : '',
    })).then((r) => ['ignora', 'nega', 'consenti'][r && r.response] || 'ignora', () => 'ignora');
    stato.dialoghi.set(chiave, attesa);
    attesa.then(() => stato.dialoghi.delete(chiave));
    attesa.then((scelta) => {
      if (scelta === 'ignora') return;
      let scritto = false;
      for (const t of tipi) if (P.ricordabile(t)) scritto = scrivi(ses, origine, t, scelta) || scritto;
      if (scelta === 'consenti' && schermo) stato.schermoScelto.set(wc.id, { fonte: '' });
      if (scritto) { rivaluta(ses, origine); salva(ses); }
    });
  }
  attesa.then((scelta) => rispondi(scelta === 'consenti'));
  return undefined;
}

// ── i gestori della sessione ────────────────────────────────────────────────

// #514: un Esc non è il gesto con cui una pagina si prende lo schermo pieno.
function vetoSchermoIntero(wc) {
  const s = schedaDi(wc);
  return !!(s && s.tab && s.tab._ultimoInputEsc);
}

// L'origine che l'utente vede è quella della scheda: un riquadro può chiedere solo se il sito gliel'ha delegato.
function urlDiRiferimento(wc, dettagli) {
  const d = dettagli || {};
  if (d.isMainFrame !== false && d.requestingUrl) return String(d.requestingUrl);
  return urlDi(wc) || String(d.requestingUrl || '');
}

// Conta chi chiede, non chi ospita: un riquadro web dentro una pagina filo:// resta un sito.
function daFilo(wc, dettagli) {
  const richiedente = String((dettagli && dettagli.requestingUrl) || '');
  return richiedente ? P.eFilo(richiedente) : P.eFilo(urlDi(wc));
}

// Lo schermo lo consegna solo il gestore dello schermo, che Chromium chiama DENTRO questo stesso sì: lì si chiede e si
// sceglie. Una richiesta che non ci passa è la strada vecchia (`chromeMediaSource`), che prenderebbe lo schermo intero
// e l'audio del computer senza scelta: la pagina muore prima che la cattura le arrivi.
function lasciaAlGestoreDelloSchermo(wc, rispondi) {
  if (!vivo(wc)) return rispondi(false);
  let passato = false;
  stato.alGestore = () => { passato = true; };
  try { rispondi(true); } finally { stato.alGestore = null; }
  if (!passato) fermaLaStradaVecchia(wc);
  return undefined;
}

function fermaLaStradaVecchia(wc) {
  const s = schedaDi(wc);
  if (s && s.tab) s.tab._chiusaDaFilo = 'schermo';
  if (dip.fermaPagina) return dip.fermaPagina(wc);
  try { wc.forcefullyCrashRenderer(); } catch (_) {}
  return undefined;
}

function richiesta(ses, wc, permesso, dettagli, callback) {
  let risposto = false;
  const rispondi = (ok) => {
    if (risposto) return;
    risposto = true;
    try { callback(!!ok); } catch (_) {}
  };
  try {
    if (permesso === 'fullscreen' && vetoSchermoIntero(wc)) return rispondi(false);
    if (daFilo(wc, dettagli)) return rispondi(true);
    const d0 = dettagli || {};
    const url = urlDiRiferimento(wc, d0);
    const { innocuo, chiuso, tipi, grezzo } = P.tipiRichiesta(permesso, d0);
    if (innocuo) return rispondi(true);
    if (chiuso) return rispondi(false);
    const origine = P.origineDi(url);
    if (!origine) return rispondi(false);
    // Lo schermo lo chiede un documento web: da un riquadro senza indirizzo arriva solo la strada vecchia.
    if (tipi.includes('schermo') && !P.origineDi(d0.requestingUrl || url)) return rispondi(false);
    if (permesso === 'media' && tipi.length === 1 && tipi[0] === 'schermo') return lasciaAlGestoreDelloSchermo(wc, rispondi);
    const decidiOra = () => {
      const d = P.decidi(scelteDi(ses, origine), tipi);
      if (d.esito === 'consenti') { segnaUso(wc, origine, tipi); return rispondi(true); }
      if (d.esito === 'nega') { segnaBlocco(wc, origine, [d.tipo], 'negato'); return rispondi(false); }
      if (haSmesso(ses, origine, d.tipi)) { segnaBlocco(wc, origine, d.tipi, 'smesso'); return rispondi(false); }
      if (!vivo(wc)) return rispondi(false);
      if (!schedaDi(wc)) return chiediFuoriScheda({ ses, wc, origine, tipi: d.tipi, grezzo, rispondi });
      return accoda({
        ses, wc, origine, tipi: d.tipi, grezzo,
        rispondi: (ok) => { if (ok) segnaUso(wc, origine, tipi); rispondi(ok); },
      });
    };
    if (stato.caricato) return decidiOra();
    return carica().then(decidiOra, () => rispondi(false));
  } catch (_) {
    return rispondi(false);
  }
}

// Chromium non chiede mai i caratteri installati, li legge soltanto: una lettura subito dopo un gesto accende il segno
// sulla scheda, da cui si consentono. Niente striscia: una lettura non è una domanda.
function segnaDaChiedere(ses, wc, origine, tipi) {
  if (!vivo(wc) || !schedaDi(wc) || !gestoVeroRecente(wc)) return;
  if (P.decidi(scelteDi(ses, origine), tipi).esito !== 'chiedi') return;
  segnaBlocco(wc, origine, tipi, 'chiedi');
}

function controllo(ses, wc, permesso, origineRichiesta, dettagli) {
  try {
    const d = dettagli || {};
    if (daFilo(wc, d)) return true;
    const url = urlDiRiferimento(wc, d) || String(origineRichiesta || '');
    const origine = P.origineDi(url);
    if (!origine) return P.INNOCUI.has(permesso);
    if (!stato.caricato) return P.INNOCUI.has(permesso);
    const ok = P.consentitoAlControllo(permesso, d, scelteDi(ses, origine));
    if (!ok && permesso === 'local-fonts') segnaDaChiedere(ses, wc, origine, ['caratteri']);
    return ok;
  } catch (_) {
    return false;
  }
}

function webContentsDelFrame(frame) {
  if (!frame) return null;
  try { return electron().webContents.fromFrame(frame) || null; } catch (_) { return null; }
}

function schermoDellaScheda(wc, schermi) {
  if (!schermi || !schermi.length) return null;
  try {
    const s = schedaDi(wc);
    const { screen } = electron();
    const id = s && s.win ? String(screen.getDisplayMatching(s.win.getBounds()).id) : '';
    return schermi.find((f) => String(f.display_id) === id) || schermi[0];
  } catch (_) {
    return schermi[0];
  }
}

// Qui si chiede, con la striscia o la finestra di sistema, e si consegna quello che l'utente ha scelto; senza, niente.
function schermo(ses, req, callback) {
  if (stato.alGestore) { const f = stato.alGestore; stato.alGestore = null; f(); }
  let risposto = false;
  const rispondi = (flussi) => {
    if (risposto) return;
    risposto = true;
    try { callback(flussi || {}); } catch (_) {}
  };
  try {
    const wc = webContentsDelFrame(req && req.frame);
    const origine = vivo(wc) ? P.origineDi(urlDi(wc)) : '';
    if (!origine) return rispondi({});
    const consegna = (video) => {
      if (!video || !vivo(wc)) return rispondi({});
      segnaUso(wc, origine, ['schermo']);
      return rispondi({ video });
    };
    const dopo = (ok) => {
      const scelta = stato.schermoScelto.get(wc.id);
      stato.schermoScelto.delete(wc.id);
      if (!ok || !scelta) return rispondi({});
      const fonte = String(scelta.fonte || '');
      if (fonte.startsWith('scheda:')) {
        const s = schedaPerId(fonte.slice('scheda:'.length));
        const c = s && s.tab && s.tab.view && s.tab.view.webContents;
        return consegna(vivo(c) ? c.mainFrame : null);
      }
      return Promise.resolve(electron().desktopCapturer.getSources({ types: ['screen', 'window'] }))
        .then((fonti) => {
          const lista = Array.isArray(fonti) ? fonti : [];
          if (fonte) return consegna(lista.find((f) => f.id === fonte) || null);
          return consegna(schermoDellaScheda(wc, lista.filter((f) => String(f.id).startsWith('screen:'))));
        })
        .catch(() => rispondi({}));
    };
    const chiedi = () => {
      if (!vivo(wc)) return rispondi({});
      if (haSmesso(ses, origine, ['schermo'])) { segnaBlocco(wc, origine, ['schermo'], 'smesso'); return rispondi({}); }
      if (!schedaDi(wc)) return chiediFuoriScheda({ ses, wc, origine, tipi: ['schermo'], grezzo: '', rispondi: dopo });
      return accoda({ ses, wc, origine, tipi: ['schermo'], grezzo: '', rispondi: dopo });
    };
    if (stato.caricato) return chiedi();
    return carica().then(chiedi, () => rispondi({}));
  } catch (_) {
    return rispondi({});
  }
}

// Le scelte possibili per chi ha detto «Condividi lo schermo»: schermi, schede di Filo, finestre delle altre app.
async function fontiPerDomanda(id) {
  const v = stato.attese.get(String(id || ''));
  if (!v || !v.tipi.includes('schermo')) return { ok: false, error: 'not_found' };
  const E = electron();
  const proprie = new Set();
  try { for (const w of E.BrowserWindow.getAllWindows()) { try { proprie.add(w.getMediaSourceId()); } catch (_) {} } } catch (_) {}
  let fonti = [];
  try { fonti = await E.desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } }); } catch (_) { fonti = []; }
  const anteprima = (f) => { try { return f.thumbnail && !f.thumbnail.isEmpty() ? f.thumbnail.toDataURL() : ''; } catch (_) { return ''; } };
  const schermi = fonti.filter((f) => String(f.id).startsWith('screen:'));
  const out = schermi.map((f, i) => ({ id: f.id, tipo: 'schermo', nome: P.nomeSchermo(i, schermi.length), anteprima: anteprima(f) }));
  // Una scheda di Filo si può mostrare solo a un sito dello stesso ambito: l'incognito non si vede da fuori.
  for (const s of tutteLeSchede()) {
    const c = s.tab && s.tab.view && s.tab.view.webContents;
    if (!vivo(c) || !stessoAmbito(c.session, v.ses) || !/^https?:/i.test(urlDi(c))) continue;
    let img = '';
    if (c.id === v.wcId || (s.manager && s.manager.activeId === s.tab.id)) {
      try { const p = await c.capturePage(); img = p && !p.isEmpty() ? p.resize({ width: 320 }).toDataURL() : ''; } catch (_) { img = ''; }
    }
    out.push({ id: `scheda:${s.tab.id}`, tipo: 'scheda', nome: String(s.tab.title || P.hostDi(P.origineDi(urlDi(c))) || 'Scheda'), anteprima: img, questa: c.id === v.wcId || undefined });
  }
  for (const f of fonti) {
    if (!String(f.id).startsWith('window:') || proprie.has(f.id) || !String(f.name || '').trim()) continue;
    out.push({ id: f.id, tipo: 'finestra', nome: String(f.name), anteprima: anteprima(f) });
  }
  return { ok: true, fonti: out };
}

function valida(fonte) {
  const f = String(fonte || '');
  return /^(screen|window):[\w:.-]{1,80}$/.test(f) || /^scheda:[\w-]{1,80}$/.test(f) ? f : '';
}

function installa(ses) {
  if (!ses || stato.installate.has(ses)) return false;
  stato.installate.add(ses);
  try { ses.setPermissionRequestHandler((wc, permesso, cb, dettagli) => richiesta(ses, wc, permesso, dettagli, cb)); } catch (_) {}
  try { ses.setPermissionCheckHandler((wc, permesso, origine, dettagli) => controllo(ses, wc, permesso, origine, dettagli)); } catch (_) {}
  try { ses.setDisplayMediaRequestHandler((req, cb) => schermo(ses, req, cb)); } catch (_) {}
  // Chiavette, porte seriali e dispositivi HID/USB restano chiusi: senza scegliere, nessun dispositivo esce.
  try {
    if (typeof ses.on === 'function') {
      ses.on('select-hid-device', (e, _d, cb) => { try { e.preventDefault(); cb(); } catch (_) {} });
      ses.on('select-serial-port', (e, _l, _wc, cb) => { try { e.preventDefault(); cb(''); } catch (_) {} });
      ses.on('select-usb-device', (e, _d, cb) => { try { e.preventDefault(); cb(); } catch (_) {} });
    }
  } catch (_) {}
  return true;
}

// Senza chi sceglie, Electron consegna al sito il primo dispositivo Bluetooth che trova.
function cablaContenuti(wc) {
  if (!wc || typeof wc.on !== 'function') return;
  try { wc.on('select-bluetooth-device', (e, _devices, cb) => { try { e.preventDefault(); cb(''); } catch (_) {} }); } catch (_) {}
  try { wc.on('input-event', (_e, input) => segnaInput(wc, input)); } catch (_) {}
}

// Il posto dove nascono le partizioni: ogni sessione, anche quelle che nasceranno domani, parte protetta.
function installaOvunque(app, sessionModule) {
  app.on('session-created', (ses) => installa(ses));
  app.on('web-contents-created', (_e, wc) => cablaContenuti(wc));
  const predefinita = () => { try { installa(sessionModule.defaultSession); } catch (_) {} };
  if (typeof app.isReady === 'function' && app.isReady()) predefinita();
  else if (typeof app.whenReady === 'function') app.whenReady().then(predefinita, () => {});
}

function protetta(ses) { return !!ses && stato.installate.has(ses); }

// `compagna`: la sessione della finestra incognito da cui nasce questa (una scheda «da un altro paese»).
function segnaIncognito(ses, compagna) {
  if (!ses) return;
  let a = ambitoDi(compagna) || ambitoDi(ses);
  if (!a) a = { chiave: `incognito-${prossimoAmbito++}`, scelte: Object.create(null) };
  stato.ambiti.set(ses, a);
  if (compagna && !ambitoDi(compagna)) stato.ambiti.set(compagna, a);
}

// ── quello che la pagina legge dei propri permessi ──────────────────────────

// Per il mondo della pagina: i tipi che l'utente ha davvero negato (o su cui Filo ha smesso di chiedere).
// Tutto il resto, se Chromium dice «negato», è in realtà «da chiedere».
function negatiPer(wc) {
  if (!vivo(wc)) return [];
  const origine = P.origineDi(urlDi(wc));
  if (!origine) return [];
  const scelte = scelteDi(wc.session, origine) || {};
  const out = Object.keys(P.TIPI).filter((t) => scelte[t] === 'nega' || haSmesso(wc.session, origine, [t]));
  return out;
}

function avvisaPagine() {
  if (dip.avvisaPagine) { dip.avvisaPagine(); return; }
  for (const s of tutteLeSchede()) {
    const wc = s.tab && s.tab.view && s.tab.view.webContents;
    if (!vivo(wc) || !/^https?:/i.test(urlDi(wc))) continue;
    const lista = negatiPer(wc);
    try {
      const frames = wc.mainFrame && wc.mainFrame.framesInSubtree ? wc.mainFrame.framesInSubtree : [];
      for (const f of frames) { try { f.send('filo:permessi-pagina', lista); } catch (_) {} }
    } catch (_) {}
  }
}

// ── risposte e modifiche dall'interfaccia ───────────────────────────────────

function rispondiDomanda(id, scelta, fonte) {
  const v = stato.attese.get(String(id || ''));
  if (!v) return { ok: false, error: 'not_found' };
  if (scelta !== 'consenti' && scelta !== 'nega' && scelta !== 'ignora') return { ok: false, error: 'bad_choice' };
  let scritto = false;
  if (scelta !== 'ignora') {
    for (const t of v.tipi) if (P.ricordabile(t)) scritto = scrivi(v.ses, v.origine, t, scelta) || scritto;
  }
  const senzaMemoria = v.tipi.filter((t) => !P.ricordabile(t));
  if (scelta === 'ignora') contaChiusura(v.ses, v.origine, v.tipi);
  else if (scelta === 'nega' && senzaMemoria.length) contaChiusura(v.ses, v.origine, senzaMemoria);
  else azzeraChiusure(v.ses, v.origine, v.tipi);
  if (scelta === 'consenti' && v.tipi.includes('schermo')) {
    stato.schermoScelto.set(v.wcId, { fonte: valida(fonte) });
  }
  if (scelta === 'nega') segnaBlocco(v.wc, v.origine, v.tipi.filter((t) => P.ricordabile(t)), 'negato');
  if (scelta !== 'consenti' && haSmesso(v.ses, v.origine, v.tipi)) segnaBlocco(v.wc, v.origine, v.tipi, 'smesso');
  chiudi(v, scelta === 'consenti');
  if (scritto) {
    rivaluta(v.ses, v.origine);
    salva(v.ses);
  } else if (scelta !== 'consenti') avvisaPagine();
  aggiornaScheda(v.wc);
  return { ok: true };
}

function imposta(ses, origine, tipo, scelta) {
  const prima = (scelteDi(ses, origine) || {})[tipo];
  if (!scrivi(ses, origine, tipo, scelta === undefined ? null : scelta)) return { ok: false, error: 'bad_request' };
  azzeraChiusure(ses, origine, [tipo]);
  if (scelta === 'consenti') togliBlocchi(ses, origine, [tipo]);
  if (scelta) rivaluta(ses, origine);
  salva(ses);
  const ancoraAperti = scelta !== 'consenti' ? avvisaAncoraAperti(ses, origine, [tipo]) : 0;
  return { ok: true, prima: prima || null, ancoraAperti };
}

function dimentica(ses, origine) {
  const m = mappaDi(ses);
  azzeraChiusure(ses, origine);
  if (!Object.prototype.hasOwnProperty.call(m, origine)) return { ok: true, ancoraAperti: 0 };
  const tipi = Object.keys(m[origine]);
  delete m[origine];
  salva(ses);
  return { ok: true, ancoraAperti: avvisaAncoraAperti(ses, origine, tipi) };
}

function elenco(ses) {
  const m = mappaDi(ses);
  return Object.keys(m)
    .map((origine) => ({ origine, host: P.hostDi(origine), scelte: { ...m[origine] } }))
    .sort((a, b) => a.host.localeCompare(b.host));
}

function perSito(ses, origine) {
  const s = scelteDi(ses, origine);
  const smesso = Object.keys(P.TIPI).filter((t) => haSmesso(ses, origine, [t]));
  return { origine, host: P.hostDi(origine), scelte: s ? { ...s } : {}, smesso };
}

function alCambio(fn) {
  stato.ascoltatori.add(fn);
  return () => stato.ascoltatori.delete(fn);
}

function _perTest(nuove) { dip = { ...dip, ...(nuove || {}) }; }

function _azzera() {
  dip = {};
  stato.scelte = Object.create(null);
  stato.caricato = false;
  stato.caricamento = null;
  stato.ascoltaArchivio = false;
  stato.ambiti = new WeakMap();
  stato.installate = new WeakSet();
  stato.attese.clear();
  stato.schermoScelto.clear();
  stato.usi.clear();
  stato.chiusure.clear();
  stato.smesso.clear();
  stato.dialoghi.clear();
  stato.ultimoInput = new WeakMap();
  stato.cablate = new WeakSet();
  stato.ascoltatori.clear();
  stato.alGestore = null;
}

module.exports = {
  CHIAVE,
  installa,
  installaOvunque,
  cablaContenuti,
  protetta,
  segnaIncognito,
  incognito,
  carica,
  inAttesaPer,
  usiPer,
  chiudiPrimaDomanda,
  fontiPerDomanda,
  negatiPer,
  gestoVeroRecente,
  rispondi: rispondiDomanda,
  imposta,
  dimentica,
  elenco,
  perSito,
  schedaPerId,
  alCambio,
  _perTest,
  _azzera,
};
