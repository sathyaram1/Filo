// Importa i moduli background e shared nell'ordine corretto.
// Lo shim chrome.* dev'essere già caricato prima di questo file (lo fa main.js).

const path = require('node:path');

const SHARED = path.join(__dirname, '..', '..', 'shared');
const SVC = __dirname;

require(path.join(SHARED, 'constants.js'));
require(path.join(SHARED, 'filoUi.js'));
require(path.join(SHARED, 'messages.js'));
require(path.join(SHARED, 'i18n.js'));
// Serve a chiunque disegni un'etichetta di scorciatoia, quindi sta in alto.
require(path.join(SHARED, 'tasti.js'));
require(path.join(SHARED, 'campoTesto.js'));
require(path.join(SHARED, 'timeFormat.js'));
require(path.join(SHARED, 'modelCaps.js'));
// Va PRIMA dell'editor delle catene, che da qui prende l'elenco delle funzioni impostabili.
require(path.join(SHARED, 'modelUsage.js'));
// Si può caricare qui perché tocca il DOM solo nelle funzioni di rendering, mai al
// caricamento.
require(path.join(SHARED, 'modelChainEditor.js'));
require(path.join(SHARED, 'storage.js'));
require(path.join(SHARED, 'themeTokens.js'));
require(path.join(SHARED, 'tabColor.js'));
require(path.join(SHARED, 'tabTriage.js'));
require(path.join(SHARED, 'downloadTabs.js'));
// #585 — va PRIMA di paths.js (che la usa in scrittura) e di handlers.js (che la usa in lettura).
require(path.join(SHARED, 'pathsSafety.js'));
require(path.join(SHARED, 'paths.js'));
// Va PRIMA di filoMemory, che gli passa lo stato letto dallo storage.
require(path.join(SHARED, 'onboarding.js'));
require(path.join(SHARED, 'filoMemory.js'));
require(path.join(SHARED, 'filoState.js'));
require(path.join(SHARED, 'dashboardRefresh.js'));
require(path.join(SHARED, 'feedback.js'));
require(path.join(SHARED, 'feedbackLive.js'));
require(path.join(SHARED, 'feedbackTransitions.js'));
require(path.join(SHARED, 'verifierRound.js'));
require(path.join(SHARED, 'feedbackStatus.js')); // prima di manageReview: vocabolario stati (consuma i dati qui sopra)
require(path.join(SHARED, 'manageReview.js'));
require(path.join(SHARED, 'feedbackClientIdHash.js')); // prima di feedbackPublicView: l'impronta della scheda (#583)
require(path.join(SHARED, 'feedbackPublicView.js')); // dopo manageReview: lo usa
require(path.join(SHARED, 'preferences.js'));
require(path.join(SHARED, 'cmdClassify.js'));
require(path.join(SHARED, 'urlNav.js'));
require(path.join(SHARED, 'urlExfil.js'));
require(path.join(SHARED, 'netError.js'));
require(path.join(SHARED, 'chatErrors.js'));
require(path.join(SHARED, 'wallet.js'));
require(path.join(SHARED, 'streamingJson.js'));
require(path.join(SHARED, 'actionLevels.js'));
require(path.join(SHARED, 'actionTools.js'));
require(path.join(SHARED, 'pageRestyle.js'));
require(path.join(SHARED, 'ttsChunk.js'));
require(path.join(SHARED, 'ttsCache.js'));
require(path.join(SHARED, 'ttsVoices.js'));
require(path.join(SHARED, 'dictationSegmenter.js'));
// Solo nei test: l'app non ha modelli scritti nel codice.
if (process.env.NODE_ENV === 'test') {
  try { require(path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'testModels.js')); } catch (e) { console.warn('[loader] testModels non caricato:', e.message); }
}
require(path.join(SHARED, 'patchNotes.js'));
require(path.join(SHARED, 'capabilities.js'));
// Il gemello transparencyUi.js NON si carica qui: è codice di pagina e tocca il DOM.
require(path.join(SHARED, 'transparency.js'));
require(path.join(SHARED, 'autoFeedback.js'));  // F4 — dipende da capabilities
require(path.join(SHARED, 'feedbackPublicKey.js'));
require(path.join(SHARED, 'feedbackCrypto.js'));
require(path.join(SHARED, 'feedbackImage.js'));
require(path.join(SHARED, 'userCredibility.js'));
require(path.join(SHARED, 'spellLanguages.js'));
require(path.join(SHARED, 'decks.js'));
require(path.join(SHARED, 'deckStats.js'));    // dipende da SN_DECKS (tipoOf)
require(path.join(SHARED, 'scryfallQuery.js'));
require(path.join(SHARED, 'deckOpinions.js'));
require(path.join(SHARED, 'deckImportExport.js'));
require(path.join(SHARED, 'editorStore.js'));
require(path.join(SHARED, 'editorVersions.js'));
require(path.join(SHARED, 'editorNotes.js')); // dipende dai due sopra
require(path.join(SHARED, 'editorSummary.js'));
require(path.join(SVC, 'providers', 'openrouter.js'));
require(path.join(SVC, 'providers', 'index.js'));
require(path.join(SVC, 'feedbackOutbox.js')); // dipende da SN_FEEDBACK e SN_STORAGE
require(path.join(SVC, 'creditStore.js'));
require(path.join(SVC, 'costTracker.js'));
require(path.join(SVC, 'savedPages.js'));
require(path.join(SVC, 'historyStore.js'));
require(path.join(SVC, 'archivedTabs.js'));
require(path.join(SVC, 'deckStore.js'));   // dipende da SN_DECKS (shared/decks.js)
require(path.join(SVC, 'scryfall.js'));    // dipende da SN_SCRYFALL_Q (shared/scryfallQuery.js)
require(path.join(SVC, 'deckOpinions.js')); // dipende da SN_DECK_OPINIONS + SN_SCRYFALL_Q
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
  // Per chi vuole un riferimento diretto invece di pescare da globalThis.
  get SN_CONST() { return globalThis.SN_CONST; },
  get SN_MSG() { return globalThis.SN_MSG; },
  get SN_STORAGE() { return globalThis.SN_STORAGE; },
  get SN_PROVIDERS() { return globalThis.SN_PROVIDERS; },
  get SN_COSTS() { return globalThis.SN_COSTS; },
  get SN_CREDITS() { return globalThis.SN_CREDITS; },
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
  get SN_MANAGE_REVIEW() { return globalThis.SN_MANAGE_REVIEW; },
};
