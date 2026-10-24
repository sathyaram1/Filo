// Permessi delle pagine web (#591.1): quello che Chrome chiede lo decide l'utente nella cornice, quello che Chrome concede
// di fabbrica passa. Filo stesso (filo://, la cornice) resta com'era; Detta e Incolla non passano da qui (#586).
// Senza gestore Electron concede tutto: ogni sessione che mostra pagine web passa da `installa` o da `negaTutto`.

'use strict';

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Psl = require('./safebrowse/psl');
const { tastoPremuto } = require('../tastoDelMouse');

// Ciò che Chrome chiede all'utente: si chiede anche qui. Ogni nome che Electron può mandare sta in uno dei gruppi sotto,
// e la sentinella in tests/unit/permessiPagine.test.mjs lo confronta con quelli che Electron dichiara.
const TIPI = {
  media: 'media',
  'clipboard-read': 'appunti',
  'deprecated-sync-clipboard-read': 'appunti',
  geolocation: 'posizione',
  'geolocation-approximate': 'posizione',
  notifications: 'notifiche',
  'window-management': 'schermi',
  'idle-detection': 'presenza',
  // Chrome chiede anche il MIDI senza sysex; Electron 44 ne manda la richiesta come midiSysex, il controllo come midi.
  midi: 'strumenti',
  midiSysex: 'strumenti',
  'local-network-access': 'rete',
  'local-network': 'rete',
  'loopback-network': 'rete',
};
// File e cartelle (#1069): leggere quello che l'utente ha scelto nel selettore passa, la scelta è il consenso; scriverci
// si chiede. Da Electron 39 il controllo È lo stato del file (sì o no, mai «da chiedere»): la scrittura passa solo dopo
// un sì, la domanda la fa partire la pagina (chiediScrittura) e il salvataggio lo riconosce `salvataggio`.
const SECONDO_L_ACCESSO = { fileSystem: (d) => (d && d.fileAccessType === 'readable' ? null : 'file') };
// Il file scelto in «Salva con nome» Chromium lo crea o lo svuota prima di darlo alla pagina: vuoto e appena toccato.
const SALVATAGGIO_MS = 60_000;
// Ciò che Chrome concede di fabbrica passa senza domanda.
const INNOCUI = new Set([
  'fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock', 'mediaKeySystem',
  'storage-access', 'top-level-storage-access',
  'screen-wake-lock', 'background-sync', 'background-fetch', 'sensors', 'payment-handler', 'persistent-storage',
]);
// Ciò che Filo non sa dare è no, senza domanda: i dispositivi collegati vogliono una scelta (quale dispositivo) che Filo
// non ha (lo schermo si condivide da `chiediLoSchermo`, non da questo nome); realtà virtuale, NFC, stampa diretta e app web installate Filo non
// le ha; e quello che Chrome lascia solo alle app installate (schermo intero senza gesto, sincronia periodica) qui non c'è.
// L'uscita audio e i font del computer arrivano solo dal controllo, senza domanda: un sì darebbe a ogni sito i nomi delle
// uscite (che seguono il sì al microfono) e l'elenco dei font installati, un'impronta uguale in ogni sito (#1524).
const NON_DISPONIBILI = new Set([
  'display-capture', 'captured-surface-control', 'unknown', 'hid', 'serial', 'usb', 'smart-card', 'nfc', 'ar', 'vr',
  'hand-tracking', 'web-printing', 'web-app-installation', 'automatic-fullscreen', 'periodic-background-sync',
  'system-wake-lock', 'speaker-selection', 'local-fonts',
]);
// Il controllo dice sì solo dopo un sì vero: la lettura sincrona degli appunti non sa chiedere, le notifiche Electron le
// mostra a chi il controllo dà per concesse, chi sa che sei al computer lo saprebbe senza domanda, e un file o una
// cartella con il controllo a sì si scrivono senza domanda.
const CONTROLLO_SOLO_COL_SI = new Set(['deprecated-sync-clipboard-read', 'notifications', 'idle-detection', 'fileSystem']);
const SOLO_CONTROLLO = new Set(['deprecated-sync-clipboard-read']);
// Notifiche: si chiedono solo subito dopo un gesto dell'utente sulla pagina.
const DOPO_UN_GESTO = new Set(['notifications']);
const GESTO_MS = 5000;
const GESTI = new Set(['mouseDown', 'mouseUp', 'rawKeyDown', 'keyDown', 'char', 'touchStart', 'touchEnd', 'gestureTap']);
// Come in Chrome una finestra la apre l'inizio di un gesto: il rilascio dello stesso clic o il carattere dello stesso
// tasto non ne aprono un'altra (#737.1 giro 2). Due ascolti dello stesso input, a pochi ms, sono un gesto solo.
const AVVII_DI_UN_GESTO = new Set(['mouseDown', 'rawKeyDown', 'keyDown', 'touchEnd']);
const STESSO_GESTO_MS = 50;
// Il clic che Filo dà da sé a una pagina (il «Salta» delle pubblicità) non è un gesto di nessuno: l'input che ne segue,
// anche quello che il riquadro riferisce dopo, si ignora per questo tempo.
const CLIC_DI_FILO_MS = 1500;
const APERTURA_SCELTA_MS = 2000;
const TASTI_SENZA_GESTO = new Set(['Escape', 'Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'OS', 'Super', 'Hyper', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'Symbol', 'SymbolLock']);
// Solo le pagine di Filo sono Filo: ogni altro documento è una pagina web, anche un blob, un data: o un about:.
const DI_FILO = new Set(['filo:', 'devtools:']);
// Le risposte date nelle sessioni che restano su disco restano anche loro, come in Chrome; incognito e siti usa-e-getta no.
const CHIAVE_DISCO = 'sitePermissions';
const sceltePersistenti = new Map();
let disco = () => require('../shim/storage');

const inAttesa = new Map();

// Chi è un documento: Filo, o una pagina web con la sua origine. Un blob porta l'origine del sito che l'ha creato; una pagina
// web di cui l'origine non si legge ha origine null, e riceve no (#591, giro 20).
function classifica(url) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return { origine: null }; }
  if (/^https?:$/.test(u.protocol)) return { origine: u.origin };
  if (u.protocol === 'blob:') return classifica(u.pathname);
  if (DI_FILO.has(u.protocol)) return { filo: true };
  return { origine: null };
}

function origineWeb(url) {
  return classifica(url).origine || null;
}

