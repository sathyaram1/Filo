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

  // L'origine è la pagina di un sito? (http/https: quello che un sito può
  // davvero essere). `filo://`, `data:` delle finestre disegnate da Filo e
  // l'origine vuota delle chiamate interne restano fuori di qui.
  function isWebOrigin(origin) {
    return /^https?:\/\//i.test(String(origin || ''));
  }

  function isWebMessage(type) {
    return SET.has(String(type || ''));
  }

  // Questo messaggio, da questa origine, si può fare?
  function allowed(type, origin) {
    return !isWebOrigin(origin) || isWebMessage(type);
  }

  global.SN_WEB_MESSAGE_SCOPE = { WEB_MESSAGE_TYPES, isWebOrigin, isWebMessage, allowed };
})(typeof globalThis !== 'undefined' ? globalThis : self);
