// Protocollo messaggi tra content script, background e pagine.

(function (global) {
  'use strict';

  const MSG = {
    // Da content -> background
    AI_REQUEST: 'ai_request',                     // { action, payload }
    AI_REQUEST_STREAM_START: 'ai_request_stream', // streaming via port
    // Sintesi vocale via modello (TTS). Ritorna l'audio grezzo; se nessun
    // provider/modello TTS è disponibile torna { ok:false } e il chiamante
    // ripiega sulla voce del browser (Web Speech). { text, voice? }
    TTS_SYNTH: 'tts_synth',                        // → { ok, audioBase64, mimeType } | { ok:false, error }
    SAVE_PAGE: 'save_page',                       // { page }
    SAVE_LINK: 'save_link',                       // { url, title }
    GET_SETTINGS: 'get_settings',
    UPDATE_SETTINGS: 'update_settings',           // { settings }
    EXPORT_DATA: 'export_data',                   // → salva tutti i dati come .zip
    GET_HISTORY: 'get_history',
    APPEND_HISTORY: 'append_history',             // { entry }
    CLEAR_HISTORY: 'clear_history',
    GET_SAVED_PAGES: 'get_saved_pages',
    REMOVE_SAVED_PAGE: 'remove_saved_page',       // { id }
    CONSUME_SAVED_PAGE: 'consume_saved_page',     // { id }

    // §3.1/§3.3 — archivio tab chiuse (metadati). La scrittura avviene nel main
    // alla chiusura di una tab; queste servono alla pagina archivio per leggere/
    // rimuovere/svuotare.
    GET_ARCHIVED_TABS: 'get_archived_tabs',
    REMOVE_ARCHIVED_TAB: 'remove_archived_tab',   // { id }
    CLEAR_ARCHIVED_TABS: 'clear_archived_tabs',
    // Riapre una scheda archiviata come nuova tab, ripristinando lo scroll
    // registrato. { url, scrollPct? }
    REOPEN_ARCHIVED_TAB: 'reopen_archived_tab',
    // §3.2 — ricerca semantica nell'archivio (embedding Google). { query }
    SEARCH_ARCHIVED_TABS: 'search_archived_tabs',
    GET_COSTS: 'get_costs',
    CAPTURE_VISIBLE_TAB: 'capture_visible_tab',
    // Test provider: misura latenza al primo token e token al secondo
    // su un piccolo prompt fisso. Usato dalla pagina Opzioni.
    TEST_PROVIDER: 'test_provider',                 // { provider, apiKey, model? }
    TEST_DEFAULT_MODEL: 'test_default_model',       // { nickname } → testa con chiavi effettive

    OPEN_HOME: 'open_home',
    OPEN_HISTORY: 'open_history',
    OPEN_OPTIONS: 'open_options',
    OPEN_SPELLCHECK_PAGE: 'open_spellcheck_page',
    CLOSE_TAB: 'close_tab',
    CLOSE_ALL_TABS: 'close_all_tabs',               // chiude tutte le tab → 1 newtab
    OPEN_URL: 'open_url',                           // { url }
    QUIT_APP: 'quit_app',
    NAV_BACK: 'nav_back',
    NAV_FORWARD: 'nav_forward',
    NAV_RELOAD: 'nav_reload',
    NAV_STATE: 'nav_state',                         // → { ok, canBack, canFwd }
    TOGGLE_FULLSCREEN: 'toggle_fullscreen',
    EXIT_FULLSCREEN: 'exit_fullscreen',             // idempotente (Esc)
    FULLSCREEN_CHANGED: 'fullscreen_changed',       // broadcast → { fullscreen: bool }
    OPEN_NEW_TAB: 'open_new_tab',
    OPEN_INCOGNITO: 'open_incognito',               // apre una nuova finestra incognito
    // L'agente "Aiuto" aziona i comandi rapidi della barra di Filo (le icone in
    // alto): home, settings, apps, account, fullscreen, minimize. "close" è
    // ESCLUSO di proposito. Il main inoltra alla shell, che clicca il bottone
    // reale → si riusa tutto il comportamento esistente. → { ok } | { ok:false }
    SHELL_ACTION: 'shell_action',                   // { command }
    REPLACE_MISSPELLING: 'replace_misspelling',     // { suggestion }

    // "Vetro smerigliato" della tab attiva (spec §1.1): il content script
    // campiona il colore dominante della striscia in cima al viewport e lo manda
    // al main, che lo mette sullo snapshot così la shell tinge la tab attiva.
    TAB_DOMINANT_COLOR: 'tab_dominant_color',       // { color: 'rgb(r,g,b)' | null }

    // §1.2 — colore IDENTITÀ del sito (theme-color → manifest → favicon →
    // fallback), calcolato una volta dal content script e cachato per dominio dal
    // main; la shell lo applica attenuato alle tab INATTIVE.
    TAB_IDENTITY_COLOR: 'tab_identity_color',        // { color: 'rgb(r,g,b)' | null }

    // §2.1 — segnali di attività della tab riportati dal content script, per la
    // decisione di auto-archiviazione. Throttled. { lastInteractionAt?, scrollPct?, formDirty? }
    TAB_ACTIVITY: 'tab_activity',

    // §2.1 — pulizia/riordino su richiesta esplicita dell'utente (lo invoca
    // l'agente Filo dopo conferma). Esegue il triage su tutte le tab della finestra.
    RUN_TAB_TRIAGE: 'run_tab_triage',

    // Aiuto: invio percorso completato a fine sessione (passa per la pipeline
    // di sanitizzazione 2-LLM in pathsCollector.js prima di toccare Firestore).
    SAVE_PATH: 'save_path',                        // { path: { domain, initialUrl, sanitizedSteps, rawUserMessages, success } }

    // Invio feedback alpha → Firestore/Storage. Va instradato dal main process
    // perché le CSP delle pagine ospiti bloccano fetch diretti dal preload.
    SUBMIT_FEEDBACK: 'submit_feedback',           // { text, url, title, userAgent, clientId, images: [{dataUrl}] }
    // Entra/esce dalla "modalità annotazione" del box feedback: il box vive in
    // un content script sulla pagina (WebContentsView) e da lì non può oscurare
    // la barra in alto di Filo (renderizzata dalla shell). Questo messaggio fa
    // da ponte: il main lo inoltra alla shell, che mostra/nasconde un velo
    // d'ombra sopra la sua barra così TUTTO Filo entra in penombra. → { ok }
    FEEDBACK_ANNOTATE: 'feedback_annotate',       // { on: boolean }
    // Disegno sull'intera app: la barra in alto di Filo vive nella shell, non
    // nella pagina, quindi serve una tela di disegno anche lì. Questi messaggi
    // sincronizzano il disegno della barra (shell) con il box feedback (pagina):
    //   - FEEDBACK_CLEAR_DRAW: il box ha premuto "Cancella disegno" → il main
    //     dice alla shell di cancellare anche i tratti sulla barra in alto.
    //   - FEEDBACK_DRAW_STATE: broadcast main→pagina, { topbar: bool } → il box
    //     sa se c'è un disegno sulla barra (per mostrare "Cancella disegno" e
    //     allegare lo screenshot anche quando si è disegnato SOLO sulla barra).
    //   - CAPTURE_FEEDBACK_TOPBAR: il box chiede lo scatto annotato della sola
    //     barra in alto, da impilare sopra lo screenshot della pagina.
    FEEDBACK_CLEAR_DRAW: 'feedback_clear_draw',   // { } → { ok }
    FEEDBACK_DRAW_STATE: 'feedback_draw_state',   // broadcast → { topbar: bool }
    CAPTURE_FEEDBACK_TOPBAR: 'capture_feedback_topbar', // → { ok, dataUrl?, barHeight? }
    // Triage admin di un feedback (cambio stato/note/priorità). Instradato dal
    // main, che allega il Firebase ID token come Bearer e RIFIUTA se l'utente
    // loggato non è admin. → { ok } | { ok:false, error }
    FEEDBACK_UPDATE: 'feedback_update',           // { id, status?, notes?, priority? }
    // Config "modelli predefiniti" condivisa (admin-only, propaga a tutti via
    // Firestore). GET ritorna la config senza esporre le chiavi vere (solo se
    // presenti); UPDATE scrive provider/models/modelRegistry/apiKeys.
    DEFAULTS_GET: 'defaults_get',                  // → { ok, config } | { ok:false, error }
    DEFAULTS_UPDATE: 'defaults_update',            // { config } → { ok, config } | { ok:false, error }
    WEB_SEARCH: 'web_search',                      // { query } → { ok, results: [{title,url,snippet}], provider }

    // === Rilevamento siti pericolosi (src/main/services/safebrowse/) ===
    // Il content script chiede il verdetto per la URL corrente (+ indizi di
    // pagina: presenza campo password/pagamento). Il main risponde col livello
    // e un messaggio specifico. → { ok, level:'safe'|'sospetto'|'pericoloso',
    // message:{title,body}|null, registrable }
    SAFEBROWSE_GET: 'safebrowse_get',              // { url, hasPassword?, hasPayment? }
    // L'utente ha scritto "confermo" sull'interstitial "pericoloso": registra un
    // bypass per (tab, dominio) così la pagina non viene più coperta. → { ok }
    SAFEBROWSE_PROCEED: 'safebrowse_proceed',      // { url }
    // L'utente ha chiuso con "ok" il banner "sospetto": non riproporlo per
    // questo dominio nel tab. → { ok }
    SAFEBROWSE_DISMISS: 'safebrowse_dismiss',      // { url }
    // Broadcast main→content: il verdetto per la URL è cambiato (navigazione o
    // arricchimento asincrono RDAP/GSB/sandbox). Il content (ri)disegna l'avviso.
    SAFEBROWSE_UPDATE: 'safebrowse_update',         // → { url, level, message }

    // === Gestione cookie / consenso (src/content/cookies.js) ===
    // Il content script chiede la modalità corrente per decidere se rifiutare i
    // banner CMP e riscrivere gli embed YouTube in nocookie. → { mode }
    COOKIES_CONFIG: 'cookies_config',               // → { mode: 'manual'|'default'|'privacy' }
    // Broadcast main→content quando la modalità cambia (UPDATE_SETTINGS): il
    // content (dis)attiva il rifiuto CMP e la riscrittura embed senza reload.
    COOKIES_CONFIG_UPDATE: 'cookies_config_update', // → { mode }

    // === Account "Accedi con Google" (vedi src/main/auth/) ===
    // Login/logout/stato. Tutto vive nel main process: i token non sono mai
    // esposti alle pagine. La risposta porta solo il profilo pubblico.
    AUTH_SIGNIN: 'auth_signin',                    // → { ok, profile: {email,name,picture} | null }
    AUTH_SIGNOUT: 'auth_signout',                  // → { ok }
    AUTH_STATUS: 'auth_status',                    // → { ok, signedIn, profile|null }
    AUTH_CHANGED: 'auth_changed',                  // broadcast → { signedIn, profile|null }

    // Clipboard history (per il menu "Incolla")
    GET_CLIPBOARD_HISTORY: 'get_clipboard_history',
    PUSH_CLIPBOARD_ENTRY: 'push_clipboard_entry',     // { entry }
    UPDATE_CLIPBOARD_DESCRIPTION: 'update_clipboard_description', // { dataUrl, description }
    CLEAR_CLIPBOARD_HISTORY: 'clear_clipboard_history',

    // Categorie (Fase 2)
    GET_CATEGORIES: 'get_categories',
    RENAME_CATEGORY: 'rename_category',         // { id, name }
    DELETE_CATEGORY: 'delete_category',         // { id }
    MERGE_CATEGORIES: 'merge_categories',       // { fromId, toId }
    MOVE_PAGE_CATEGORY: 'move_page_category',   // { pageId, categoryId }

    // === Filo dashboard ===
    // Filo Chat: invio messaggio utente all'agente conversazionale
    // { userMessage, threadHistory: [{role, text, actions?}] }
    // Risposta: { ok, text, actions: [...], model, costEur }
    FILO_CHAT: 'filo_chat',
    // Filo State: assembla stato programmatico (tab aperte, tempo, processi).
    // Risposta: { ok, state: {...}, stateText: "..." }
    FILO_GET_STATE: 'filo_get_state',
    // Genera dashboard (messaggio centro + suggerimenti). Usa cache con cooldown.
    // { force?: boolean }
    // Risposta: { ok, message, suggestions, cached, ts }
    FILO_GENERATE_DASHBOARD: 'filo_generate_dashboard',
    // CRUD memoria/contenuti dashboard
    FILO_GET_MEMORY: 'filo_get_memory',
    FILO_GET_NOTES: 'filo_get_notes',
    FILO_ADD_NOTE: 'filo_add_note',                // { text, context? }
    FILO_DELETE_NOTE: 'filo_delete_note',          // { id }
    FILO_GET_TIMERS: 'filo_get_timers',
    FILO_ADD_TIMER: 'filo_add_timer',              // { label, seconds }
    FILO_DELETE_TIMER: 'filo_delete_timer',        // { id }
    FILO_GET_NOTIFICATIONS: 'filo_get_notifications',
    FILO_DISMISS_NOTIFICATION: 'filo_dismiss_notification', // { id }

    // Da background -> content (broadcast)
    SETTINGS_UPDATED: 'settings_updated',
    SHORTCUT_TRIGGERED: 'shortcut_triggered',     // { command }
    // Broadcast da background -> dashboard: lo stato live è cambiato
    // (nuovo timer, notifica, ecc.) e va re-renderizzato.
    FILO_LIVE_UPDATED: 'filo_live_updated',
  };

  // Port-based streaming
  const PORTS = {
    AI_STREAM: 'ai_stream',
  };

  global.SN_MSG = { MSG, PORTS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
