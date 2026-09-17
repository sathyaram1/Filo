// Wrapper su chrome.storage.local con merge di default per le impostazioni.

(function (global) {
  'use strict';

  const { STORAGE_KEYS, DEFAULT_SETTINGS } = global.SN_CONST;

  // Chiavi da SOSTITUIRE invece di fondere: il loro contratto è «questa è la lista completa,
  // chi manca è stato rimosso»: togliere un nickname dalla UI deve cancellarlo davvero.
  const REPLACE_KEYS = new Set(['modelRegistry', 'themeTokens']);

  function deepMerge(target, source, path = '') {
    if (typeof target !== 'object' || target === null) return source;
    if (typeof source !== 'object' || source === null) return target;
    const out = Array.isArray(target) ? [...target] : { ...target };
    for (const k of Object.keys(source)) {
      const sv = source[k];
      const tv = out[k];
      if (REPLACE_KEYS.has(k)) {
        out[k] = sv;
      } else if (sv && typeof sv === 'object' && !Array.isArray(sv) && typeof tv === 'object' && tv !== null) {
        out[k] = deepMerge(tv, sv, path ? `${path}.${k}` : k);
      } else {
        out[k] = sv;
      }
    }
    return out;
  }

  async function getSettings() {
    const res = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    const stored = res[STORAGE_KEYS.SETTINGS] || {};
    // Seed di prima esecuzione: se la chiave manca del tutto si parte dai default;
    // un oggetto vuoto salvato dall'utente si rispetta (registry vuoto).
    if (!stored.modelRegistry) {
      // Il registro di build è vuoto (nessun modello scritto nel codice); nei
      // test c'è un registro di prova.
      const seed = (global.SN_TEST_MODELS && global.SN_TEST_MODELS.registry) || global.SN_CONST.DEFAULT_MODEL_REGISTRY;
      stored.modelRegistry = { ...seed };
    }
    // Stesso seme per le catene delle funzioni: vuote nell'app (una funzione senza
    // modello si ferma e lo dice), dal registro di prova nei test.
    if (!stored.models && global.SN_TEST_MODELS && global.SN_TEST_MODELS.models) {
      stored.models = { ...global.SN_TEST_MODELS.models };
    }
    return deepMerge(DEFAULT_SETTINGS, stored);
  }

  async function setSettings(settings) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
  }

  async function updateSettings(partial) {
    const current = await getSettings();
    const merged = deepMerge(current, partial);
    await setSettings(merged);
    return merged;
  }

  async function getRaw(key, fallback) {
    const res = await chrome.storage.local.get(key);
    return res[key] === undefined ? fallback : res[key];
  }
  async function setRaw(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }

  global.SN_STORAGE = {
    getSettings,
    setSettings,
    updateSettings,
    getRaw,
    setRaw,
    deepMerge,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