function urlDi(wc) {
  try { return wc && !wc.isDestroyed() ? wc.getURL() : ''; } catch (_) { return ''; }
}

// Chi chiede è la pagina in cima; un riquadro web dentro una pagina di Filo risponde per sé.
function origineDi(wc, altro) {
  const cima = urlDi(wc);
  const c = classifica(cima || altro);
  // La finestra vuota che il sito apre (window.open) è del sito: l'indirizzo non lo dice, l'origine del suo frame sì.
  if (!c.filo && !c.origine && (!cima || /^about:/i.test(cima))) {
    let ereditata = null;
    try { ereditata = origineWeb(wc.mainFrame.origin); } catch (_) {}
    if (ereditata) return { origine: ereditata };
  }
  if (!c.filo || !cima) return c;
  const r = classifica(altro);
  return r.origine ? r : c;
}

// Come in Chrome un riquadro di un altro sito non ha notifiche: non le chiede col nome del sito che lo ospita e non ne
// eredita il sì (#586).
const SOLO_DALLA_PAGINA = new Set(['notifications']);
function riquadroDiAltri(wc, details, altro) {
  const d = details || {};
  if (d.isMainFrame !== false) return false;
  const chi = origineWeb(d.requestingUrl || altro);
  return !chi || chi !== origineWeb(urlDi(wc));
}

function tipoDi(permission, details) {
  if (Object.hasOwn(SECONDO_L_ACCESSO, permission)) return SECONDO_L_ACCESSO[permission](details);
  return Object.hasOwn(TIPI, permission) ? TIPI[permission] : null;
}

function senzaTipoPassa(permission) {
  return INNOCUI.has(permission) || Object.hasOwn(SECONDO_L_ACCESSO, permission);
}

// Il nome della cartella o del file nella domanda: chi l'ha scelto per farlo leggere riconosce cosa sta per cambiare.
function oggettoDi(tipo, details) {
  if (tipo !== 'file') return undefined;
  const percorso = String((details && details.filePath) || '');
  return { nome: path.basename(percorso) || percorso, percorso, cartella: Boolean(details && details.isDirectory) };
}

// Il file o la cartella su cui il sito ha appena chiesto di scrivere: è quello che la domanda nomina (chiediScrittura).
function segnaFile(ses, origine, details) {
  if (!details || !details.filePath) return;
  (ses._filoUltimoFile ||= new Map()).set(origine, { percorso: String(details.filePath), cartella: Boolean(details.isDirectory), alle: Date.now() });
}

// Un file scelto per salvarci è scrivibile come in Chrome, anche dopo un no alla modifica dei file del sito.
function salvataggio(ses, origine, details) {
  if (!details || details.isDirectory || !details.filePath) return false;
  const chiave = `${origine}|${details.filePath}`;
  const salvati = (ses._filoSalvati ||= new Set());
  if (salvati.has(chiave)) return true;
  let st;
  try { st = fs.statSync(String(details.filePath)); } catch (_) { return false; }
  if (!st.isFile() || st.size !== 0 || Math.abs(Date.now() - st.mtimeMs) > SALVATAGGIO_MS) return false;
  salvati.add(chiave);
  return true;
}

function partiNote(details) {
  const d = details || {};
  const tipi = Array.isArray(d.mediaTypes) ? d.mediaTypes : (d.mediaType ? [d.mediaType] : []);
  return [...new Set(tipi.filter((t) => t === 'audio' || t === 'video'))];
}

function partiDi(tipo, details) {
  if (tipo !== 'media') return [tipo];
  const noti = partiNote(details);
  return noti.length ? noti : ['audio', 'video'];
}

function persistente(ses) {
  try { return Boolean(ses && typeof ses.isPersistent === 'function' && ses.isPersistent()); } catch (_) { return false; }
}

function sceltePer(ses) {
  if (persistente(ses)) return sceltePersistenti;
  if (!ses._filoScelte) ses._filoScelte = new Map();
  return ses._filoScelte;
}

function salva() {
  try {
    Promise.resolve(disco().set({ [CHIAVE_DISCO]: Object.fromEntries(sceltePersistenti) })).catch(() => {});
  } catch (_) {}
}

// Va letta prima che si apra una scheda: il controllo è sincrono e una pagina ripristinata chiede subito.
async function carica() {
  try {
    const v = ((await disco().get(CHIAVE_DISCO)) || {})[CHIAVE_DISCO];
    if (!v || typeof v !== 'object') return;
    for (const [k, si] of Object.entries(v)) if (typeof si === 'boolean' && k.includes('|')) sceltePersistenti.set(k, si);
  } catch (_) {}
}

function tastoDelMenu(input) {
  const type = input.type;
  if (type === 'mouseDown') return tastoPremuto(input) === 'right';
  return (type === 'rawKeyDown' || type === 'keyDown') && input.key === 'ContextMenu';
}

function segnaMenu(wc, frame) {
  let nodo = null; let origine = null;
  try { if (frame) { nodo = frame.frameTreeNodeId; origine = frame.origin; } } catch (_) {}
  wc._filoMenuAperto = { alle: Date.now(), nodo, origine };
}

// Come in Chromium un modificatore da solo o una combinazione che il browser si tiene non attivano la pagina (#737.1).
function tastoPerLaPagina(input) {
  const key = String((input && input.key) || '');
  if (!key) return true;
  if (TASTI_SENZA_GESTO.has(key)) return false;
  const T = globalThis.SN_TASTI;
  try { return !(T && T.tastiRiservati().some((a) => T.combacia(input, a))); } catch (_) { return true; }
}

