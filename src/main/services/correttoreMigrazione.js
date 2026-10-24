// Dai segni blu e ocra ai due del correttore (#1446), una volta sola: chi aveva spento il blu tiene gli errori del solo
// codice (parte del modello e ripetizioni spente), e i colori scelti per l'ocra passano ai suggerimenti. L'ocra spento è
// già «Suggerimenti» spento: stessa chiave. Prove: tests/unit/correttoreMigrazione.test.mjs.
'use strict';

const SEGNO = 'sn_correttore_due_segni_migrated';
// Il blu non aveva token suoi: i colori scelti erano solo quelli dell'ocra.
const TOKEN = Object.freeze({
  'correttore.ocra.color': 'correttore.suggerimenti.color',
  'correttore.ocra.stile': 'correttore.suggerimenti.stile',
});

function chiavi() {
  if (!globalThis.SN_CONST) require('../../shared/constants.js');
  return globalThis.SN_CONST.STORAGE_KEYS;
}

// Le impostazioni di prima nella forma di adesso; null se non c'è niente da cambiare. PURA.
function convertite(s) {
  if (!s || typeof s !== 'object') return null;
  let out = null;
  const ff = s.featureFlags && typeof s.featureFlags === 'object' ? s.featureFlags : null;
  if (ff && ff.spellcheck === false) {
    out = {
      ...s,
      featureFlags: { ...ff, spellcheck: true },
      correttore: { ...(s.correttore && typeof s.correttore === 'object' ? s.correttore : {}), modelloErrori: false, ripetizioni: false },
    };
  }
  const tt = s.themeTokens;
  if (tt && typeof tt === 'object' && Object.keys(TOKEN).some((k) => k in tt)) {
    const nuovi = { ...tt };
    for (const [da, a] of Object.entries(TOKEN)) {
      if (!(da in nuovi)) continue;
      if (!(a in nuovi)) nuovi[a] = nuovi[da];
      delete nuovi[da];
    }
    out = { ...(out || s), themeTokens: nuovi };
  }
  return out;
}

// All'avvio, prima di ogni finestra: poi il segno dice che ogni `spellcheck: false` è «Errori» spento.
async function migra({ storage = require('../shim/storage'), registro = require('./registroCambi') } = {}) {
  const K = chiavi();
  const dati = await storage.get([K.SETTINGS, SEGNO]);
  if (dati[SEGNO]) return false;
  const nuove = convertite(dati[K.SETTINGS]);
  const scrittura = { [SEGNO]: true };
  if (nuove) scrittura[K.SETTINGS] = nuove;
  await registro.con({ via: 'migrazione' }, () => storage.set(scrittura));
  return Boolean(nuove);
}

// Un backup di prima importato dopo: le sue scelte su blu e ocra arrivano nella forma di adesso. Uno di dopo ha il segno.
function perImportazione(dati) {
  if (!dati || typeof dati !== 'object' || dati[SEGNO]) return dati;
  const K = chiavi();
  const nuove = convertite(dati[K.SETTINGS]);
  return nuove ? { ...dati, [K.SETTINGS]: nuove } : dati;
}

module.exports = { SEGNO, TOKEN, convertite, migra, perImportazione };
