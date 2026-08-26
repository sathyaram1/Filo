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
// Il marchio della UI di Filo dentro le pagine web: serve ai content script,
// ma sta fra i moduli condivisi e segue l'ordine di tutti gli altri.
require(path.join(SHARED, 'filoUi.js'));
require(path.join(SHARED, 'messages.js'));
require(path.join(SHARED, 'i18n.js'));
require(path.join(SHARED, 'timeFormat.js')); // formattazione durate/countdown (#323)
require(path.join(SHARED, 'modelCaps.js'));
// Censimento dei punti in cui Filo usa un modello: è la sorgente di verità
// dell'elenco di funzioni impostabili, quindi va caricato PRIMA dell'editor
// delle catene (che da lì prende l'elenco).
require(path.join(SHARED, 'modelUsage.js'));
// Elenco delle funzioni impostabili + le loro etichette: serve al main per
// chiamare una funzione scoperta con lo STESSO nome che l'utente legge nelle
// Opzioni (il messaggio d'errore gli dice di andare lì). Il modulo tocca il DOM
// solo dentro le funzioni di rendering, mai al caricamento.
require(path.join(SHARED, 'modelChainEditor.js'));
require(path.join(SHARED, 'storage.js'));
require(path.join(SHARED, 'themeTokens.js'));
require(path.join(SHARED, 'tabColor.js'));
require(path.join(SHARED, 'tabTriage.js')); // §2.1 — candidati/dedup riordino schede (logica pura)
require(path.join(SHARED, 'downloadTabs.js')); // #412/#441 — schede usa e getta dei download (logica pura)
require(path.join(SHARED, 'paths.js'));
require(path.join(SHARED, 'filoMemory.js'));
require(path.join(SHARED, 'filoState.js'));
require(path.join(SHARED, 'dashboardRefresh.js'));
require(path.join(SHARED, 'feedback.js'));
require(path.join(SHARED, 'feedbackTransitions.js')); // DATI della macchina a stati (fonte unica, SPEC-RIDISEGNO-MAX.md §7)
require(path.join(SHARED, 'feedbackStatus.js')); // prima di manageReview: vocabolario stati (consuma i dati qui sopra)
require(path.join(SHARED, 'manageReview.js'));
require(path.join(SHARED, 'preferences.js'));
require(path.join(SHARED, 'cmdClassify.js'));
require(path.join(SHARED, 'urlNav.js'));  // #398 — testo→indirizzo (normalizeUrl/looksLikeAddress), condiviso main+dashboard
require(path.join(SHARED, 'urlExfil.js'));
require(path.join(SHARED, 'netError.js'));  // #327 — pagina d'errore di rete (tabs.js + filo://error)
require(path.join(SHARED, 'chatErrors.js'));  // #360 — errore tecnico → frase per l'utente in chat
require(path.join(SHARED, 'streamingJson.js'));  // #420 — estrae il campo "text" mentre il JSON di risposta arriva in streaming
require(path.join(SHARED, 'actionLevels.js'));
require(path.join(SHARED, 'pageRestyle.js'));
require(path.join(SHARED, 'ttsChunk.js'));
require(path.join(SHARED, 'ttsCache.js'));
require(path.join(SHARED, 'patchNotes.js'));
require(path.join(SHARED, 'capabilities.js'));
// Documenti di trasparenza (generati da transparency/*.md): servono all'agente
// per rispondere quando l'utente chiede conto di una scelta. Il gemello
// transparencyUi.js NON si carica qui: è codice di pagina, tocca il DOM.
require(path.join(SHARED, 'transparency.js'));
require(path.join(SHARED, 'autoFeedback.js'));  // F4 — dipende da capabilities
require(path.join(SHARED, 'feedbackPublicKey.js'));
require(path.join(SHARED, 'feedbackCrypto.js'));
require(path.join(SHARED, 'feedbackImage.js')); // S1.2: sniff MIME + data URL per immagini decifrate
require(path.join(SHARED, 'feedbackClientIdHash.js')); // S1.F2.2: hash deterministico clientId
require(path.join(SHARED, 'userCredibility.js'));
require(path.join(SHARED, 'spellLanguages.js'));
require(path.join(SHARED, 'decks.js'));
require(path.join(SHARED, 'deckStats.js'));    // dipende da SN_DECKS (tipoOf)
require(path.join(SHARED, 'scryfallQuery.js'));
require(path.join(SHARED, 'deckOpinions.js')); // pareri/auto-tag §6-§7 (logica pura)
require(path.join(SHARED, 'deckImportExport.js')); // parser rigido testo↔carte §11 (logica pura)
require(path.join(SHARED, 'editorStore.js'));   // collezione file editor (logica pura)
require(path.join(SHARED, 'editorVersions.js')); // storico/punti di ripristino (logica pura)
require(path.join(SHARED, 'editorNotes.js'));   // appunti di Filo dentro i file editor (dipende dai due sopra)
require(path.join(SHARED, 'editorSummary.js')); // riassunto per file + estrazione testo (logica pura, #379.5)
require(path.join(SVC, 'providers', 'openrouter.js'));
require(path.join(SVC, 'providers', 'gemini.js'));
require(path.join(SVC, 'providers', 'index.js'));
require(path.join(SVC, 'feedbackOutbox.js')); // #341 — coda invio feedback offline (dipende da SN_FEEDBACK + SN_STORAGE)
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
  // Esponiamo gli oggetti popolati su globalThis per chi vuole un riferimento
  // diretto invece di pescare da globalThis.
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