// Il gesto conta per il documento su cui è stato fatto: il clic che porta altrove non vale per la pagina d'arrivo.
function seguiGesti(wc) {
  if (!wc || wc._filoGestiSeguiti) return;
  wc._filoGestiSeguiti = true;
  try {
    wc.on('input-event', (_e, input) => {
      const type = (input && input.type) || '';
      if (!GESTI.has(type) || !tastoPerLaPagina(input)) return;
      const mouse = !/key|char/i.test(type);
      if (mouse && clicDiFiloInCorso(wc)) return;
      const avvio = AVVII_DI_UN_GESTO.has(type);
      if (avvio) wc._filoGestoDiFilo = false;
      else if (wc._filoGestoDiFilo) return;
      wc._filoGestoAlle = Date.now();
      // Un sito che annulla il `contextmenu` spegne il `context-menu` qui sotto, non il tasto destro vero (#589.4 giro 2).
      if (tastoDelMenu(input)) segnaMenu(wc, wc.mainFrame);
    });
    // Un riquadro di un altro sito non passa da `input-event`: lì il tasto destro e i tasti premuti arrivano da qui.
    // Il menu tiene anche il riquadro dove l'utente l'ha aperto: un evento finto della pagina non arriva qui (#589.4).
    wc.on('context-menu', (_e, params) => {
      wc._filoGestoAlle = Date.now();
      segnaMenu(wc, params && params.frame);
    });
    // Un tasto che Filo tiene per sé (una scorciatoia) o premuto sull'avviso del sito non è arrivato alla pagina (#737.1):
    // chi lo ferma lo fa negli altri ascolti, quindi si guarda dopo che sono passati tutti.
    wc.on('before-input-event', (e, input) => {
      if (!input || input.type !== 'keyDown' || !tastoPerLaPagina(input) || (e && e.daAvvisoSito)) return;
      queueMicrotask(() => {
        if (!(e && e.defaultPrevented)) { wc._filoGestoDiFilo = false; wc._filoGestoAlle = Date.now(); }
      });
    });
    wc.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => {
      const principale = e && typeof e.isMainFrame === 'boolean' ? e.isMainFrame : isMainFrame;
      const stessa = e && typeof e.isSameDocument === 'boolean' ? e.isSameDocument : isInPlace;
      if (!principale || stessa) return;
      // Un invito non si carica mai (#664): la pagina resta, e il gesto che l'ha chiesto deve arrivare a chi lo porta dentro.
      if (globalThis.SN_WALLET?.isInviteDeepLink?.((e && e.url) || url)) return;
      // Il clic che fa partire la navigazione vale ancora per dove la portano will-navigate e i redirect (un «scrivici»
      // che finisce in mailto:): qui arriva prima di loro.
      const t = gestoSullaScheda(wc);
      wc._filoGestoNavigazione = t && t > (wc._filoGestoUsatoAlle || 0) ? t : 0;
      // Il clic che ha fatto partire la navigazione vale per i suoi rinvii, non per la pagina d'arrivo (#664 giro 2).
      wc._filoNavDaGesto = gestoRecente(wc);
      wc._filoGestoAlle = 0; wc._filoGestoFinestraAlle = 0; wc._filoMenuAperto = null;
    });
    wc.on('did-navigate', () => { wc._filoNavDaGesto = false; });
    wc.on('did-fail-load', (_e, _c, _d, _u, principale) => { if (principale !== false) wc._filoNavDaGesto = false; });
  } catch (_) {}
}

function gestoRecente(wc) {
  return gestoEntro(wc, GESTO_MS);
}

// Un clic o un tasto vero sulla pagina negli ultimi `ms`: il conto riparte a ogni navigazione della pagina intera.
function gestoEntro(wc, ms) {
  const t = wc && wc._filoGestoAlle;
  return Boolean(t && Date.now() - t < ms);
}

// Il gesto di chi chiede: un clic dentro il riquadro di un altro sito non passa da `input-event` e lo riferisce il
// preload di quel frame; vale per il riquadro toccato e i suoi antenati, come in Chromium (#586, il widget incorporato).
function gestoPer(wc, chiede) {
  if (gestoRecente(wc)) return true;
  const t = gestoSullaScheda(wc);
  if (!t || t <= (wc._filoGestoUsatoAlle || 0)) return false;
  const chi = origineWeb(chiede) || origineWeb(urlDi(wc));
  return Boolean(chi && wc._filoGestoOrigini && wc._filoGestoOrigini.has(chi));
}

// Il gesto per le finestre lo dice solo il preload del frame toccato, prima della pagina: il main vede
// l'input prima di sapere se è caduto sull'interfaccia di Filo, e una pagina che chiede di continuo passerebbe in
// mezzo (#737.1 giro 7). Un tasto che Filo si tiene non arriva al preload; uno riservato che ci arriva non conta.
function gestoDellaPagina(wc, frame, tasto) {
  try {
    const daTastiera = Boolean(tasto && typeof tasto === 'object');
    // Il clic di Filo arriva al preload come quello del mouse; un tasto premuto intanto è dell'utente.
    if (!wc || (!daTastiera && clicDiFiloInCorso(wc)) || (daTastiera && !tastoPerLaPagina(tasto))) return false;
    segnaGestoPerFinestra(wc, originiDelFrame(frame || wc.mainFrame, wc));
    return true;
  } catch (_) { return false; }
}

// Come in Chromium il gesto attiva il frame che l'ha ricevuto e i suoi antenati, non i riquadri di altri siti che
// contiene: il clic sull'articolo non vale per la pubblicità incorporata (#737.1 giro 3).
function originiDelFrame(frame, wc) {
  const out = [];
  const aggiungi = (o) => { if (o && o !== 'null' && !out.includes(o)) out.push(o); };
  for (let f = frame, n = 0; f && n < 64; f = f.parent, n++) {
    try { aggiungi(f.origin); } catch (_) {}
    try { aggiungi(new URL(f.url).origin); } catch (_) {}
  }
  if (wc && (!frame || !frame.parent)) { try { aggiungi(new URL(wc.getURL()).origin); } catch (_) {} }
  return out;
}

function segnaGestoPerFinestra(wc, origini = []) {
  const ora = Date.now();
  if (ora - (wc._filoGestoFinestraAlle || 0) < STESSO_GESTO_MS) {
    for (const o of origini) (wc._filoGestoOrigini ||= new Set()).add(o);
    return;
  }
  wc._filoGestoFinestraAlle = ora;
  wc._filoGestoOrigini = new Set(origini);
}

function clicDiFilo(wc) {
  if (wc) wc._filoClicDiFiloFino = Date.now() + CLIC_DI_FILO_MS;
}

function clicDiFiloInCorso(wc) {
  return Boolean(wc && wc._filoClicDiFiloFino && Date.now() < wc._filoClicDiFiloFino);
}

function gestoSullaScheda(wc) {
  const t = (wc && wc._filoGestoFinestraAlle) || 0;
  return t && Date.now() - t < GESTO_MS ? t : 0;
}

