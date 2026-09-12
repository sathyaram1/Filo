// Wrapper su chrome.storage.local con merge di default per le impostazioni.

(function (global) {
  'use strict';

  const { STORAGE_KEYS, DEFAULT_SETTINGS } = global.SN_CONST;

  // Chiavi il cui valore va SOSTITUITO interamente invece di fuso ricorsivamente.
  // Servono per oggetti-mappa il cui contratto è "questa è la lista completa,
  // chi manca è stato rimosso" (es. modelRegistry: rimuovere un nickname dalla
  // UI deve cancellarlo dallo storage, non lasciarlo lì in vita perché era in
  // target).
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

  // Confronta due fotografie delle impostazioni e restituisce SOLO le foglie
  // cambiate, con la loro nidificazione. Serve alle pagine delle impostazioni:
  // una pagina deve poter dire "ho toccato questa manopola" e non "ecco tutto
  // il blocco com'era quando ti ho aperto", se no una scelta fatta altrove
  // mentre la pagina restava aperta torna indietro al primo tocco.
  //
  // Perché fino alla FOGLIA e non al gruppo: modalità terminale e shell sono
  // un gruppo solo, le due chiavi API sono un gruppo solo, velocità e tono
  // della voce sono un gruppo solo. Fermarsi al gruppo vuol dire che toccare
  // la shell rimanda anche il permesso della shell, col valore vecchio (#592,
  // giro 3: cinque porte, tutte così).
  //
  // Le chiavi di REPLACE_KEYS restano INTERE: il loro contratto è "questa è la
  // lista completa, chi manca è stato rimosso", quindi mandarne un pezzo
  // cancellerebbe il resto invece di aggiornarlo.
  function partialCambiato(prima, adesso) {
    const isMappa = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    if (!isMappa(adesso)) return {};
    const out = {};
    for (const k of Object.keys(adesso)) {
      const nuovo = adesso[k];
      const vecchio = isMappa(prima) ? prima[k] : undefined;
      if (!REPLACE_KEYS.has(k) && isMappa(nuovo) && isMappa(vecchio)) {
        const sotto = partialCambiato(vecchio, nuovo);
        if (Object.keys(sotto).length) out[k] = sotto;
      } else if (JSON.stringify(vecchio) !== JSON.stringify(nuovo)) {
        out[k] = nuovo;
      }
    }
    return out;
  }

  async function getSettings() {
    const res = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    const stored = res[STORAGE_KEYS.SETTINGS] || {};
    // Seed di prima esecuzione: se non c'è proprio una chiave modelRegistry
    // nello storage (utente pre-refactor), partiamo dai default. Un oggetto
    // vuoto salvato esplicitamente dall'utente viene rispettato (registry vuoto).
    if (!stored.modelRegistry) {
      // Il registro di build è vuoto (nessun modello scritto nel codice); nei
      // test c'è un registro di prova.
      const seed = (global.SN_TEST_MODELS && global.SN_TEST_MODELS.registry) || global.SN_CONST.DEFAULT_MODEL_REGISTRY;
      stored.modelRegistry = { ...seed };
    }
    // Stesso seme per le catene delle funzioni: nell'app restano vuote (una
    // funzione senza modello si ferma e lo dice), nei test partono dal registro
    // di prova.
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
    partialCambiato,
    REPLACE_KEYS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
