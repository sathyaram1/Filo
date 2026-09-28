// Permessi delle pagine web (#591.1): microfono, fotocamera, appunti, posizione e notifiche li decide l'utente nella cornice,
// il resto passa solo se innocuo. Filo stesso (filo://, la shell) resta com'era; Detta e Incolla hanno un lasciapassare breve.
// Senza gestore Electron concede tutto: ogni sessione che mostra pagine web passa da `installa` o da `negaTutto`.

'use strict';

const { randomUUID } = require('node:crypto');
const Psl = require('./safebrowse/psl');

const TIPI = {
  media: 'media',
  'clipboard-read': 'appunti',
  'deprecated-sync-clipboard-read': 'appunti',
  geolocation: 'posizione',
  notifications: 'notifiche',
};
// Fuori da TIPI passa senza domanda quello che Chrome concede di fabbrica; il resto, che Chrome chiederebbe e Filo non sa
// ancora chiedere, è no (le altre applicazioni hanno la loro regola). Sentinella: tests/unit/permessiPagine.test.mjs.
const INNOCUI = new Set([
  'fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock', 'mediaKeySystem',
  'speaker-selection', 'storage-access', 'top-level-storage-access', 'fileSystem', 'midi',
  'screen-wake-lock', 'background-sync', 'background-fetch', 'sensors', 'payment-handler',
]);
// La lettura sincrona degli appunti non sa chiedere: passa solo con un sì già dato.
const SOLO_CONTROLLO = new Set(['deprecated-sync-clipboard-read']);
// Notifiche: si chiedono solo subito dopo un gesto dell'utente sulla pagina, e il controllo dice il vero, perché
// Electron mostra una notifica a chi il controllo dà per concessa.
const DOPO_UN_GESTO = new Set(['notifications']);
const GESTO_MS = 5000;
const GESTI = new Set(['mouseDown', 'mouseUp', 'rawKeyDown', 'keyDown', 'char', 'touchStart', 'touchEnd', 'gestureTap']);
const LASCIAPASSARE_MS = 5000;
// Il lasciapassare di Detta copre il microfono e basta: con la fotocamera la pagina avrebbe un sì mai dato (#591, giro 18).
const PARTI_LASCIAPASSARE = { media: new Set(['audio']), appunti: new Set(['appunti']) };

const lasciapassari = new Map();
const inAttesa = new Map();

function origineWeb(url) {
  try {
    const u = new URL(String(url || ''));
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch (_) { return null; }
}

function urlDi(wc) {
  try { return wc && !wc.isDestroyed() ? wc.getURL() : ''; } catch (_) { return ''; }
}

// Chi chiede è la pagina in cima; un riquadro web dentro una pagina di Filo risponde per sé.
function origineDi(wc, altro) {
  return origineWeb(urlDi(wc)) || origineWeb(altro);
}

function partiDi(tipo, details) {
  if (tipo !== 'media') return [tipo];
  const d = details || {};
  const tipi = Array.isArray(d.mediaTypes) ? d.mediaTypes : (d.mediaType ? [d.mediaType] : []);
  const noti = tipi.filter((t) => t === 'audio' || t === 'video');
  return noti.length ? [...new Set(noti)] : ['audio', 'video'];
}

function sceltePer(ses) {
  if (!ses._filoScelte) ses._filoScelte = new Map();
  return ses._filoScelte;
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

// Il gesto conta per il documento su cui è stato fatto: il clic che porta altrove non vale per la pagina d'arrivo.
function seguiGesti(wc) {
  if (!wc || wc._filoGestiSeguiti) return;
  wc._filoGestiSeguiti = true;
  try {
    wc.on('input-event', (_e, input) => {
      const type = (input && input.type) || '';
      if (!GESTI.has(type) || String(input.key || '') === 'Escape') return;
      wc._filoGestoAlle = Date.now();
    });
    wc.on('did-start-navigation', (e, _url, isInPlace, isMainFrame) => {
      const principale = e && typeof e.isMainFrame === 'boolean' ? e.isMainFrame : isMainFrame;
      const stessa = e && typeof e.isSameDocument === 'boolean' ? e.isSameDocument : isInPlace;
      if (principale && !stessa) wc._filoGestoAlle = 0;
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
      const origine = origineDi(wc, details && details.requestingUrl);
      if (!origine) { callback(true); return; }
      if (permission === 'openExternal') {
        const url = details && details.externalURL;
        callback(Boolean(typeof esterno === 'function' && esterno(url) && gestoRecente(wc)));
        return;
      }
      const tipo = TIPI[permission];
      if (!tipo) { callback(INNOCUI.has(permission)); return; }
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
      const origine = origineDi(wc, (details && details.requestingUrl) || requestingOrigin);
      if (!origine) return true;
      const tipo = TIPI[permission];
      if (!tipo) return INNOCUI.has(permission);
      const parti = partiDi(tipo, details);
      if (lasciapassareValido(wc, tipo, parti)) return true;
      const decise = parti.map((parte) => sceltePer(ses).get(`${origine}|${parte}`));
      if (SOLO_CONTROLLO.has(permission) || DOPO_UN_GESTO.has(permission)) return decise.every((x) => x === true);
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
  if (!origine || !ses || !ses._filoScelte) return { origine, scelte: [] };
  const scelte = [];
  for (const [chiave, si] of ses._filoScelte) {
    const i = chiave.lastIndexOf('|');
    if (chiave.slice(0, i) === origine) scelte.push({ parte: chiave.slice(i + 1), si });
  }
  return { origine, scelte };
}

// La pagina già aperta tiene quello che ha ottenuto, e un no alle notifiche lo legge finché non si ricarica.
function dimentica(wc) {
  const { origine, scelte } = scelteDi(wc);
  if (!scelte.length) return { tolte: 0, ricarica: false };
  for (const s of scelte) wc.session._filoScelte.delete(`${origine}|${s.parte}`);
  return { tolte: scelte.length, ricarica: scelte.some((s) => s.si || s.parte === 'notifiche') };
}

// Quello che una pagina deve leggere delle notifiche prima di chiedere, come in Chrome: il controllo di Electron sa dire
// solo sì o no, e il sì mostrerebbe le notifiche senza domanda. La traduzione nella pagina: preload/stato-permessi.js.
function statoNotifiche(ses, url) {
  const origine = origineWeb(url);
  const scelta = origine && ses && ses._filoScelte ? ses._filoScelte.get(`${origine}|notifiche`) : undefined;
  return scelta === true ? 'granted' : scelta === false ? 'denied' : 'default';
}

module.exports = {
  installa, negaTutto, rispondi, lasciapassare, seguiGesti, scelteDi, dimentica, nomeDaMostrare, statoNotifiche,
  TIPI, INNOCUI, GESTO_MS, _inAttesa: inAttesa,
};