// Un gesto apre una finestra sola, come in Chrome: la seconda della stessa raffica nessuno l'ha chiesta (#737.1).
// Chi chiede si riconosce dal referrer: un frame di un sito che il gesto non ha toccato non lo usa. Chi lo nasconde
// resta riconoscibile solo come «la scheda», come prima.
function gestoPerUnaFinestra(wc, referrer) {
  const t = gestoSullaScheda(wc);
  if (!t || t <= (wc._filoGestoUsatoAlle || 0)) return false;
  const chi = origineDelReferrer(referrer);
  if (chi && wc._filoGestoOrigini && wc._filoGestoOrigini.size && !wc._filoGestoOrigini.has(chi)) return false;
  wc._filoGestoUsatoAlle = t;
  return true;
}

// Un clic o un tasto dato all'interfaccia di Filo disegnata sulla pagina (menu, risposte, assistente) è di Filo, non
// della pagina: come una scorciatoia, non le apre finestre né permessi. Lo riferisce il preload, prima della pagina.
function gestoDiFilo(wc) {
  if (!wc) return;
  wc._filoGestoUsatoAlle = Math.max(wc._filoGestoUsatoAlle || 0, wc._filoGestoFinestraAlle || 0);
  wc._filoGestoAlle = 0;
  wc._filoGestoDiFilo = true;
  // Vale invece per ciò che Filo fa da quel menu (gli appunti di Filo, services/appuntiDaiSiti.js).
  wc._filoGestoUiAlle = Date.now();
}

// Ciò che l'utente ha scelto di aprire (il collegamento che ha cliccato, la voce del menu di Filo) si apre anche se la
// pagina ha già speso il gesto per la sua pubblicità (#737.1 giro 6). Lo segna il preload su un input vero, prima
// che la pagina apra: vale per quell'indirizzo, una volta, subito.
function aperturaScelta(wc, url, azione = null) {
  const u = indirizzoPieno(url);
  if (!wc || !u) return;
  const ora = Date.now();
  wc._filoAperture = (wc._filoAperture || []).filter((x) => x.fino > ora && x.url !== u).slice(-7);
  // L'azione del menu che apre (#1461): solo un nome breve e un istante del minuto appena passato.
  const t0 = azione && Number(azione.t0);
  const a = azione && /^[a-z0-9][a-z0-9-]{0,59}$/.test(String(azione.id || '')) && Number.isFinite(t0) && t0 <= ora && ora - t0 < 60000
    ? { id: String(azione.id), t0 } : null;
  wc._filoAperture.push({ url: u, fino: ora + APERTURA_SCELTA_MS, azione: a });
}

// L'azione che l'apertura scelta porta con sé, una volta: chi apre la scheda la misura fino alla pagina caricata.
function azioneDellApertura(wc, url) {
  const u = indirizzoPieno(url);
  const ora = Date.now();
  const x = u && wc ? (wc._filoAperture || []).find((v) => v.url === u && v.fino > ora && v.azione) : null;
  if (!x) return null;
  const a = x.azione;
  x.azione = null;
  return a;
}

// La finestra che la pagina chiede passa se l'utente l'ha scelta o se arriva col gesto; la scelta spende anche il gesto,
// così la pagina non ne apre un'altra con lo stesso clic.
function perUnaFinestra(wc, url, referrer) {
  const u = indirizzoPieno(url);
  const ora = Date.now();
  const i = u && wc && wc._filoAperture ? wc._filoAperture.findIndex((x) => x.url === u && x.fino > ora) : -1;
  if (i < 0) return gestoPerUnaFinestra(wc, referrer);
  wc._filoAperture.splice(i, 1);
  const t = gestoSullaScheda(wc);
  if (t) wc._filoGestoUsatoAlle = Math.max(wc._filoGestoUsatoAlle || 0, t);
  return true;
}

// L'apertura che l'utente ha scelto dall'interfaccia di Filo sulla pagina (il tasto destro «Apri in nuova tab»), col suo
// clic vero: per il rilevatore dei siti pericolosi vale come il clic sul link (#814).
function sceltaDallUtente(wc, url) {
  const u = indirizzoPieno(url);
  const ora = Date.now();
  return Boolean(u && wc && (wc._filoAperture || []).some((x) => x.url === u && x.fino > ora) && gestoDellUtente(wc));
}

function indirizzoPieno(url) {
  try { return new URL(String(url || '')).href; } catch (_) { return ''; }
}

function gestoPerLaNavigazione(wc) {
  const t = (wc && wc._filoGestoNavigazione) || 0;
  if (!t || Date.now() - t >= GESTO_MS) return false;
  wc._filoGestoNavigazione = 0;
  return true;
}

function origineDelReferrer(referrer) {
  const u = referrer && typeof referrer === 'object' ? referrer.url : referrer;
  if (!u) return '';
  try { const o = new URL(String(u)).origin; return o && o !== 'null' ? o : ''; } catch (_) { return ''; }
}

// Un clic o un tasto vero sulla scheda, anche sull'interfaccia di Filo disegnata sopra la pagina: vale per ciò che Filo
// apre su richiesta dell'utente (il rilevatore dei siti pericolosi, #814), mai per i permessi della pagina.
function gestoDellUtente(wc) {
  const t = wc && Math.max(wc._filoGestoAlle || 0, wc._filoGestoUiAlle || 0);
  return Boolean(t && Date.now() - t < GESTO_MS);
}

// Il gesto vale anche per la navigazione che ha fatto partire, finché non arriva: un rinvio del sito resta del clic.
function navigazioneDaGesto(wc) {
  return Boolean(wc && wc._filoNavDaGesto);
}

// Il dominio registrato va sempre letto: con un indirizzo lungo la parte che sceglie chi attacca è quella davanti.
function nomeDaMostrare(origine) {
  let u;
  try { u = new URL(origine); } catch (_) { return { sotto: '', dominio: String(origine || '') }; }
  const host = u.hostname;
  const porta = u.port ? ':' + u.port : '';
  let registrabile = host;
  try {
    if (!Psl.isIpAddress(host)) registrabile = (Psl.getDomainInfo(host) || {}).registrable || host;
  } catch (_) {}
  const sotto = host.length > registrabile.length && host.endsWith('.' + registrabile)
    ? host.slice(0, host.length - registrabile.length - 1)
    : '';
  return { sotto, dominio: registrabile + porta };
}

