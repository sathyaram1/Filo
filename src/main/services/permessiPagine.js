// Permessi delle pagine web (#591.1): quello che Chrome chiede lo decide l'utente nella cornice, quello che Chrome concede
// di fabbrica passa. Filo stesso (filo://, la cornice) resta com'era; Detta e Incolla hanno un lasciapassare breve.
// Senza gestore Electron concede tutto: ogni sessione che mostra pagine web passa da `installa` o da `negaTutto`.

'use strict';

const { randomUUID } = require('node:crypto');
const Psl = require('./safebrowse/psl');

// Ciò che Chrome chiede all'utente: si chiede anche qui. Ogni nome che Electron può mandare sta in uno dei gruppi sotto,
// e la sentinella in tests/unit/permessiPagine.test.mjs lo confronta con quelli che Electron dichiara.
const TIPI = {
  media: 'media',
  'clipboard-read': 'appunti',
  'deprecated-sync-clipboard-read': 'appunti',
  geolocation: 'posizione',
  notifications: 'notifiche',
  'window-management': 'schermi',
  'idle-detection': 'presenza',
  midiSysex: 'strumenti',
};
// Ciò che Chrome concede di fabbrica passa senza domanda.
const INNOCUI = new Set([
  'fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock', 'mediaKeySystem',
  'speaker-selection', 'storage-access', 'top-level-storage-access', 'fileSystem', 'midi',
  'screen-wake-lock', 'background-sync', 'background-fetch', 'sensors', 'payment-handler', 'persistent-storage',
]);
// Ciò che Filo non sa dare è no, senza domanda: condividere lo schermo e i dispositivi collegati vogliono una scelta
// (quale finestra, quale dispositivo) che Filo non ha.
const NON_DISPONIBILI = new Set(['display-capture', 'unknown', 'hid', 'serial', 'usb']);
// Il controllo dice sì solo dopo un sì vero: la lettura sincrona degli appunti non sa chiedere, le notifiche Electron le
// mostra a chi il controllo dà per concesse, e chi sa che sei al computer lo saprebbe senza domanda.
const CONTROLLO_SOLO_COL_SI = new Set(['deprecated-sync-clipboard-read', 'notifications', 'idle-detection']);
const SOLO_CONTROLLO = new Set(['deprecated-sync-clipboard-read']);
// Notifiche: si chiedono solo subito dopo un gesto dell'utente sulla pagina.
const DOPO_UN_GESTO = new Set(['notifications']);
// I font del computer Electron non li fa chiedere (arriva solo il controllo): passano subito dopo un gesto sulla pagina,
// che è anche quello che la pagina deve avere per leggerli.
const COL_GESTO_SENZA_DOMANDA = new Set(['local-fonts']);
const GESTO_MS = 5000;
const GESTI = new Set(['mouseDown', 'mouseUp', 'rawKeyDown', 'keyDown', 'char', 'touchStart', 'touchEnd', 'gestureTap']);
const LASCIAPASSARE_MS = 5000;
// Il lasciapassare di Detta copre il microfono e basta: con la fotocamera la pagina avrebbe un sì mai dato (#591, giro 18).
const PARTI_LASCIAPASSARE = { media: new Set(['audio']), appunti: new Set(['appunti']) };
// Solo le pagine di Filo sono Filo: ogni altro documento è una pagina web, anche un blob, un data: o un about:.
const DI_FILO = new Set(['filo:', 'devtools:']);
// Le risposte date nelle sessioni che restano su disco restano anche loro, come in Chrome; incognito e siti usa-e-getta no.
const CHIAVE_DISCO = 'sitePermissions';
const sceltePersistenti = new Map();
let disco = () => require('../shim/storage');

const lasciapassari = new Map();
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
  if (!c.filo || !cima) return c;
  const r = classifica(altro);
  return r.origine ? r : c;
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

