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
// Il permesso che Filo chiede per sé (Incolla, Detta) vale per il gesto appena fatto, non per la pagina.
const DURATA_PERMESSO_FILO_MS = 3000;
const USI_PERMESSO_FILO = 3;
const DURATA_SCELTA_SCHERMO_MS = 15000;
const TIPI_DI_FILO = new Set(['appunti', 'microfono']);

let dip = {};
function electron() { return dip.electron || require('electron'); }
function archivio() { return dip.archivio || require('../shim/storage'); }

const stato = {
  scelte: Object.create(null),
  caricato: false,
  caricamento: null,
  ascoltaArchivio: false,
  incognito: new WeakMap(),
  sessioniIncognito: new WeakSet(),
  installate: new WeakSet(),
  attese: new Map(),
  permessiFilo: new Map(),
  schermoScelto: new Map(),
  cablate: new WeakSet(),
  ascoltatori: new Set(),
};
let prossimoId = 1;

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

// ── memoria delle scelte ────────────────────────────────────────────────────

function incognito(ses) { return !!ses && stato.sessioniIncognito.has(ses); }

function mappaDi(ses) {
  if (!incognito(ses)) return stato.scelte;
  let m = stato.incognito.get(ses);
  if (!m) { m = Object.create(null); stato.incognito.set(ses, m); }
  return m;
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
  for (const k of Array.from(stato.permessiFilo.keys())) if (k.startsWith(`${wcId}:`)) stato.permessiFilo.delete(k);
  stato.schermoScelto.delete(wcId);
  if (tocca) aggiornaScheda(tocca);
}

function cabla(wc) {
  if (!vivo(wc) || stato.cablate.has(wc)) return;
  stato.cablate.add(wc);
  const id = wc.id;
  // La domanda riguarda il documento che l'ha fatta: se ne arriva un altro, per quello vecchio la risposta è no.
  try { wc.on('did-navigate', () => annullaPer(id)); } catch (_) {}
  try { wc.on('render-process-gone', () => annullaPer(id)); } catch (_) {}
  try { wc.once('destroyed', () => annullaPer(id)); } catch (_) {}
}

function stessoAmbito(a, b) {
  return incognito(a) || incognito(b) ? a === b : true;
}

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

function accoda({ ses, wc, origine, tipi, rispondi }) {
  const chiave = `${wc.id}|${origine}|${tipi.join(',')}`;
  for (const v of stato.attese.values()) {
    if (v.chiave !== chiave) continue;
    if (v.richiami.length >= TETTO_ATTESE_PER_DOMANDA) { rispondi(false); return; }
    v.richiami.push(rispondi);
    return;
  }
  const perScheda = Array.from(stato.attese.values()).filter((v) => v.wcId === wc.id).length;
  if (perScheda >= TETTO_DOMANDE_PER_SCHEDA) { rispondi(false); return; }
  const voce = { id: `perm-${prossimoId++}`, chiave, ses, wc, wcId: wc.id, origine, tipi, richiami: [rispondi], at: Date.now() };
  stato.attese.set(voce.id, voce);
  cabla(wc);
  aggiornaScheda(wc);
}

function inAttesaPer(wc) {
  if (!vivo(wc)) return [];
  const out = [];
  for (const v of stato.attese.values()) {
    if (v.wcId !== wc.id) continue;
    out.push({ id: v.id, origine: v.origine, host: P.hostDi(v.origine), tipi: v.tipi.slice(), testo: P.domanda(v.origine, v.tipi) });
  }
  return out;
}

// ── il permesso che Filo chiede per sé ──────────────────────────────────────

function concediAFilo(wc, tipo) {
  if (!vivo(wc) || !TIPI_DI_FILO.has(tipo)) return false;
  stato.permessiFilo.set(`${wc.id}:${tipo}`, { scade: Date.now() + DURATA_PERMESSO_FILO_MS, usi: USI_PERMESSO_FILO });
  cabla(wc);
  return true;
}

function permessoFiloAttivo(wc, tipi) {
  if (!vivo(wc) || !tipi.length) return false;
  const ora = Date.now();
  return tipi.every((t) => {
    const g = stato.permessiFilo.get(`${wc.id}:${t}`);
    return !!g && g.scade > ora && g.usi > 0;
  });
}

function usaPermessoFilo(wc, tipi) {
  if (!permessoFiloAttivo(wc, tipi)) return false;
  for (const t of tipi) stato.permessiFilo.get(`${wc.id}:${t}`).usi--;
  return true;
}

// ── i tre gestori della sessione ────────────────────────────────────────────

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
    const url = urlDiRiferimento(wc, dettagli);
    const { innocuo, tipi } = P.tipiRichiesta(permesso, dettagli);
    if (innocuo) return rispondi(true);
    const origine = P.origineDi(url);
    if (!origine) return rispondi(false);
    if (usaPermessoFilo(wc, tipi)) return rispondi(true);
    const decidiOra = () => {
      const d = P.decidi(scelteDi(ses, origine), tipi);
      if (d.esito === 'consenti') return rispondi(true);
      if (d.esito === 'nega') return rispondi(false);
      // Fuori da una scheda (popup di login, finestre nascoste) non c'è un posto dove chiedere.
      if (!vivo(wc) || !schedaDi(wc)) return rispondi(false);
      return accoda({ ses, wc, origine, tipi: d.tipi, rispondi });
    };
    if (stato.caricato) return decidiOra();
    return carica().then(decidiOra, () => rispondi(false));
  } catch (_) {
    return rispondi(false);
  }
}