function chiudi(id, si, { ricorda, utente = false, fonte } = {}) {
  const p = inAttesa.get(id);
  if (!p) return false;
  inAttesa.delete(id);
  if (utente && !si) segnaNegati(p.wc, p.origine, p.parti);
  // Lo schermo si sceglie ogni volta: né il sì né il no restano.
  if (p.tipo === 'schermo') ricorda = false;
  if (ricorda) {
    const scelte = sceltePer(p.ses);
    for (const parte of p.parti) scelte.set(`${p.origine}|${parte}`, Boolean(si));
    if (scelte === sceltePersistenti) salva();
  }
  for (const cb of p.callbacks) { try { cb(Boolean(si), fonte); } catch (_) {} }
  try { p.avvisa('fine', { id }); } catch (_) {}
  if (ricorda) {
    for (const [altro, q] of [...inAttesa]) {
      if (q.ses !== p.ses || q.origine !== p.origine || q.tipo === 'schermo') continue;
      const decise = q.parti.map((parte) => sceltePer(q.ses).get(`${q.origine}|${parte}`));
      if (decise.every((x) => x === true)) chiudi(altro, true, { ricorda: false });
      else if (decise.some((x) => x === false)) chiudi(altro, false, { ricorda: false, utente: true });
    }
  }
  return true;
}

// La pagina che aveva chiesto non c'è più: la domanda si ritira senza diventare una scelta.
function seguiPagina(wc) {
  if (!wc || wc._filoPermessiSeguita) return;
  wc._filoPermessiSeguita = true;
  const ritira = () => {
    for (const [id, p] of [...inAttesa]) if (p.wc === wc) chiudi(id, false, { ricorda: false });
  };
  try { wc.once('destroyed', ritira); } catch (_) {}
  try {
    wc.on('did-start-navigation', (e, _url, isInPlace, isMainFrame) => {
      const principale = e && typeof e.isMainFrame === 'boolean' ? e.isMainFrame : isMainFrame;
      const stessa = e && typeof e.isSameDocument === 'boolean' ? e.isSameDocument : isInPlace;
      if (principale && !stessa) ritira();
    });
  } catch (_) {}
}

// La domanda resta finché l'utente risponde o la pagina se ne va: una scadenza toglieva il sì a chi rispondeva con calma.
function chiedi({ ses, wc, origine, tipo, parti, oggetto, fonti, callback, schedaDi }) {
  const dove = schedaDi(wc);
  if (!dove || typeof dove.avvisa !== 'function') { callback(false); return; }
  for (const p of inAttesa.values()) {
    if (p.wc === wc && p.origine === origine && p.parti.join() === parti.join()) { p.callbacks.push(callback); return; }
  }
  const id = randomUUID();
  inAttesa.set(id, { ses, wc, origine, tipo, parti, callbacks: [callback], avvisa: dove.avvisa });
  seguiPagina(wc);
  const { sotto, dominio } = nomeDaMostrare(origine);
  let host = origine;
  try { host = new URL(origine).host; } catch (_) {}
  dove.avvisa('chiedi', { id, tabId: dove.tabId, host, sotto, dominio, tipo, parti, ...(oggetto ? { oggetto } : {}), ...(fonti ? { fonti } : {}) });
}

// `schedaDi(wc)` → { tabId, avvisa(evento, dati) } della finestra che mostra la pagina, o null.
// `esterno(url)` → true per gli indirizzi di altre applicazioni che una pagina può aprire (la stessa lista delle schede).
function installa(ses, { schedaDi, prima, esterno, aggiorna } = {}) {
  if (!ses || ses._filoPermessi) return;
  ses._filoPermessi = true;
  if (typeof aggiorna === 'function') aggiornaScheda = aggiorna;
  try {
    if (typeof ses.setDisplayMediaRequestHandler === 'function') {
      ses.setDisplayMediaRequestHandler((_req, cb) => gestoreSchermo(ses, cb));
    }
  } catch (_) {}
  try {
    ses.setPermissionRequestHandler(ses._filoRichiesta = (wc, permission, callback, details) => {
      if (typeof prima === 'function' && prima(wc, permission, callback, details)) return;
      const chi = origineDi(wc, details && details.requestingUrl);
      if (chi.filo) { callback(true); return; }
      if (SOLO_DALLA_PAGINA.has(permission) && riquadroDiAltri(wc, details)) { callback(false); return; }
      const origine = chi.origine;
      if (!origine) { callback(false); return; }
      if (permission === 'openExternal') {
        const url = details && details.externalURL;
        callback(Boolean(typeof esterno === 'function' && esterno(url) && gestoRecente(wc)));
        return;
      }
      const tipo = tipoDi(permission, details);
      if (!tipo) { callback(senzaTipoPassa(permission)); return; }
      // Una richiesta di media senza microfono né fotocamera è lo schermo.
      if (tipo === 'media' && !partiNote(details).length) {
        chiediLoSchermo({ ses, wc, origine, chiede: details && details.requestingUrl, callback, schedaDi: schedaDi || (() => null) });
        return;
      }
      const parti = partiDi(tipo, details);
      const decise = parti.map((parte) => sceltePer(ses).get(`${origine}|${parte}`));
      if (decise.every((x) => x === true)) { segnaUsati(wc, origine, parti); callback(true); return; }
      if (decise.some((x) => x === false)) { segnaNegati(wc, origine, parti.filter((_, i) => decise[i] === false)); callback(false); return; }
      if (SOLO_CONTROLLO.has(permission)) { callback(false); return; }
      if (DOPO_UN_GESTO.has(permission) && !gestoPer(wc, details && details.requestingUrl)) { callback(false); return; }
      const risposta = (si) => { if (si) segnaUsati(wc, origine, parti); callback(si); };
      chiedi({ ses, wc, origine, tipo, parti, oggetto: oggettoDi(tipo, details), callback: risposta, schedaDi: schedaDi || (() => null) });
    });
  } catch (_) {}
  try {
    // «Posso?» risponde sì finché l'utente non ha detto no: un «negato» qui farebbe credere al sito che non valga la pena
    // chiedere. Nella pagina quel sì senza risposta si legge «da chiedere» (`siDato`).
    ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      const d = details || {};
      // securityOrigin lo porta solo l'elenco dei dispositivi, ed è il frame che lo legge: requestingUrl lì è la pagina.
      const chi = origineDi(wc, d.securityOrigin || d.requestingUrl || requestingOrigin);
      if (chi.filo) return true;
      if (SOLO_DALLA_PAGINA.has(permission) && riquadroDiAltri(wc, details, requestingOrigin)) return false;
      const origine = chi.origine;
      if (!origine) return false;
      // Col sì qui Chromium mette nell'elenco dei dispositivi i nomi veri di microfoni, fotocamere e uscite audio, uguali in
      // ogni sito (#1524): come in Chrome solo dopo un sì vero a quella parte. permissions.query arriva senza securityOrigin.
      if (permission === 'media' && d.securityOrigin) {
        const noti = partiNote(d);
        return noti.length > 0 && noti.every((parte) => sceltePer(ses).get(`${origine}|${parte}`) === true);
      }
      const tipo = tipoDi(permission, details);
      if (!tipo) return senzaTipoPassa(permission);
      if (tipo === 'file') segnaFile(ses, origine, details);
      const parti = partiDi(tipo, details);
      const decise = parti.map((parte) => sceltePer(ses).get(`${origine}|${parte}`));
      if (CONTROLLO_SOLO_COL_SI.has(permission)) return decise.every((x) => x === true) || (tipo === 'file' && salvataggio(ses, origine, details));
      return !decise.some((x) => x === false);
    });
  } catch (_) {}
}

