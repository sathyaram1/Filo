// Microfono, fotocamera, appunti e posizione: una pagina web li ha solo se l'utente dice sì nella cornice (#591.1).
// Filo stesso (filo://, la shell) resta com'era; Detta e Incolla sulle pagine passano da un lasciapassare di pochi secondi.
// Senza gestore Electron concede tutto: ogni sessione che mostra pagine web passa da `installa` o da `negaTutto`.

'use strict';

const { randomUUID } = require('node:crypto');

const TIPI = {
  media: 'media',
  'clipboard-read': 'appunti',
  'deprecated-sync-clipboard-read': 'appunti',
  geolocation: 'posizione',
};
// La lettura sincrona degli appunti non sa chiedere: passa solo con un sì già dato.
const SOLO_CONTROLLO = new Set(['deprecated-sync-clipboard-read']);
const LASCIAPASSARE_MS = 5000;

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

function lasciapassareValido(wc, tipo) {
  const p = wc && lasciapassari.get(wc.id);
  return Boolean(p && p.tipo === tipo && p.fino > Date.now());
}

function lasciapassare(wc, tipo) {
  if (!wc || (tipo !== 'media' && tipo !== 'appunti')) return false;
  lasciapassari.set(wc.id, { tipo, fino: Date.now() + LASCIAPASSARE_MS });
  return true;
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

function chiedi({ ses, wc, origine, tipo, parti, callback, schedaDi }) {
  const dove = schedaDi(wc);
  if (!dove || typeof dove.avvisa !== 'function') { callback(false); return; }
  for (const p of inAttesa.values()) {
    if (p.wc === wc && p.origine === origine && p.parti.join() === parti.join()) { p.callbacks.push(callback); return; }
  }
  const id = randomUUID();
  inAttesa.set(id, { ses, wc, origine, tipo, parti, callbacks: [callback], avvisa: dove.avvisa });
  seguiPagina(wc);
  let host = origine;
  try { host = new URL(origine).host; } catch (_) {}
  dove.avvisa('chiedi', { id, tabId: dove.tabId, host, tipo, parti });
}

// `schedaDi(wc)` → { tabId, avvisa(evento, dati) } della finestra che mostra la pagina, o null.
function installa(ses, { schedaDi, prima } = {}) {
  if (!ses || ses._filoPermessi) return;
  ses._filoPermessi = true;
  try {
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (typeof prima === 'function' && prima(wc, permission, callback, details)) return;
      const tipo = TIPI[permission];
      if (!tipo) { callback(true); return; }
      const origine = origineDi(wc, details && details.requestingUrl);
      if (!origine || lasciapassareValido(wc, tipo)) { callback(true); return; }
      const parti = partiDi(tipo, details);
      const decise = parti.map((parte) => sceltePer(ses).get(`${origine}|${parte}`));
      if (decise.every((x) => x === true)) { callback(true); return; }
      if (decise.some((x) => x === false) || SOLO_CONTROLLO.has(permission)) { callback(false); return; }
      chiedi({ ses, wc, origine, tipo, parti, callback, schedaDi: schedaDi || (() => null) });
    });
  } catch (_) {}
  try {
    // «Posso?» risponde sì finché l'utente non ha detto no: un «negato» qui farebbe credere al sito che non valga la pena chiedere.
    ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      const tipo = TIPI[permission];
      if (!tipo) return true;
      const origine = origineDi(wc, (details && details.requestingUrl) || requestingOrigin);
      if (!origine || lasciapassareValido(wc, tipo)) return true;
      const decise = partiDi(tipo, details).map((parte) => sceltePer(ses).get(`${origine}|${parte}`));
      if (SOLO_CONTROLLO.has(permission)) return decise.every((x) => x === true);
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

module.exports = { installa, negaTutto, rispondi, lasciapassare, TIPI, _inAttesa: inAttesa };
