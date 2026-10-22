// Risolve il modello di uno slot di supporto dalla config remota `config/supportModels`.
// INVARIANTE: se la config manca (rete giù, slot vuoto) torna il fallback del chiamante.
// Il getter è iniettabile per i test; in produzione è supportModelsStore.get().

'use strict';

const SupportModels = require('./supportModelsStore');

// Mirror dei default del backend: qui cambia solo il fallback, il valore vero sta sul doc
// che l'owner configura dalla dashboard.
const SLOT_DEFAULTS = {
  sanitizer:     'flash',
  judge1:        'flash, flash-or',
  judge2:        'flash, flash-or',
  judge3:        'flash, flash-or',
  judgeDynamic:  'flash, flash-or',
  judgeRedTeam:  'flash',
  judgePriority: 'flash',
};

// La scelta iniziale delle funzioni dell'owner nate dopo lo spostamento (#465): non hanno una scelta di prima da
// ereditare, e senza questa partirebbero spente finché l'owner non le imposta (#1118). Una stringa vuota le spegne.
const OWNER_SLOT_DEFAULTS = Object.freeze({
  manageSearchClassifier: 'typesafe/jev-1.13',
});

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
    return fallback;
  }

  if (!config || typeof config !== 'object') return fallback;

  const value = config[slot];
  if (typeof value === 'string' && value.trim()) return value.trim();

  return fallback;
}

function ownerSlotFor(action) {
  const Usage = globalThis.SN_MODEL_USAGE;
  return Usage && typeof Usage.ownerSlotForAction === 'function' ? Usage.ownerSlotForAction(action) : '';
}

// Funzioni che usa solo l'owner (#465): catena dal loro slot, registro dei giudici sopra a quello
// effettivo come sul server; slot null = mai impostato, resta la scelta di prima dello spostamento o, se non
// c'è, la scelta iniziale dello slot.
function initialChain(slot, settings, action) {
  const prima = settings && settings.models ? settings.models[action] : null;
  if (typeof prima === 'string' && prima.trim()) return null;
  return OWNER_SLOT_DEFAULTS[slot] || null;
}

async function settingsForOwnerAction(settings, action, getConfig) {
  const slot = ownerSlotFor(action);
  if (!slot) return settings;
  const getter = typeof getConfig === 'function' ? getConfig : SupportModels.get;
  let config = null;
  try { config = await getter(); } catch (_) { config = null; }
  let chain = config ? config[slot] : null;
  if (typeof chain !== 'string') chain = initialChain(slot, settings, action);
  if (typeof chain !== 'string') return settings;
  const judgeRegistry = (config && config.judgeRegistry && typeof config.judgeRegistry === 'object') ? config.judgeRegistry : {};
  return {
    ...settings,
    models: { ...(settings.models || {}), [action]: chain.trim() },
    modelRegistry: { ...(settings.modelRegistry || {}), ...judgeRegistry },
  };
}

// Per l'editor di Gestione: uno slot spostato e mai impostato mostra la catena che la funzione usa
// adesso, e `movedUnset` lo dice all'editor: quel valore è una lettura, non una scelta, e un
// salvataggio che non l'ha cambiato non lo scrive (senza predefiniti arrivati sarebbe vuoto).
function fillMovedSlots(models, settings) {
  const Usage = globalThis.SN_MODEL_USAGE;
  const pairs = Usage && typeof Usage.ownerActions === 'function' ? Usage.ownerActions() : [];
  const inUse = (settings && settings.models) || {};
  const unset = [];
  for (const { action, slot } of pairs) {
    if (models[slot] != null) continue;
    models[slot] = initialChain(slot, settings, action) || (typeof inUse[action] === 'string' ? inUse[action] : '');
    unset.push(slot);
  }
  models.movedUnset = unset;
  return models;
}

module.exports = { resolveSupportModel, SLOT_DEFAULTS, OWNER_SLOT_DEFAULTS, ownerSlotFor, settingsForOwnerAction, fillMovedSlots };