function lasciapassareValido(wc, tipo, parti) {
  const p = wc && lasciapassari.get(wc.id);
  if (p && p.fino <= Date.now()) { lasciapassari.delete(wc.id); return false; }
  if (!p || p.tipo !== tipo) return false;
  const coperte = PARTI_LASCIAPASSARE[tipo];
  return Boolean(coperte && parti.every((x) => coperte.has(x)));
}

function lasciapassare(wc, tipo) {
  if (!wc || !PARTI_LASCIAPASSARE[tipo]) return false;
  lasciapassari.set(wc.id, { tipo, fino: Date.now() + LASCIAPASSARE_MS });
  return true;
}

function tastoDelMenu(input) {
  const type = input.type;
  // Electron non dà il pulsante: il tasto destro premuto sta fra i modificatori.
  if (type === 'mouseDown') return Array.isArray(input.modifiers) && input.modifiers.includes('rightbuttondown');
  return (type === 'rawKeyDown' || type === 'keyDown') && input.key === 'ContextMenu';
}

function segnaMenu(wc, frame) {
  let nodo = null; let origine = null;
  try { if (frame) { nodo = frame.frameTreeNodeId; origine = frame.origin; } } catch (_) {}
  wc._filoMenuAperto = { alle: Date.now(), nodo, origine };
}