// ── Lo schermo (#586): ogni volta l'utente sceglie cosa mostrare, e la scelta non si ricorda ──
// Prima si sceglie, poi si dice sì: Chromium chiama il gestore dello schermo DENTRO il sì a getDisplayMedia, e lì
// consegna la scelta. La strada vecchia (getUserMedia con chromeMediaSource) arriva con gli stessi dati ma non passa
// dal gestore e prenderebbe schermo intero e audio senza scelta. Di solito la pagina la gira su getDisplayMedia e avvisa
// (preload/schermo-vecchio.js, anche nei riquadri vuoti: riquadri-vuoti.js): dopo la scelta riceve no. Chi lo aggira si
// ferma prima di riceverli.
const ANTEPRIMA_SCHERMO = { width: 240, height: 135 };

// Il frame avvisa che la sua prossima domanda dello schermo viene dalla strada vecchia: dopo la scelta la risposta è no.
// L'avviso vale per l'origine che lo manda: un riquadro di un altro sito non fa negare la domanda della pagina (#586).
function schermoVecchio(wc, frame) {
  if (!wc) return;
  let chi = null;
  try { chi = frame && (origineWeb(frame.url) || origineWeb(frame.origin)); } catch (_) {}
  chi = chi || origineWeb(urlDi(wc));
  if (!chi) return;
  const ora = Date.now();
  wc._filoSchermoVecchio = (wc._filoSchermoVecchio || []).filter((v) => ora - v.alle < GESTO_MS && v.origine !== chi).slice(-15);
  wc._filoSchermoVecchio.push({ origine: chi, alle: ora });
}

function avvisoVecchio(wc, chiede, origine) {
  const chi = origineWeb(chiede) || origine;
  const ora = Date.now();
  const tutti = (wc && wc._filoSchermoVecchio) || [];
  const mio = tutti.find((v) => v.origine === chi && ora - v.alle < GESTO_MS);
  if (wc) wc._filoSchermoVecchio = tutti.filter((v) => v !== mio && ora - v.alle < GESTO_MS);
  return Boolean(mio);
}

function chiediLoSchermo({ ses, wc, origine, chiede, callback, schedaDi }) {
  const vecchia = avvisoVecchio(wc, chiede, origine);
  if (!gestoPer(wc, chiede) || [...inAttesa.values()].some((p) => p.wc === wc && p.tipo === 'schermo')) { callback(false); return; }
  Promise.resolve(fontiDelloSchermo(ses)).then((fonti) => {
    if (!fonti.length || !wc || wc.isDestroyed()) { callback(false); return; }
    const pubbliche = fonti.map(({ id, tipo, nome, anteprima, scheda }) => ({ id, tipo, nome, anteprima, ...(scheda === wc ? { questa: true } : {}) }));
    chiedi({
      ses, wc, origine, tipo: 'schermo', parti: ['schermo'], fonti: pubbliche, schedaDi,
      callback: (si, id) => {
        const f = si && !vecchia ? fonti.find((x) => x.id === id) : null;
        const video = !f ? null : f.scheda ? (f.scheda.isDestroyed() ? null : f.scheda.mainFrame) : f.sorgente;
        if (!video) { callback(false); return; }
        const atteso = { video, preso: false };
        ses._filoSchermoAtteso = atteso;
        try { callback(true); } finally { ses._filoSchermoAtteso = null; }
        if (!atteso.preso) { fermaLaStradaVecchia(wc); return; }
        segnaUsati(wc, origine, ['schermo']);
      },
    });
  }, () => callback(false));
}

function fermaLaStradaVecchia(wc) {
  try { if (wc && !wc.isDestroyed()) wc.forcefullyCrashRenderer(); } catch (_) {}
}

function gestoreSchermo(ses, cb) {
  const atteso = ses._filoSchermoAtteso;
  ses._filoSchermoAtteso = null;
  try {
    if (!atteso) { cb({}); return; }
    atteso.preso = true;
    cb({ video: atteso.video });
  } catch (_) {}
}

// Schermi, schede di Filo della stessa sessione (l'incognito non si mostra fuori) e finestre delle altre applicazioni.
let fontiDelloSchermo = async (ses) => {
  const { desktopCapturer, BrowserWindow } = require('electron');
  // Schermi e finestre si chiedono a parte: su Linux, a richiesta in corso, la lista insieme tornava vuota.
  const elenco = (tipo) => Promise.resolve(desktopCapturer.getSources({ types: [tipo], thumbnailSize: ANTEPRIMA_SCHERMO })).catch(() => []);
  const lista = (await Promise.all([elenco('screen'), elenco('window')])).flat();
  const anteprima = (img) => { try { return img && !img.isEmpty() ? img.toDataURL() : ''; } catch (_) { return ''; } };
  const out = [];
  const schermi = lista.filter((f) => String(f.id).startsWith('screen:'));
  schermi.forEach((f, i) => out.push({
    id: f.id, tipo: 'schermo', nome: schermi.length > 1 ? `Schermo ${i + 1}` : 'Schermo intero', anteprima: anteprima(f.thumbnail), sorgente: f,
  }));
  const proprie = new Set();
  for (const w of BrowserWindow.getAllWindows()) {
    try { proprie.add(w.getMediaSourceId()); } catch (_) {}
    const tm = w._filoTabs;
    if (!tm || !Array.isArray(tm.tabs)) continue;
    for (const t of tm.tabs) {
      const c = t && t.view && t.view.webContents;
      if (!c || c.isDestroyed() || c.session !== ses || !origineWeb(urlDi(c))) continue;
      let nome = String(t.title || '').trim();
      if (!nome) { try { nome = new URL(urlDi(c)).host; } catch (_) { nome = 'Scheda'; } }
      out.push({ id: `scheda:${t.id}`, tipo: 'scheda', nome, anteprima: '', scheda: c });
    }
  }
  for (const f of lista) {
    if (!String(f.id).startsWith('window:') || proprie.has(f.id) || !String(f.name || '').trim()) continue;
    out.push({ id: f.id, tipo: 'finestra', nome: String(f.name), anteprima: anteprima(f.thumbnail), sorgente: f });
  }
  return out;
};

