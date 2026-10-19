// L'account Google entrato nelle schede (#1123): da lì i domini di Google tengono i cookie anche nei riquadri
// (Automatico) e il loro jar comune diventa persistente (Privacy). Non apre pagine: lo fa auth/prodottiGoogle.js.
// I domini del gruppo stanno in shared/dominiGoogle.js.

'use strict';

const { session } = require('electron');
const G = require('../../shared/dominiGoogle');

const ACCOUNTS = 'https://accounts.google.com/';
const seguite = new WeakSet();
let fiducia = null;

function Cookies() { return require('./cookies'); }

function inPrivacy() {
  const C = Cookies();
  return C.currentMode(false) === C.MODES.PRIVACY;
}

// La sessione dove una scheda nuova su Google troverebbe l'account adesso.
function sessioneDiGoogle() {
  try { return Cookies().sessioneDelleSchede(ACCOUNTS); } catch (_) { return session.defaultSession; }
}

async function collegatoNelleSchede() {
  const ses = sessioneDiGoogle();
  if (!ses) return false;
  try { return (await ses.cookies.get({ domain: G.SITO_GOOGLE })).some(G.cookieDiAccesso); } catch (_) { return false; }
}

// In Privacy il jar di Google entra fra i fidati la prima volta che ci si vede un account: è una voce
// dell'elenco come le altre, e chi la toglie ritrova il jar che si svuota all'uscita.
function rendiPersistente() {
  if (fiducia || Cookies().keepsSiteData(G.SITO_GOOGLE)) return fiducia || Promise.resolve();
  fiducia = (async () => {
    const Storage = globalThis.SN_STORAGE;
    const { applySettingsUpdate } = require('./handlers');
    const s = await Storage.getSettings();
    const prima = Cookies().getTrustedSites(s);
    if (G.googleNellElenco(prima)) return;
    await applySettingsUpdate({ security: { cookies: { trustedSites: [...prima, G.SITO_GOOGLE] } } });
  })().catch(() => {}).finally(() => { fiducia = null; });
  return fiducia;
}

async function accessoOsservato(ses) {
  try { await require('./cookieIncorporati').accessoOsservato(G.SITO_GOOGLE); } catch (_) {}
  if (!inPrivacy()) return;
  await rendiPersistente();
  if (ses) await travasa(ses);
}

// Le schede aperte prima che il jar diventasse persistente stanno ancora in quello effimero: quello che ci
// succede passa in quello che troverà la prossima scheda.
async function travasa(ses) {
  const dest = sessioneDiGoogle();
  if (!dest || dest === ses) return;
  let lista = [];
  try { lista = await ses.cookies.get({}); } catch (_) { return; }
  for (const c of lista) await Cookies().copiaCookie(c, dest);
}

function rispecchia(ses, c, tolto) {
  if (!inPrivacy() || !Cookies().keepsSiteData(G.SITO_GOOGLE)) return;
  const dest = sessioneDiGoogle();
  if (!dest || dest === ses) return;
  if (!tolto) { Cookies().copiaCookie(c, dest).catch(() => {}); return; }
  const url = (c.secure ? 'https://' : 'http://') + String(c.domain || '').replace(/^\./, '') + (c.path || '/');
  dest.cookies.remove(url, c.name).catch(() => {});
}

// `partition`: quella del jar di Google in Privacy; senza, la sessione di tutte le schede.
function osserva(ses, partition = '') {
  if (!ses || seguite.has(ses)) return;
  seguite.add(ses);
  const effimera = !!partition && !partition.startsWith('persist:');
  try {
    ses.cookies.on('changed', (_e, c, causa, tolto) => {
      if (!c) return;
      if (!tolto && G.cookieDiAccesso(c)) accessoOsservato(effimera ? ses : null).catch(() => {});
      // Una sovrascrittura arriva come un'uscita seguita dall'arrivo del nuovo: basta il secondo.
      if (effimera && !(tolto && causa === 'overwrite')) rispecchia(ses, c, tolto);
    });
  } catch (_) {}
}

// Un accesso a Google fatto prima di Filo con questa regola conta come visto: i suoi domini si proteggono subito.
function init() {
  osserva(session.defaultSession);
  collegatoNelleSchede().then((si) => { if (si) accessoOsservato(null).catch(() => {}); }).catch(() => {});
}

module.exports = { init, osserva, collegatoNelleSchede, accessoOsservato };
