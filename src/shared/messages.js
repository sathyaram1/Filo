// Protocollo messaggi tra content script, background e pagine.

(function (global) {
  'use strict';

  const MSG = {
    // Da content -> background
    AI_REQUEST: 'ai_request',                     // { action, payload }
    AI_REQUEST_STREAM_START: 'ai_request_stream', // streaming via port
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
    GET_COSTS: 'get_costs',
    CAPTURE_VISIBLE_TAB: 'capture_visible_tab',
    // Test provider: misura latenza al primo token e token al secondo
    // su un piccolo prompt fisso. Usato dalla pagina Opzioni.
    TEST_PROVIDER: 'test_provider',                 // { provider, apiKey, model? }

    OPEN_HOME: 'open_home',
    OPEN_HISTORY: 'open_history',
    OPEN_OPTIONS: 'open_options',
    OPEN_SPELLCHECK_PAGE: 'open_spellcheck_page',
    CLOSE_TAB: 'close_tab',
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
    REPLACE_MISSPELLING: 'replace_misspelling',     // { suggestion }

    // Aiuto: invio percorso completato a fine sessione (passa per la pipeline
    // di sanitizzazione 2-LLM in pathsCollector.js prima di toccare Firestore).
    SAVE_PATH: 'save_path',                        // { path: { domain, initialUrl, sanitizedSteps, rawUserMessages, success } }

    // Invio feedback alpha → Firestore/Storage. Va instradato dal main process
    // perché le CSP delle pagine ospiti bloccano fetch diretti dal preload.
    SUBMIT_FEEDBACK: 'submit_feedback',           // { text, url, title, userAgent, clientId, images: [{dataUrl}] }
    // Triage admin di un feedback (cambio stato/note/priorità). Instradato dal
    // main, che allega il Firebase ID token come Bearer e RIFIUTA se l'utente
    // loggato non è admin. → { ok } | { ok:false, error }
    FEEDBACK_UPDATE: 'feedback_update',           // { id, status?, notes?, priority? }
    // Config "modelli predefiniti" condivisa (admin-only, propaga a tutti via
    // Firestore). GET ritorna la config senza esporre le chiavi vere (solo se
    // presenti); UPDATE scrive provider/geminiDirect/models/modelRegistry/apiKeys.
    DEFAULTS_GET: 'defaults_get',                  // → { ok, config } | { ok:false, error }
    DEFAULTS_UPDATE: 'defaults_update',            // { config } → { ok, config } | { ok:false, error }
    WEB_SEARCH: 'web_search',                      // { query } → { ok, results: [{title,url,snippet}], provider }

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
