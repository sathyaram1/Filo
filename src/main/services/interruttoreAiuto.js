// L'interruttore dell'Aiuto (#841) visto dal main, e il vecchio valore di serie (spento) dei file di dati.
// Un file di prima ha `featureFlags.help: false` anche se nessuno l'ha scelto: è una scelta solo se il registro
// dei cambi dice che l'ultima volta qualcuno l'ha spento. Prove: tests/unit/interruttoreAiuto.test.mjs.
'use strict';

const SEGNO = 'sn_aiuto_di_serie_migrated';
const PERCORSO = 'featureFlags.help';

function chiavi() {
  if (!globalThis.SN_CONST) require('../../shared/constants.js');
  return globalThis.SN_CONST.STORAGE_KEYS;
}

function acceso(settings) {
  return !(settings && settings.featureFlags && settings.featureFlags.help === false);
}

// L'ultimo valore che il registro ha visto dare all'interruttore; undefined se non l'ha mai visto cambiare.
function sceltaRegistrata(registro) {
  let ultima;
  for (const e of Array.isArray(registro) ? registro : []) {
    if (!e || e.tipo !== 'impostazioni' || !Array.isArray(e.cambi)) continue;
    for (const c of e.cambi) if (c && c.chiave === PERCORSO) ultima = c.dopo;
  }
  return ultima;
}

// `dati`: lo storage intero, o un backup. Vero se il suo `false` è il vecchio valore di serie.
function spentoDiSerie(dati) {
  const d = dati && typeof dati === 'object' ? dati : {};
  const s = d[chiavi().SETTINGS];
  if (d[SEGNO] || !s || typeof s !== 'object' || !s.featureFlags || s.featureFlags.help !== false) return false;
  return sceltaRegistrata(d[chiavi().FILO_CAMBI]) !== false;
}

// Un backup di prima non spegne l'Aiuto di chi lo importa: il suo `false` non era di nessuno, resta il valore di qui.
function perImportazione(dati) {
  if (!spentoDiSerie(dati)) return dati;
  const K = chiavi();
  const featureFlags = { ...dati[K.SETTINGS].featureFlags };
  delete featureFlags.help;
  return { ...dati, [K.SETTINGS]: { ...dati[K.SETTINGS], featureFlags } };
}

// All'avvio, prima di ogni finestra: una volta sola, poi il segno dice che ogni `false` è una scelta.
async function migra({ storage = require('../shim/storage'), registro = require('./registroCambi') } = {}) {
  const K = chiavi();
  const dati = await storage.get([K.SETTINGS, K.FILO_CAMBI, SEGNO]);
  if (dati[SEGNO]) return false;
  const riaccendi = spentoDiSerie(dati);
  const scrittura = { [SEGNO]: true };
  if (riaccendi) {
    const s = dati[K.SETTINGS];
    scrittura[K.SETTINGS] = { ...s, featureFlags: { ...s.featureFlags, help: true } };
  }
  await registro.con({ via: 'migrazione' }, () => storage.set(scrittura));
  return riaccendi;
}

// In incognito vale quello che legge la finestra: la sua memoria, come per le sue pagine.
async function accesoPer(win) {
  const leggi = () => globalThis.SN_STORAGE.getSettings();
  const s = win && win._filoIncognito ? await require('../shim/storage').runIncognito(leggi) : await leggi();
  return acceso(s);
}

// Spento, dice perché nella cornice: sotto l'avviso del sito l'avviso della pagina non si vedrebbe.
function seAcceso(win, fn) {
  accesoPer(win).then((si) => {
    if (si) { fn(); return; }
    try {
      const testo = globalThis.SN_I18N && globalThis.SN_I18N.t('help_disabled');
      if (testo && win && !win.isDestroyed()) win.webContents.send('shell:toast', { text: testo, opts: { unica: 'aiuto-spento', tipo: 'aiuto_spento' } });
    } catch (_) {}
  }, () => {});
}

module.exports = { SEGNO, acceso, sceltaRegistrata, spentoDiSerie, perImportazione, migra, accesoPer, seAcceso };