// Il gesto conta per il documento su cui è stato fatto: il clic che porta altrove non vale per la pagina d'arrivo.
function seguiGesti(wc) {
  if (!wc || wc._filoGestiSeguiti) return;
  wc._filoGestiSeguiti = true;
  try {
    wc.on('input-event', (_e, input) => {
      const type = (input && input.type) || '';
      if (!GESTI.has(type) || String(input.key || '') === 'Escape') return;
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
    wc.on('before-input-event', (_e, input) => {
      if (input && input.type === 'keyDown' && String(input.key || '') !== 'Escape') wc._filoGestoAlle = Date.now();
    });
    wc.on('did-start-navigation', (e, _url, isInPlace, isMainFrame) => {
      const principale = e && typeof e.isMainFrame === 'boolean' ? e.isMainFrame : isMainFrame;
      const stessa = e && typeof e.isSameDocument === 'boolean' ? e.isSameDocument : isInPlace;
      if (principale && !stessa) { wc._filoGestoAlle = 0; wc._filoMenuAperto = null; }
    });
  } catch (_) {}
}

function gestoRecente(wc) {
  const t = wc && wc._filoGestoAlle;
  return Boolean(t && Date.now() - t < GESTO_MS);
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

function chiudi(id, si, { ricorda }) {
  const p = inAttesa.get(id);
  if (!p) return false;
  inAttesa.delete(id);
  if (ricorda) {
    const scelte = sceltePer(p.ses);
    for (const parte of p.parti) scelte.set(`${p.origine}|${parte}`, Boolean(si));
    if (scelte === sceltePersistenti) salva();
  }
  for (const cb of p.callbacks) { try { cb(Boolean(si)); } catch (_) {} }
  try { p.avvisa('fine', { id }); } catch (_) {}
  if (ricorda) {
    for (const [altro, q] of [...inAttesa]) {
      if (q.ses !== p.ses || q.origine !== p.origine) continue;
      const decise = q.parti.map((parte) => sceltePer(q.ses).get(`${q.origine}|${parte}`));
      if (decise.every((x) => x === true)) chiudi(altro, true, { ricorda: false });
      else if (decise.some((x) => x === false)) chiudi(altro, false, { ricorda: false });
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
function chiedi({ ses, wc, origine, tipo, parti, callback, schedaDi }) {
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
  dove.avvisa('chiedi', { id, tabId: dove.tabId, host, sotto, dominio, tipo, parti });
}

// `schedaDi(wc)` → { tabId, avvisa(evento, dati) } della finestra che mostra la pagina, o null.
// `esterno(url)` → true per gli indirizzi di altre applicazioni che una pagina può aprire (la stessa lista delle schede).
function installa(ses, { schedaDi, prima, esterno } = {}) {
  if (!ses || ses._filoPermessi) return;
  ses._filoPermessi = true;
  try {
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (typeof prima === 'function' && prima(wc, permission, callback, details)) return;
      const chi = origineDi(wc, details && details.requestingUrl);
      if (chi.filo) { callback(true); return; }
      const origine = chi.origine;
      if (!origine) { callback(false); return; }
      if (permission === 'openExternal') {
        const url = details && details.externalURL;
        callback(Boolean(typeof esterno === 'function' && esterno(url) && gestoRecente(wc)));
        return;
      }
      const tipo = TIPI[permission];
      if (!tipo) { callback(INNOCUI.has(permission)); return; }
      // Una richiesta di media senza microfono né fotocamera è la condivisione dello schermo, che Filo non sa dare.
      if (tipo === 'media' && !partiNote(details).length) { callback(false); return; }
      const parti = partiDi(tipo, details);
      if (lasciapassareValido(wc, tipo, parti)) { callback(true); return; }
      const decise = parti.map((parte) => sceltePer(ses).get(`${origine}|${parte}`));
      if (decise.every((x) => x === true)) { callback(true); return; }
      if (decise.some((x) => x === false) || SOLO_CONTROLLO.has(permission)) { callback(false); return; }
      if (DOPO_UN_GESTO.has(permission) && !gestoRecente(wc)) { callback(false); return; }
      chiedi({ ses, wc, origine, tipo, parti, callback, schedaDi: schedaDi || (() => null) });
    });
  } catch (_) {}
  try {
    // «Posso?» risponde sì finché l'utente non ha detto no: un «negato» qui farebbe credere al sito che non valga la pena chiedere.
    ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      const chi = origineDi(wc, (details && details.requestingUrl) || requestingOrigin);
      if (chi.filo) return true;
      const origine = chi.origine;
      if (!origine) return false;
      if (COL_GESTO_SENZA_DOMANDA.has(permission)) return gestoRecente(wc);
      const tipo = TIPI[permission];
      if (!tipo) return INNOCUI.has(permission);
      const parti = partiDi(tipo, details);
      if (lasciapassareValido(wc, tipo, parti)) return true;
      const decise = parti.map((parte) => sceltePer(ses).get(`${origine}|${parte}`));
      if (CONTROLLO_SOLO_COL_SI.has(permission)) return decise.every((x) => x === true);
      return !decise.some((x) => x === false);
    });
  } catch (_) {}
}

// Per la finestra nascosta del controllo profondo: nessuno può rispondere, quindi no a tutto.
function negaTutto(ses) {
  if (!ses || ses._filoPermessiNegati) return;
  try {
    if (typeof ses.setPermissionRequestHandler === 'function') ses.setPermissionRequestHandler((_wc, _p, callback) => callback(false));
    if (typeof ses.setPermissionCheckHandler === 'function') ses.setPermissionCheckHandler(() => false);
    ses._filoPermessiNegati = true;
  } catch (_) {}
}

function rispondi(id, si) {
  return chiudi(id, si, { ricorda: true });
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
  return { tolte: scelte.length, ricarica: scelte.some((s) => s.si || s.parte === 'notifiche') };
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

// Quello che una pagina deve leggere delle notifiche prima di chiedere, come in Chrome: il controllo di Electron sa dire
// solo sì o no, e il sì mostrerebbe le notifiche senza domanda. La traduzione nella pagina: preload/stato-permessi.js.
function statoNotifiche(ses, url) {
  const origine = origineWeb(url);
  const scelta = origine && ses ? sceltePer(ses).get(`${origine}|notifiche`) : undefined;
  return scelta === true ? 'granted' : scelta === false ? 'denied' : 'default';
}

module.exports = {
  installa, negaTutto, rispondi, lasciapassare, seguiGesti, scelteDi, dimentica, nomeDaMostrare, statoNotifiche,
  carica, scelteRicordate, togliScelta, classifica,
  TIPI, INNOCUI, NON_DISPONIBILI, COL_GESTO_SENZA_DOMANDA, GESTO_MS, _inAttesa: inAttesa,
  _usaDisco: (d) => { disco = () => d; },
};
