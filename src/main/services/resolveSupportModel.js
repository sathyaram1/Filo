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

module.exports = { resolveSupportModel, SLOT_DEFAULTS };
