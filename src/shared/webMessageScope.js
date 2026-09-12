// Che cosa può CHIEDERE al cuore di Filo una pagina web.
//
// Il canale che porta i messaggi al main è uno solo, e lo usano sia le pagine
// interne di Filo sia il codice che Filo carica dentro ogni pagina visitata.
// Fin qui ogni messaggio era ammesso da entrambe le parti, e i gate stavano
// sui singoli handler: chi ne aggiungeva uno nuovo doveva ricordarsi di
// metterlo: quelli dimenticati consegnavano a un sito la memoria che Filo si è
// costruito sull'utente, l'elenco delle pagine messe da parte, lo stato della
// home (messaggio del giorno, suggerimenti, saldo dei crediti, schede aperte) e
// l'uscita dall'account.
//
// Qui c'è la stessa forma scelta per le impostazioni (src/shared/settingsScope.js):
// una lista di ciò che PASSA, non di ciò che si toglie. Il messaggio nuovo che
// qualcuno aggiunge domani resta fuori da solo, e per restare dentro deve
// essere una cosa che il codice dentro le pagine usa davvero.
//
// Il confine è scritto AL CONTRARIO di come sembrerebbe naturale: interne sono
// le sole pagine `filo://` e le chiamate che il cuore di Filo fa a se stesso
// (nessuna origine e nessuna pagina dietro). Tutto il resto è una pagina.
// Cercare invece «comincia per http» lasciava fuori mezzo mondo: una pagina di
// un sito si compone da sé una pagina e ci si porta sopra (l'indirizzo comincia
// per `blob:`), oppure apre una scheda vuota (`about:blank`), e in tutti e due
// i casi resta suo codice con il nostro montato sopra — ma l'indirizzo non
// comincia più per http e il confine si spegneva del tutto.
//
// Chi rifiuta lo DICE nel log: un messaggio necessario che finisse fuori lista
// spegnerebbe una funzione dentro le pagine, e un taglio silenzioso lo si
// scopre settimane dopo. La sentinella in tests/unit/webMessageScope.test.mjs
// legge src/content/*.js, i moduli condivisi che page-preload.js carica lì
// accanto e il preload stesso, e diventa rossa se uno di loro manda un
// messaggio che questa lista non ammette.
(function (global) {
  'use strict';

  // I messaggi che il codice dentro le pagine web manda DAVVERO. Ricavati da
  // src/content/, dai moduli condivisi caricati lì e dallo shim chrome.* del
  // preload; la sentinella tiene la lista allineata.
  const WEB_MESSAGE_TYPES = Object.freeze([
    // shim chrome.storage / chrome.tabs (page-preload.js). I poteri grossi
    // (svuotare tutto, scrivere le impostazioni) hanno il loro gate d'origine.
    '_storage:get', '_storage:set', '_storage:remove', '_storage:clear',
    '_tabs:create', '_tabs:remove',
    // impostazioni e preferenze (lettura ridotta, scrittura senza chiavi)
    'get_settings', 'update_settings',
    // richieste ai modelli, ricerca, metadati di un link
    'ai_request', 'web_search', 'fetch_link_meta',
    // account e crediti: al sito serve sapere se c'è un accesso, e il modulo
    // del red team propone di connettersi. L'USCITA non la chiede nessuno.
    'auth_status', 'auth_signin', 'get_credits', 'credits_award_feedback',
    'redteam_submit',
    // navigazione della scheda e schede nuove
    'nav_back', 'nav_forward', 'nav_reload', 'nav_state', 'close_tab',
    'open_url', 'open_new_tab', 'open_home', 'go_home', 'open_options',
    'open_incognito', 'open_spellcheck_page', 'shell_action',
    // schermo intero (l'Esc e chi se lo prende)
    'fullscreen_state', 'toggle_fullscreen', 'exit_fullscreen',
    'esc_chiedi_tasto', 'esc_consumato',
    // appunti: il menu del tasto destro mostra e gestisce la cronologia
    'get_clipboard_history', 'push_clipboard_entry', 'remove_clipboard_entry',
    'clear_clipboard_history', 'update_clipboard_description',
    // pagine salvate e scaricamenti avviati dal menu
    'save_page', 'save_link', 'save_path', 'set_saved_page_thumb',
    'download_image', 'download_link', 'download_media',
    // lettura ad alta voce e dettatura
    'tts_synth', 'tts_reading_state', 'tts_reading_status', 'tts_stop_reading',
    // traduzione della pagina e dei riquadri
    'translate_frames', 'frame_translate_done', 'run_in_top_frame',
    // correttore
    'replace_misspelling',
    // feedback dalla pagina (cattura, disegno, invio)
    'capture_visible_tab', 'capture_feedback_topbar', 'feedback_annotate',
    'feedback_clear_draw', 'submit_feedback',
    // l'assistente nella barra laterale della pagina
    'filo_run_action', 'filo_confirm_action',
    // segnali della scheda (colore, attività)
    'tab_activity', 'tab_dominant_color', 'tab_identity_color',
  ]);

  const SET = new Set(WEB_MESSAGE_TYPES);

  // Gli scomparti del magazzino dei dati che il codice dentro le pagine web
  // apre DAVVERO (lo shim chrome.storage). Stessa forma della lista qui sopra:
  // il nome che manca resta fuori. Senza, la domanda «dammi lo scomparto X»
  // era ammessa senza guardare quale X: chiedendoli per nome uno alla volta un
  // sito si portava via la memoria che Filo si è costruito sull'utente, le
  // pagine messe da parte, la cronologia delle richieste ai modelli, gli
  // scaricamenti col percorso su disco, i crediti — e li riscriveva.
  // `settings` resta qui perché la lettura passa comunque dalla riduzione di
  // src/shared/settingsScope.js e la scrittura ha il suo divieto.
  const WEB_STORAGE_KEYS = Object.freeze([
    'settings',                   // ridotto ai campi ammessi (settingsScope)
    'sn_personal_dict',           // spellcheck.js → dizionario personale
    'sn_autocorrect',             // spellcheck.js → correzioni automatiche
    'sn_icon_layout',             // menuIcons.js → disposizione delle icone
    'sn_qr_in_primary_migrated',  // menuIcons.js → migrazione fatta una volta
    'sn_feedback_client_id',      // feedback.js → chi sta segnalando
    'sn_feedback_draft_text',     // feedback.js → bozza del feedback
    'sn_redteam_attack_draft',    // redteamAttack.js → bozza dell'attacco
    'sn_redteam_desc_draft',      // redteamAttack.js → bozza della descrizione
  ]);

  const STORAGE_SET = new Set(WEB_STORAGE_KEYS);

  // Una superficie INTERNA di Filo: le pagine `filo://` e le chiamate che il
  // main fa a se stesso (nessuna origine, e nessuna pagina viva dietro). Una
  // pagina viva senza indirizzo non è interna: durante un caricamento
  // l'indirizzo può mancare per un istante, e quell'istante non deve valere
  // come lasciapassare.
  function isInternalSurface(origin, { fromPage = false } = {}) {
    const s = String(origin || '');
    if (s) return /^filo:\/\//i.test(s);
    return !fromPage;
  }

  function isWebMessage(type) {
    return SET.has(String(type || ''));
  }

  function isWebStorageKey(key) {
    return STORAGE_SET.has(String(key || ''));
  }

  // Questo messaggio, da questa origine, si può fare?
  function allowed(type, origin, opts) {
    return isInternalSurface(origin, opts) || isWebMessage(type);
  }

  global.SN_WEB_MESSAGE_SCOPE = {
    WEB_MESSAGE_TYPES,
    WEB_STORAGE_KEYS,
    isInternalSurface,
    isWebMessage,
    isWebStorageKey,
    allowed,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