// ── Il segno sulla scheda (#586): cosa il sito della pagina ha avuto o si è visto negare, finché resta quella pagina ──
// Lo stato vero di una traccia vive nella pagina: qui si sa cosa le è stato consegnato. Una pagina nuova riparte da zero.
const IN_USO = new Set(['audio', 'video', 'posizione', 'schermo']);
let aggiornaScheda = () => {};

function segniPer(wc, origine) {
  if (!wc || wc.isDestroyed()) return null;
  if (!wc._filoSegni || wc._filoSegni.origine !== origine) {
    wc._filoSegni = { origine, usati: new Set(), negati: new Set() };
    if (!wc._filoSegniSeguiti) {
      wc._filoSegniSeguiti = true;
      try {
        wc.on('did-start-navigation', (e, _url, isInPlace, isMainFrame) => {
          const principale = e && typeof e.isMainFrame === 'boolean' ? e.isMainFrame : isMainFrame;
          const stessa = e && typeof e.isSameDocument === 'boolean' ? e.isSameDocument : isInPlace;
          if (!principale || stessa || !wc._filoSegni) return;
          wc._filoSegni = null;
          try { aggiornaScheda(wc); } catch (_) {}
        });
      } catch (_) {}
    }
  }
  return wc._filoSegni;
}

function segnaUsati(wc, origine, parti) {
  const s = origine && origineWeb(urlDi(wc)) === origine ? segniPer(wc, origine) : null;
  if (!s) return;
  let cambiato = false;
  for (const p of parti) {
    if (s.negati.delete(p)) cambiato = true;
    if (IN_USO.has(p) && !s.usati.has(p)) { s.usati.add(p); cambiato = true; }
  }
  if (cambiato) { try { aggiornaScheda(wc); } catch (_) {} }
}

function segnaNegati(wc, origine, parti) {
  const s = origine && origineWeb(urlDi(wc)) === origine ? segniPer(wc, origine) : null;
  if (!s) return;
  let cambiato = false;
  for (const p of parti) if (!s.negati.has(p) && !s.usati.has(p)) { s.negati.add(p); cambiato = true; }
  if (cambiato) { try { aggiornaScheda(wc); } catch (_) {} }
}

// Per la riga della scheda: null quando non c'è niente da dire.
function segniDi(wc) {
  try {
    const s = wc && !wc.isDestroyed() && wc._filoSegni;
    if (!s || s.origine !== origineWeb(urlDi(wc)) || (!s.usati.size && !s.negati.size)) return null;
    return { usati: [...s.usati], negati: [...s.negati] };
  } catch (_) { return null; }
}

// Per la finestra nascosta del controllo profondo: nessuno può rispondere, quindi no a tutto.
function negaTutto(ses) {
  if (!ses || ses._filoPermessiNegati) return;
  try {
    if (typeof ses.setPermissionRequestHandler === 'function') ses.setPermissionRequestHandler((_wc, _p, callback) => callback(false));
    if (typeof ses.setPermissionCheckHandler === 'function') ses.setPermissionCheckHandler(() => false);
    if (typeof ses.setDisplayMediaRequestHandler === 'function') ses.setDisplayMediaRequestHandler((_req, cb) => cb({}));
    ses._filoPermessiNegati = true;
  } catch (_) {}
}

// La pagina che vuole scrivere su ciò che ha già lo chiede da qui (preload/stato-permessi.js): Chromium non chiama più il
// gestore delle richieste. Vale dopo un gesto vero e per il file su cui il controllo ha appena detto no; null = non chiesto.
function chiediScrittura(wc) {
  return new Promise((ok) => {
    const ses = wc && wc.session;
    const origine = origineWeb(urlDi(wc));
    const ultimo = origine && ses && ses._filoUltimoFile && ses._filoUltimoFile.get(origine);
    if (!ultimo || Date.now() - ultimo.alle > GESTO_MS || typeof ses._filoRichiesta !== 'function' || !gestoRecente(wc)) { ok(null); return; }
    ses._filoRichiesta(wc, 'fileSystem', (si) => ok(Boolean(si)), {
      fileAccessType: 'writable', filePath: ultimo.percorso, isDirectory: ultimo.cartella, requestingUrl: urlDi(wc),
    });
  });
}

function rispondi(id, si, fonte) {
  return chiudi(id, si, { ricorda: true, utente: true, fonte: typeof fonte === 'string' ? fonte : undefined });
}

// Quello che l'utente ha deciso per il sito di una pagina: si vede e si toglie dal menu della scheda.
function scelteDi(wc) {
  const origine = origineWeb(urlDi(wc));
  const ses = wc && wc.session;
  if (!origine || !ses) return { origine, scelte: [] };
  const scelte = [];
  for (const [chiave, si] of sceltePer(ses)) {
    const i = chiave.lastIndexOf('|');
    if (chiave.slice(0, i) === origine) scelte.push({ parte: chiave.slice(i + 1), si });
  }
  return { origine, scelte };
}

// La pagina già aperta tiene quello che ha ottenuto, e un no alle notifiche lo legge finché non si ricarica.
function dimentica(wc) {
  const { origine, scelte } = scelteDi(wc);
  if (!scelte.length) return { tolte: 0, ricarica: false };
  const mappa = sceltePer(wc.session);
  for (const s of scelte) mappa.delete(`${origine}|${s.parte}`);
  if (mappa === sceltePersistenti) salva();
  if (wc._filoSegni && wc._filoSegni.negati.size) { wc._filoSegni.negati.clear(); try { aggiornaScheda(wc); } catch (_) {} }
  return { tolte: scelte.length, ricarica: scelte.some((s) => s.si || s.parte === 'notifiche') };
}

