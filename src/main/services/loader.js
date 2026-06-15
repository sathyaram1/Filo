// Loader: importa i moduli "background" (portati 1:1 dall'estensione) e
// "shared" nell'ordine corretto. Tutti i file usano il pattern IIFE che
// si registra su globalThis, quindi require() basta a renderli disponibili.
//
// Lo shim chrome.* deve essere già stato caricato prima di questo file
// (main.js lo fa nell'ordine giusto).

const path = require('node:path');

const SHARED = path.join(__dirname, '..', '..', 'shared');
const SVC = __dirname;

// Ordine identico al vecchio background.js importScripts(...).
require(path.join(SHARED, 'constants.js'));
require(path.join(SHARED, 'messages.js'));
require(path.join(SHARED, 'i18n.js'));
require(path.join(SHARED, 'modelCaps.js'));
require(path.join(SHARED, 'storage.js'));
require(path.join(SHARED, 'themeTokens.js'));
require(path.join(SHARED, 'paths.js'));
require(path.join(SHARED, 'filoMemory.js'));
require(path.join(SHARED, 'filoState.js'));
require(path.join(SHARED, 'dashboardRefresh.js'));
require(path.join(SHARED, 'feedback.js'));
require(path.join(SHARED, 'preferences.js'));
require(path.join(SHARED, 'cmdClassify.js'));
require(path.join(SHARED, 'actionLevels.js'));
require(path.join(SVC, 'providers', 'openrouter.js'));
require(path.join(SVC, 'providers', 'gemini.js'));
require(path.join(SVC, 'providers', 'index.js'));
require(path.join(SVC, 'costTracker.js'));
require(path.join(SVC, 'savedPages.js'));
require(path.join(SVC, 'historyStore.js'));
require(path.join(SVC, 'archivedTabs.js'));
require(path.join(SVC, 'aiCache.js'));
require(path.join(SVC, 'categorizer.js'));
require(path.join(SVC, 'pathsCollector.js'));
require(path.join(SVC, 'llmsTxt.js'));
require(path.join(SVC, 'webSearch.js'));
require(path.join(SVC, 'fxRates.js'));
require(path.join(SVC, 'safebrowse', 'index.js'));
require(path.join(SVC, 'geoBlock.js'));
require(path.join(SVC, 'geoBlockClassifier.js'));
require(path.join(SVC, 'geoBlockRules.js'));

module.exports = {
  // Esponiamo gli oggetti popolati su globalThis per chi vuole un riferimento
  // diretto invece di pescare da globalThis.
  get SN_CONST() { return globalThis.SN_CONST; },
  get SN_MSG() { return globalThis.SN_MSG; },
  get SN_STORAGE() { return globalThis.SN_STORAGE; },
  get SN_PROVIDERS() { return globalThis.SN_PROVIDERS; },
  get SN_COSTS() { return globalThis.SN_COSTS; },
  get SN_SAVED_PAGES() { return globalThis.SN_SAVED_PAGES; },
  get SN_HISTORY() { return globalThis.SN_HISTORY; },
  get SN_I18N() { return globalThis.SN_I18N; },
  get SN_CATEGORIZER() { return globalThis.SN_CATEGORIZER; },
  get SN_AI_CACHE() { return globalThis.SN_AI_CACHE; },
  get SN_FX() { return globalThis.SN_FX; },
  get SN_PATHS_COLLECTOR() { return globalThis.SN_PATHS_COLLECTOR; },
  get SN_PATHS() { return globalThis.SN_PATHS; },
  get SN_LLMS_TXT() { return globalThis.SN_LLMS_TXT; },
  get SN_WEB_SEARCH() { return globalThis.SN_WEB_SEARCH; },
  get SN_FILO_MEMORY() { return globalThis.SN_FILO_MEMORY; },
  get SN_FILO_STATE() { return globalThis.SN_FILO_STATE; },
};
