// Importa i moduli background e shared nell'ordine corretto.
// Lo shim chrome.* dev'essere già caricato prima di questo file (lo fa main.js).

const path = require('node:path');

const SHARED = path.join(__dirname, '..', '..', 'shared');
const SVC = __dirname;

require(path.join(SHARED, 'constants.js'));
// #593 — la porta unica da cui passa il contenuto esterno (pagina, ricerca
// web, percorsi di altri) prima di entrare in un prompt. Va PRIMA di chi la
// usa: pathsSafety in lettura, i prompt di constants.js a ogni chiamata.
require(path.join(SHARED, 'contenutoEsterno.js'));
// Il marchio della UI di Filo dentro le pagine web: serve ai content script,
// ma sta fra i moduli condivisi e segue l'ordine di tutti gli altri.
require(path.join(SHARED, 'filoUi.js'));
require(path.join(SHARED, 'messages.js'));
require(path.join(SHARED, 'i18n.js'));
// Cronologia appunti: la chiave di una voce e i testi delle sue azioni, uguali
// per il menu "Incolla", la pagina della Sicurezza e chi la tiene su disco (#256).
require(path.join(SHARED, 'clipboardHistory.js'));
// Come si CHIAMA una scorciatoia sulla macchina di chi legge (Ctrl o Cmd):
// serve a chiunque disegni un'etichetta, quindi sta in alto.
require(path.join(SHARED, 'tasti.js'));
// Dove sta ogni icona globale (riga, «Altro…», barra laterale): la legge la barra, la scrive il main.
require(path.join(SHARED, 'disposizioneIcone.js'));
// "Il cursore è in un campo di testo?": la regola che decide se Ctrl/Cmd+Z
// annulla o torna indietro. La barra dei menu la manda a valutare nelle pagine
// (src/main/menu.js), i content script la chiamano direttamente.
require(path.join(SHARED, 'campoTesto.js'));
require(path.join(SHARED, 'timeFormat.js'));
require(path.join(SHARED, 'modelCaps.js'));
// Va PRIMA dell'editor delle catene, che da qui prende l'elenco delle funzioni impostabili.
require(path.join(SHARED, 'modelUsage.js'));
require(path.join(SHARED, 'contatoriGiornalieri.js')); // #969 — i contatori giornalieri: elenchi chiusi e forma del documento
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
require(path.join(SHARED, 'stessoSito.js')); // #876 — «stesso sito» e Public Suffix List: prima di eseguibili e preferences
require(path.join(SHARED, 'dominiGoogle.js')); // #1123 — i domini di Google sono un accesso solo (dopo stessoSito)
require(path.join(SHARED, 'nomiSito.js')); // #590 — quando un dominio scritto a mano è valido, e come si legge (prima di eseguibili)
require(path.join(SHARED, 'pagineDelicate.js')); // #1004 — quali pagine non mandano testo ai modelli nei lavori automatici
require(path.join(SHARED, 'eseguibili.js')); // #588 — quali file il sistema ESEGUE (logica pura)
require(path.join(SHARED, 'nomiFile.js')); // #950 — nome sensato ai file dell'utente (logica pura)
// #585 — pulizia e incapsulamento dei percorsi condivisi. Va PRIMA di paths.js
// (che la usa in scrittura) e di handlers.js (che la usa in lettura).
require(path.join(SHARED, 'pathsSafety.js'));
require(path.join(SHARED, 'paths.js'));
// Va PRIMA di filoMemory, che gli passa lo stato letto dallo storage.
require(path.join(SHARED, 'onboarding.js'));
require(path.join(SHARED, 'quaderno.js')); // #872 — fonti delle memorie e righe tolte (logica pura), prima di filoMemory
require(path.join(SHARED, 'filoMemory.js'));
// Ora, batteria, rete e Bluetooth a parole: lo legge filoState per lo STATO, e la home per le sue voci.
require(path.join(SHARED, 'sistema.js'));
require(path.join(SHARED, 'filoState.js'));
require(path.join(SHARED, 'carteHome.js')); // #870 — carte della home: catalogo e mosse (logica pura)
// #525 — archivio delle chat con Filo: titoli, tipi, ricerca (logica pura).
// Va PRIMA di services/filoChats.js, che ci si appoggia per scrivere.
require(path.join(SHARED, 'chatArchive.js'));
require(path.join(SHARED, 'filoEventi.js'));  // #866 — forma degli eventi del filo: prima di services/ilFilo.js
require(path.join(SHARED, 'filoAccaduti.js'));  // #1561 — cosa di azioni, sistema ed editor entra nel filo (logica pura)
require(path.join(SHARED, 'filoApp.js'));  // #974 — le chat delle app come righe ripiegate del filo (logica pura)
require(path.join(SHARED, 'filoCoda.js'));  // #869 — la home come coda del filo: righe, pezzi, ricerca (logica pura)
require(path.join(SHARED, 'filoContesto.js'));  // #868 — il tratto del filo che la chat ha davanti (logica pura)
require(path.join(SHARED, 'lunghezzaRisposte.js'));  // #1097.3 — il tetto delle risposte dei modelli per famiglia di funzioni
require(path.join(SHARED, 'dashboardRefresh.js'));
require(path.join(SHARED, 'feedback.js'));
require(path.join(SHARED, 'feedbackMine.js')); // #678 — il registro dei feedback mandati da questa installazione
require(path.join(SHARED, 'feedbackLive.js')); // confronto versioni + fusione per l'aggiornamento continuo della dashboard
require(path.join(SHARED, 'feedbackTransitions.js')); // DATI della macchina a stati (fonte unica, SPEC-RIDISEGNO-MAX.md §7)
require(path.join(SHARED, 'verifierRound.js')); // regole del giro di verifica (fonte unica, feedback #561)
require(path.join(SHARED, 'domande.js')); // #1149 — azioni delle domande all'owner come dati (fonte unica, incorporata dal server)
require(path.join(SHARED, 'mittenti.js')); // #1162 — classe del mittente, solo statistica (fonte unica, incorporata dal server)
require(path.join(SHARED, 'feedbackStatus.js')); // prima di manageReview: vocabolario stati (consuma i dati qui sopra)
require(path.join(SHARED, 'feedbackAttese.js')); // #903 — «aspetta #N»: prima di manageReview, che ne fa una sezione
require(path.join(SHARED, 'manageReview.js'));
require(path.join(SHARED, 'manageSearch.js')); // #1118 — la ricerca fra i feedback: il classificatore gira nel main
require(path.join(SHARED, 'feedbackClientIdHash.js')); // prima di feedbackPublicView: l'impronta della scheda (#583)
require(path.join(SHARED, 'feedbackPublicView.js')); // dopo manageReview: lo usa
require(path.join(SHARED, 'preferences.js'));
require(path.join(SHARED, 'calendarEvent.js')); // evento proposto in chat → .ics per il calendario del computer
require(path.join(SHARED, 'cmdClassify.js'));
require(path.join(SHARED, 'urlNav.js'));  // #398 — testo→indirizzo (normalizeUrl/looksLikeAddress), condiviso main+dashboard
require(path.join(SHARED, 'guardianoStatico.js')); // #810 — forme dei segreti: prima della porta delle uscite
require(path.join(SHARED, 'campiSegreti.js')); // #810.7 — campi che non vanno al modello: il main li cerca anche nei riquadri
require(path.join(SHARED, 'urlExfil.js'));
require(path.join(SHARED, 'sitiComuni.js')); // #553 — gli indirizzi che il modello può scrivere a memoria
require(path.join(SHARED, 'netError.js'));  // #327 — pagina d'errore di rete (tabs.js + filo://error)
require(path.join(SHARED, 'chatErrors.js'));  // #360 — errore tecnico → frase per l'utente in chat
require(path.join(SHARED, 'codaAdattiva.js'));  // #1118 — lavori in parallelo che rallentano ai 429: prima del cancello dei modelli
require(path.join(SHARED, 'wallet.js'));      // #598 — crediti sul server: righe del registro, 402, messaggi
require(path.join(SHARED, 'stimaCosto.js'));  // #819 — quanto costa un uso tipico di una funzione con un modello
require(path.join(SHARED, 'creditiAvviso.js')); // #818 — proiezione dei crediti, soglie e rimedi
// #652 — una manopola numerica: controllo del numero e frase di rifiuto. La
// parte pura serve anche al main, che rifiuta gli stessi valori della pagina.
require(path.join(SHARED, 'campoNumero.js'));
// Come partono le sessioni delle routine: stesse regole in pagina e nel main.
require(path.join(SHARED, 'routineSessioni.js'));
require(path.join(SHARED, 'routineCrediti.js'));  // #1356 — i numeri dell'owner sui crediti: stesse regole in pagina e nel main
require(path.join(SHARED, 'routineModelli.js'));  // #1193 — modello e sforzo per fase: stesse regole in pagina e nel main
require(path.join(SHARED, 'calcMarkers.js'));  // #724.1 — calcolatrice dei marker [[calc:]]: la chat li risolve nel main
// #711 — cosa dichiara un'immagine sulla propria origine, letto dai suoi byte.
// Usa node:crypto per verificare le firme: vive solo dove Node c'è (main).
require(path.join(SHARED, 'provenienzaImmagine.js'));
require(path.join(SHARED, 'marchiInvisibili.js'));  // #889 — i marchi aperti nei pixel: li legge il thread di provenienzaIsolata
require(path.join(SHARED, 'streamingJson.js'));  // #420 — estrae il campo "text" mentre il JSON di risposta arriva in streaming
// #530 — la regola «Filo può fare X?» come dati: prima del registro, che le passa gli ingressi.
require(path.join(SHARED, 'autonomia.js'));
require(path.join(SHARED, 'actionLevels.js'));
require(path.join(SHARED, 'azioniPerModello.js'));  // come un'azione torna al modello: «voce N» e testi salvati recintati (#592.4)
require(path.join(SHARED, 'actionTools.js'));  // le azioni come strumenti del modello (tool calling nativo)
require(path.join(SHARED, 'pageRestyle.js'));
require(path.join(SHARED, 'zoomPagina.js'));  // zoom della pagina: passo, limiti, livello↔percentuale (una regola sola per tasti e chat)
require(path.join(SHARED, 'cambi.js'));  // #867 — i cambi di stato come eventi del filo: frasi, confronto, annullo (logica pura)
require(path.join(SHARED, 'vociImpostazioni.js'));  // #949 — le voci delle pagine delle impostazioni: cosa legge e cambia la chat
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
require(path.join(SHARED, 'serviziEsterni.js'));  // #849 — i servizi esterni che Filo contatta, come dati
// Documenti di trasparenza (generati da transparency/*.md): servono all'agente
// per rispondere quando l'utente chiede conto di una scelta. Il gemello
// transparencyUi.js NON si carica qui: è codice di pagina, tocca il DOM.
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
require(path.join(SHARED, 'deckOpinions.js')); // pareri/auto-tag §6-§7 (logica pura)
require(path.join(SHARED, 'deckImportExport.js')); // parser rigido testo↔carte §11 (logica pura)
require(path.join(SHARED, 'deckChat.js'));     // chat per mazzo §3.2: cosa si conserva (logica pura)
require(path.join(SHARED, 'editorStore.js'));   // collezione file editor (logica pura)
require(path.join(SHARED, 'editorVersions.js')); // storico/punti di ripristino (logica pura)
require(path.join(SHARED, 'editorNotes.js'));   // appunti di Filo dentro i file editor (dipende dai due sopra)
require(path.join(SHARED, 'editorSummary.js')); // riassunto per file + estrazione testo (logica pura, #379.5)
require(path.join(SVC, 'providers', 'openrouter.js'));
require(path.join(SVC, 'providers', 'index.js'));
require(path.join(SVC, 'modelGate.js')); // l'unica strada verso i fornitori: limite, costo, chi ha servito (#591)
require(path.join(SVC, 'feedbackOutbox.js')); // #341 — coda invio feedback offline (dipende da SN_FEEDBACK + SN_STORAGE)
require(path.join(SVC, 'creditStore.js'));
require(path.join(SVC, 'costTracker.js'));
require(path.join(SVC, 'savedPages.js'));
require(path.join(SVC, 'historyStore.js'));
require(path.join(SVC, 'archivedTabs.js'));
require(path.join(SVC, 'segnalazioniMie.js')); // #986 — la copia locale delle segnalazioni mandate da qui
require(path.join(SVC, 'ilFilo.js'));     // #866 — la linea del tempo: l'unico che legge e scrive il suo file
require(path.join(SVC, 'filoChats.js'));  // #525 — dipende da SN_CHAT_ARCHIVE e SN_IL_FILO
require(path.join(SVC, 'conversazioniApp.js'));  // #974 — dipende da SN_FILO_APP, SN_IL_FILO e SN_FILO_CHATS
require(path.join(SVC, 'deckStore.js'));   // dipende da SN_DECKS (shared/decks.js)
require(path.join(SVC, 'scryfall.js'));    // dipende da SN_SCRYFALL_Q (shared/scryfallQuery.js)
require(path.join(SVC, 'deckOpinions.js')); // dipende da SN_DECK_OPINIONS + SN_SCRYFALL_Q
require(path.join(SVC, 'deckChats.js'));   // dipende da SN_DECK_CHAT + SN_DECK_STORE
require(path.join(SVC, 'aiCache.js'));
require(path.join(SVC, 'categorizer.js'));
require(path.join(SVC, 'pathsCollector.js'));
require(path.join(SVC, 'llmsTxt.js'));
require(path.join(SVC, 'webSearch.js'));
require(path.join(SVC, 'fxRates.js'));
require(path.join(SVC, 'statoSistema.js')); // batteria, rete, Bluetooth del computer: SN_SISTEMA_MAIN per lo STATO
require(path.join(SVC, 'comandiSistema.js')); // #874 volume, Bluetooth e Wi-Fi a comando: SN_COMANDI_SISTEMA
require(path.join(SVC, 'safebrowse', 'index.js'));
require(path.join(SVC, 'pagineDelicate.js')); // #1004 — i siti che hanno mostrato un campo password o carta, per la sessione
require(path.join(SVC, 'geoBlock.js'));
require(path.join(SVC, 'geoBlockClassifier.js'));
require(path.join(SVC, 'geoBlockRules.js'));

module.exports = {
  // Per chi vuole un riferimento diretto invece di pescare da globalThis.
  get SN_CONST() { return globalThis.SN_CONST; },
  get SN_MSG() { return globalThis.SN_MSG; },
  get SN_STORAGE() { return globalThis.SN_STORAGE; },
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