// Un sito usa-e-getta della Privacy buttato all'uscita (services/cookies.js): le risposte date lì se ne vanno col jar.
function dimenticaSessione(ses) {
  if (ses && !persistente(ses)) delete ses._filoScelte;
}

// Tutte le risposte che restano, per la pagina Sicurezza: si vedono e si tolgono anche senza aprire il sito.
function scelteRicordate() {
  const out = [];
  for (const [chiave, si] of sceltePersistenti) {
    const i = chiave.lastIndexOf('|');
    const origine = chiave.slice(0, i);
    out.push({ origine, parte: chiave.slice(i + 1), si, ...nomeDaMostrare(origine) });
  }
  return out.sort((a, b) => a.dominio.localeCompare(b.dominio) || a.origine.localeCompare(b.origine) || a.parte.localeCompare(b.parte));
}

function togliScelta(origine, parte) {
  const ok = sceltePersistenti.delete(`${origine}|${parte}`);
  if (ok) salva();
  return ok;
}

// ── Le stesse risposte per la chat (#949): lette come nella pagina Sicurezza, tolte per sito e per permesso ──
const PAROLE_PARTE = {
  microfono: 'audio', mic: 'audio', audio: 'audio', fotocamera: 'video', videocamera: 'video', webcam: 'video',
  camera: 'video', video: 'video', appunti: 'appunti', posizione: 'posizione', geolocalizzazione: 'posizione',
  localizzazione: 'posizione', notifiche: 'notifiche', notifica: 'notifiche', schermi: 'schermi', schermo: 'schermi',
  presenza: 'presenza', 'presenza al computer': 'presenza', strumenti: 'strumenti', 'strumenti musicali': 'strumenti', midi: 'strumenti',
  rete: 'rete', 'rete locale': 'rete', 'rete di casa': 'rete', lan: 'rete',
  file: 'file', cartella: 'file', cartelle: 'file', 'modifica dei file': 'file', 'modificare i file': 'file', scrittura: 'file',
};
function nomeParte(parte) {
  const S = (globalThis.SN_I18N && globalThis.SN_I18N.STRINGS) || {};
  const t = S[`options_site_perms_part_${parte}`];
  return t ? t.toLowerCase() : parte;
}
function rigaScelta(s) {
  return `${s.sotto ? `${s.sotto}.` : ''}${s.dominio} · ${nomeParte(s.parte)}: ${s.si ? 'consentito' : 'negato'}`;
}
function righeRicordate() {
  return scelteRicordate().map(rigaScelta);
}
// Un sito scritto come capita (con «www.», con l'indirizzo intero, accentato) → il nome con cui si confronta.
function hostDaTesto(raw) {
  let t = String(raw || '').trim().toLowerCase().replace(/^["'«(]+|["'»),.;]+$/g, '');
  if (!t) return '';
  try { t = new URL(t.includes('://') ? t : `http://${t}`).hostname; } catch (_) { return ''; }
  return t.replace(/^www\./, '');
}
// Toglie le risposte ricordate di un sito (anche dei suoi sottodomini); `permesso` vuoto o «tutti» le toglie tutte.
// Toglierle non concede niente: alla prossima richiesta il sito torna a chiedere.
function togliPerChat(sito, permesso) {
  const host = hostDaTesto(sito);
  if (!host) return { errore: `«${String(sito || '').slice(0, 60)}» non è un sito: scrivilo come meet.google.com` };
  const p = String(permesso || '').trim().toLowerCase();
  const tutti = !p || /^(tutt[oiea]|ogni|qualsiasi|all)$/.test(p);
  const parte = tutti ? '' : (PAROLE_PARTE[p] || (TIPI[p] ? TIPI[p] : ''));
  if (!tutti && !parte) return { errore: `«${p.slice(0, 40)}» non è un permesso che un sito chiede (microfono, fotocamera, appunti, posizione, notifiche, schermi, presenza, strumenti, rete, file)` };
  const delSito = scelteRicordate().filter((s) => {
    let h = '';
    try { h = new URL(s.origine).hostname.replace(/^www\./, ''); } catch (_) { return false; }
    return h === host || h.endsWith(`.${host}`);
  });
  const prese = delSito.filter((s) => tutti || s.parte === parte);
  for (const s of prese) togliScelta(s.origine, s.parte);
  return { tolte: prese.map(rigaScelta), restano: righeRicordate(), host, ricarica: prese.some((s) => s.si || s.parte === 'notifiche') };
}

// Quello che una pagina deve leggere delle notifiche prima di chiedere, come in Chrome: il controllo di Electron sa dire
// solo sì o no, e il sì mostrerebbe le notifiche senza domanda. La traduzione nella pagina: preload/stato-permessi.js.
function statoNotifiche(ses, url) {
  const origine = origineWeb(url);
  const scelta = origine && ses ? sceltePer(ses).get(`${origine}|notifiche`) : undefined;
  return scelta === true ? 'granted' : scelta === false ? 'denied' : 'default';
}

// Il controllo di Chromium dice concessi fotocamera, microfono, posizione e strumenti musicali anche a chi nessuno ha
// risposto: la pagina li legge «da chiedere» finché qui non c'è un sì (preload/stato-permessi.js, #1057).
const PARTI_CON_SI = new Set(['audio', 'video', 'posizione', 'strumenti']);
function siDato(ses, url, parte) {
  const origine = origineWeb(url);
  return Boolean(origine && ses && PARTI_CON_SI.has(parte) && sceltePer(ses).get(`${origine}|${parte}`) === true);
}

module.exports = {
  installa, negaTutto, rispondi, seguiGesti, segniDi, gestoRecente, gestoEntro, gestoDellUtente, navigazioneDaGesto, scelteDi, dimentica, dimenticaSessione, nomeDaMostrare, statoNotifiche, siDato,
  carica, scelteRicordate, togliScelta, righeRicordate, togliPerChat, classifica, gestoDellaPagina, gestoSullaScheda, schermoVecchio, gestoPerUnaFinestra, gestoPerLaNavigazione, clicDiFilo,
  gestoDiFilo, aperturaScelta, azioneDellApertura, perUnaFinestra, sceltaDallUtente, chiediScrittura,
  TIPI, SECONDO_L_ACCESSO, INNOCUI, NON_DISPONIBILI, GESTO_MS, TASTI_SENZA_GESTO, tastoPerLaPagina, _inAttesa: inAttesa,
  _usaDisco: (d) => { disco = () => d; },
  _usaFontiSchermo: (f) => { fontiDelloSchermo = f; },
};
