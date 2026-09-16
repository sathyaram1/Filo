// Risolve il modello (catena di nickname) per uno slot di supporto — sanitizer, judge1…judgePriority — leggendolo dalla config remota `config/supportModels`.
// INVARIANTE DURA: se la config non c'è (rete giù, doc non creato, slot vuoto) ritorna il fallback passato dal chiamante, cioè il comportamento di prima. Nessuna regressione possibile.
// Il getter è iniettabile per i test; in produzione usa supportModelsStore.get(). Il risultato si passa a buildAttemptChain come qualunque altra catena.

'use strict';

const SupportModels = require('./supportModelsStore');

// Mirror dei default del backend: cambiarli qui cambia solo il fallback in-process, il valore vero è sul doc Firestore che l'owner configura dalla dashboard.
const SLOT_DEFAULTS = {
  sanitizer:     'flash',
  judge1:        'flash, flash-or',
  judge2:        'flash, flash-or',
  judge3:        'flash, flash-or',
  judgeDynamic:  'flash, flash-or',
  judgeRedTeam:  'flash',
  judgePriority: 'flash',
};

/** @param {string} slot sanitizer | judge1 | judge2 | judge3 | judgeDynamic | judgeRedTeam | judgePriority
* @param {string} [hardcoded] fallback se la config è assente/vuota; omesso → SLOT_DEFAULTS[slot] oppure 'flash'.
* @param {Function} [getConfig] getter asincrono { [slot]: string }, iniettabile per i test. @returns {Promise<string>} catena di nickname. */
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

module.exports = { resolveSupportModel, SLOT_DEFAULTS };