function controllo(ses, wc, permesso, origineRichiesta, dettagli) {
  try {
    const d = dettagli || {};
    if (daFilo(wc, d)) return true;
    const url = urlDiRiferimento(wc, d) || String(origineRichiesta || '');
    const origine = P.origineDi(url);
    if (!origine) return P.INNOCUI.has(permesso);
    const { tipi } = P.tipiRichiesta(permesso, d);
    if (permessoFiloAttivo(wc, tipi)) return true;
    if (!stato.caricato) return P.INNOCUI.has(permesso);
    return P.consentitoAlControllo(permesso, d, scelteDi(ses, origine));
  } catch (_) {
    return false;
  }
}

function webContentsDelFrame(frame) {
  if (!frame) return null;
  try { return electron().webContents.fromFrame(frame) || null; } catch (_) { return null; }
}

function fonteDelloSchermo(wc, fonti) {
  if (!fonti || !fonti.length) return null;
  try {
    const s = schedaDi(wc);
    const { screen } = electron();
    const id = s && s.win ? String(screen.getDisplayMatching(s.win.getBounds()).id) : '';
    return fonti.find((f) => String(f.display_id) === id) || fonti[0];
  } catch (_) {
    return fonti[0];
  }
}

// La scelta di cosa condividere è arrivata con il «Consenti» della barra; senza, lo schermo non esce.
function schermo(_ses, req, callback) {
  let risposto = false;
  const rispondi = (flussi) => {
    if (risposto) return;
    risposto = true;
    try { callback(flussi || {}); } catch (_) {}
  };
  try {
    const wc = webContentsDelFrame(req && req.frame);
    const scelta = wc ? stato.schermoScelto.get(wc.id) : 0;
    if (!wc || !scelta || scelta < Date.now()) return rispondi({});
    stato.schermoScelto.delete(wc.id);
    return Promise.resolve(electron().desktopCapturer.getSources({ types: ['screen'] }))
      .then((fonti) => { const f = fonteDelloSchermo(wc, fonti); rispondi(f ? { video: f } : {}); })
      .catch(() => rispondi({}));
  } catch (_) {
    return rispondi({});
  }
}

function installa(ses) {
  if (!ses || stato.installate.has(ses)) return false;
  stato.installate.add(ses);
  try { ses.setPermissionRequestHandler((wc, permesso, cb, dettagli) => richiesta(ses, wc, permesso, dettagli, cb)); } catch (_) {}
  try { ses.setPermissionCheckHandler((wc, permesso, origine, dettagli) => controllo(ses, wc, permesso, origine, dettagli)); } catch (_) {}
  try { ses.setDisplayMediaRequestHandler((req, cb) => schermo(ses, req, cb)); } catch (_) {}
  return true;
}

// Il posto dove nascono le partizioni: ogni sessione, anche quelle che nasceranno domani, parte protetta.
function installaOvunque(app, sessionModule) {
  app.on('session-created', (ses) => installa(ses));
  const predefinita = () => { try { installa(sessionModule.defaultSession); } catch (_) {} };
  if (typeof app.isReady === 'function' && app.isReady()) predefinita();
  else if (typeof app.whenReady === 'function') app.whenReady().then(predefinita, () => {});
}

function protetta(ses) { return !!ses && stato.installate.has(ses); }

function segnaIncognito(ses) { if (ses) stato.sessioniIncognito.add(ses); }

// ── risposte e modifiche dall'interfaccia ───────────────────────────────────

function rispondiDomanda(id, scelta) {
  const v = stato.attese.get(String(id || ''));
  if (!v) return { ok: false, error: 'not_found' };
  if (scelta !== 'consenti' && scelta !== 'nega' && scelta !== 'ignora') return { ok: false, error: 'bad_choice' };
  let scritto = false;
  if (scelta !== 'ignora') {
    for (const t of v.tipi) if (P.ricordabile(t)) scritto = scrivi(v.ses, v.origine, t, scelta) || scritto;
  }
  if (scelta === 'consenti' && v.tipi.includes('schermo')) stato.schermoScelto.set(v.wcId, Date.now() + DURATA_SCELTA_SCHERMO_MS);
  chiudi(v, scelta === 'consenti');
  if (scritto) {
    rivaluta(v.ses, v.origine);
    salva(v.ses);
  }
  aggiornaScheda(v.wc);
  return { ok: true };
}

function imposta(ses, origine, tipo, scelta) {
  if (!scrivi(ses, origine, tipo, scelta === undefined ? null : scelta)) return { ok: false, error: 'bad_request' };
  if (scelta) rivaluta(ses, origine);
  salva(ses);
  return { ok: true };
}

function dimentica(ses, origine) {
  const m = mappaDi(ses);
  if (!Object.prototype.hasOwnProperty.call(m, origine)) return { ok: true };
  delete m[origine];
  salva(ses);
  return { ok: true };
}

function elenco(ses) {
  const m = mappaDi(ses);
  return Object.keys(m)
    .map((origine) => ({ origine, host: P.hostDi(origine), scelte: { ...m[origine] } }))
    .sort((a, b) => a.host.localeCompare(b.host));
}

function perSito(ses, origine) {
  const s = scelteDi(ses, origine);
  return { origine, host: P.hostDi(origine), scelte: s ? { ...s } : {} };
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
  stato.incognito = new WeakMap();
  stato.sessioniIncognito = new WeakSet();
  stato.installate = new WeakSet();
  stato.attese.clear();
  stato.permessiFilo.clear();
  stato.schermoScelto.clear();
  stato.cablate = new WeakSet();
  stato.ascoltatori.clear();
}

module.exports = {
  CHIAVE,
  installa,
  installaOvunque,
  protetta,
  segnaIncognito,
  carica,
  inAttesaPer,
  rispondi: rispondiDomanda,
  imposta,
  dimentica,
  elenco,
  perSito,
  concediAFilo,
  schedaPerId,
  alCambio,
  _perTest,
  _azzera,
};
