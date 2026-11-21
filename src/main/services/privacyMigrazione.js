// Dall'interruttore delle pagine delicate ai livelli di privacy (#1589), una volta sola e per i backup di prima: chi
// l'aveva acceso, anche di serie, riparte da «Chiedi sulle delicate». Mai più largo di quello che ha adesso, e un
// livello scelto dopo (registro dei cambi) resta. La regola sta in livelliPrivacy.js; prove: tests/unit/privacyMigrazione.test.mjs.
'use strict';

const SEGNO = 'sn_privacy_livelli_migrated';
const PERCORSO = 'security.privacy.livello';

function chiavi() {
  if (!globalThis.SN_CONST) require('../../shared/constants.js');
  return globalThis.SN_CONST.STORAGE_KEYS;
}
function livelli() {
  if (!globalThis.SN_LIVELLI_PRIVACY) require('../../shared/livelliPrivacy.js');
  return globalThis.SN_LIVELLI_PRIVACY;
}

// Il livello l'ha scelto lui dopo l'aggiornamento: cambiato (registro dei cambi) o confermato nell'intervista.
function sceltoDopo(registro, intervista) {
  if (intervista && Array.isArray(intervista.ticked) && intervista.ticked.includes('privacy')) return true;
  for (const e of Array.isArray(registro) ? registro : []) {
    if (!e || e.tipo !== 'impostazioni' || !Array.isArray(e.cambi)) continue;
    if (e.cambi.some((c) => c && c.chiave === PERCORSO)) return true;
  }
  return false;
}

// `dati`: lo storage intero, o un backup. Le impostazioni nella forma di adesso, o null se non c'è niente da cambiare. PURA.
function convertite(dati) {
  const d = dati && typeof dati === 'object' ? dati : {};
  const K = chiavi();
  const s = d[K.SETTINGS];
  if (d[SEGNO] || !s || typeof s !== 'object' || !s.security || typeof s.security !== 'object') return null;
  const L = livelli();
  const daQui = L.livelloDiPrima(s.security.pagineDelicate);
  if (!daQui || sceltoDopo(d[K.FILO_CAMBI], d[K.FILO_ONBOARDING])) return null;
  const privacy = s.security.privacy && typeof s.security.privacy === 'object' ? s.security.privacy : {};
  const attuale = L.regola(s).livello;
  if (L.ORDINE.indexOf(attuale) >= L.ORDINE.indexOf(daQui)) return null;
  return { ...s, security: { ...s.security, privacy: { ...privacy, livello: daQui } } };
}

// All'avvio, prima di ogni finestra: poi il segno dice che il livello è quello di adesso.
async function migra({ storage = require('../shim/storage'), registro = require('./registroCambi') } = {}) {
  const K = chiavi();
  const dati = await storage.get([K.SETTINGS, K.FILO_CAMBI, K.FILO_ONBOARDING, SEGNO]);
  if (dati[SEGNO]) return false;
  if (!Array.isArray(dati[K.FILO_CAMBI]) && typeof registro.lista === 'function') {
    try { dati[K.FILO_CAMBI] = await registro.lista(); } catch (_) {}
  }
  const nuove = convertite(dati);
  const scrittura = { [SEGNO]: true };
  if (nuove) scrittura[K.SETTINGS] = nuove;
  await registro.con({ via: 'migrazione' }, () => storage.set(scrittura));
  return Boolean(nuove);
}

// Un backup di prima importato dopo: la sua protezione accesa arriva come livello. Uno di dopo ha il segno.
function perImportazione(dati) {
  const nuove = convertite(dati);
  return nuove ? { ...dati, [chiavi().SETTINGS]: nuove } : dati;
}

module.exports = { SEGNO, convertite, migra, perImportazione };
