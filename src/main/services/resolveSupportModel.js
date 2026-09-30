// Helper: risolve il modello (nickname catena) per uno slot di supporto.
//
// PERCHÉ ESISTE
//   DD1 ha creato il doc Firestore `config/supportModels` con uno slot per
//   funzione di supporto (sanitizer, judge1, judge2, judge3, judgeDynamic,
//   judgeRedTeam, judgePriority). I chiamanti che devono
//   scegliere il modello per un task di supporto usano questa funzione per
//   leggere lo slot dalla config remota con fallback al valore hard-coded
//   passato come parametro — garantendo la backward-compat se la config è
//   assente/vuota.
//
// INVARIANTE DURA
//   Se la config non c'è (rete giù, doc non ancora creato, slot vuoto),
//   il comportamento è identico a oggi: la funzione ritorna il fallback.
//   Nessuna regressione possibile.
//
// USO TIPICO
//   // in un chiamante (backend, routine cloud, main process):
//   const modelRef = await resolveSupportModel('sanitizer', 'flash');
//   // modelRef è una catena di nickname (es. "flash, flash-or") o il fallback.
//   // Il chiamante la passa a buildAttemptChain(settings, modelRef) come sempre.
//
// ZERO DIPENDENZE ESTERNE DAL CHIAMANTE
//   La funzione accetta un getter opzionale (per i test, dove non si vuole rete).
//   In produzione usa supportModelsStore.get() direttamente.

'use strict';

const SupportModels = require('./supportModelsStore');

// Valori di default raccomandati per ogni slot (mirror dei default del backend).
// Cambiarli qui cambia solo il fallback in-process; il valore vero è sul doc
// Firestore che l'owner configura dalla dashboard.
const SLOT_DEFAULTS = {
  sanitizer:     'flash',
  judge1:        'flash, flash-or',
  judge2:        'flash, flash-or',
  judge3:        'flash, flash-or',
  judgeDynamic:  'flash, flash-or',
  judgeRedTeam:  'flash',
  judgePriority: 'flash',
};

/**
 * Risolve il modello per uno slot di supporto.
 *
 * @param {string} slot         - Uno di: sanitizer, judge1, judge2, judge3, judgeDynamic, judgeRedTeam, judgePriority
 * @param {string} [hardcoded]  - Fallback hard-coded se la config è assente/vuota.
 *                                 Se omesso, usa SLOT_DEFAULTS[slot] oppure 'flash'.
 * @param {Function} [getConfig] - Getter asincrono che ritorna { [slot]: string }.
 *                                 In produzione = SupportModels.get. Iniettabile per i test.
 * @returns {Promise<string>}   - Catena di nickname (es. "flash, flash-or").
 */
async function resolveSupportModel(slot, hardcoded, getConfig) {
  const fallback = (typeof hardcoded === 'string' && hardcoded.trim())
    ? hardcoded.trim()
    : (SLOT_DEFAULTS[slot] || 'flash');

  const getter = typeof getConfig === 'function' ? getConfig : SupportModels.get;

  let config;
  try {
    config = await getter();
  } catch (_) {
    // Rete giù, Firestore non raggiungibile, ecc. → fallback.
    return fallback;
  }

  if (!config || typeof config !== 'object') return fallback;

  const value = config[slot];
  if (typeof value === 'string' && value.trim()) return value.trim();

  return fallback;
}

// Le funzioni dell'app che usa solo chi gestisce Filo (censimento: `owner` con
// `action`) prendono la catena dal loro slot, e i nickname si risolvono sul
// registro dei giudici sopra a quello effettivo, come fa il server dei giudici.
// Slot null = mai impostato: resta la scelta fatta prima dello spostamento (#465).
function ownerSlotFor(action) {
  const Usage = globalThis.SN_MODEL_USAGE;
  return Usage && typeof Usage.ownerSlotForAction === 'function' ? Usage.ownerSlotForAction(action) : '';
}

async function settingsForOwnerAction(settings, action, getConfig) {
  const slot = ownerSlotFor(action);
  if (!slot) return settings;
  const getter = typeof getConfig === 'function' ? getConfig : SupportModels.get;
  let config = null;
  try { config = await getter(); } catch (_) { config = null; }
  const chain = config ? config[slot] : null;
  if (typeof chain !== 'string') return settings;
  const judgeRegistry = (config.judgeRegistry && typeof config.judgeRegistry === 'object') ? config.judgeRegistry : {};
  return {
    ...settings,
    models: { ...(settings.models || {}), [action]: chain.trim() },
    modelRegistry: { ...(settings.modelRegistry || {}), ...judgeRegistry },
  };
}

// Per l'editor di Gestione: uno slot spostato e mai impostato mostra la catena
// che la funzione usa davvero, così salvando la si porta nello slot.
function fillMovedSlots(models, settings) {
  const Usage = globalThis.SN_MODEL_USAGE;
  const pairs = Usage && typeof Usage.ownerActions === 'function' ? Usage.ownerActions() : [];
  const inUse = (settings && settings.models) || {};
  for (const { action, slot } of pairs) {
    if (models[slot] == null) models[slot] = typeof inUse[action] === 'string' ? inUse[action] : '';
  }
  return models;
}

module.exports = { resolveSupportModel, SLOT_DEFAULTS, ownerSlotFor, settingsForOwnerAction, fillMovedSlots };
