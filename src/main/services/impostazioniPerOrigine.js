// Cosa passa il confine fra Filo e una pagina che non è filo:// (i content script di un sito): liste di
// ciò che è AMMESSO, mai di ciò che si toglie: canali, domande, spinte, impostazioni, magazzino, azioni.
// Regole e sentinelle: tests/unit/impostazioniPerOrigine.test.mjs e tests/unit/domandeDaiSiti.test.mjs.
'use strict';

const OGNI_VOCE = '*';

// I canali su cui parla il preload delle pagine web. Gli altri (schede, finestra,
// terminale) rispondono solo alla cornice e alle pagine di Filo.
const CANALI_WEB = Object.freeze(new Set([
  'filo:message', 'ai-stream:start', 'ai-stream:abort',
  'filo:fp-config', 'filo:cookie-wipe', 'filo:permessi-stato', 'filo:permessi-scrittura', 'filo:frame-active',
  'filo:adblock-css', 'filo:adblock-tokens', 'filo:gesto-pagina', 'filo:gesto-di-filo', 'filo:apertura-scelta',
  'filo:indirizzo-rifiutato', 'filo:menu-di-riserva', 'filo:chiudi-pagina', 'filo:cmd-freccia',
  'filo:conferma', 'filo:conferma-ritira',
]));

// Le domande (tipi di filo:message) che il codice di Filo dentro le pagine fa davvero:
// da un sito ogni altra si rifiuta. Chi ne aggiunge una in un content script la mette qui.
const DOMANDE_WEB = Object.freeze(new Set([
  '_storage:get', '_storage:set', '_storage:remove', 'get_settings', 'update_settings',
  'ai_request', 'tts_synth', 'tts_reading_state', 'tts_reading_status', 'tts_stop_reading',
  'auth_status', 'auth_signin', 'redteam_submit', 'submit_feedback', 'credits_award_feedback',
  'feedback_annotate', 'feedback_clear_draw', 'capture_visible_tab', 'capture_feedback_topbar',
  'get_clipboard_history', 'push_clipboard_entry', 'remove_clipboard_entry',
  'clear_clipboard_history', 'update_clipboard_description', 'permesso_filo',
  'close_tab', 'nav_back', 'nav_forward', 'nav_reload', 'nav_state', 'go_home', 'open_home',
  'open_new_tab', 'open_incognito', 'open_options', 'open_spellcheck_page', 'open_url',
  'toggle_fullscreen', 'exit_fullscreen', 'fullscreen_state', 'esc_chiedi_tasto', 'esc_consumato',
  'run_in_top_frame', 'close_other_menus', 'translate_frames', 'frame_translate_done',
  'tab_activity', 'tab_dominant_color', 'tab_identity_color', 'replace_misspelling',
  'save_page', 'save_link', 'set_saved_page_thumb', 'download_image', 'download_media', 'download_link',
  'fetch_link_meta', 'web_search', 'path_collectable', 'save_path',
  'filo_run_action', 'filo_confirm_action', 'shell_action',
  'cookies_config', 'cookies_rule', 'cookies_banner_tokens', 'cookies_frame_banner', 'cookies_outcome',
  'safebrowse_get', 'geo_propose_accept', 'geo_propose_dismiss',
  'wallet_invite_open', 'campi_delicati', 'apri_collegamento_filo', 'key_fallback_shown', 'copy_text_to_clipboard',
  'filo_aiuto_nuovo', 'filo_conversazione_app', 'apri_comunque', 'aiuto_documenti_ferma',
  'aiuto_cerca_documenti', 'aiuto_apri_file', 'aiuto_mostra_file', 'aiuto_trascina_file',
  'filo_decidi_pagina', 'accesso_credenziali', 'riquadro_cookie_segnala',
  'riquadro_cookie_stato', 'riquadro_cookie_cambia', 'riquadro_cookie_risposta', 'ad_skip_click', 'ad_skip_config',
  'ad_skip_here', 'audio_host_check', 'spiegazione_anticipata_usata', 'image_provenance', 'image_bytes',
  'image_copied', 'icon_layout_get', 'icon_layout_drop', 'barra_trascina', 'menu_del_sito_scelto',
  'menu_del_sito_imposta', 'filo_spento_imposta', 'redteam_visibility', 'barra_etichette', 'shortcut_receipt',
]));

// Le fotografie: da un sito le chiede solo la scheda in primo piano, che inquadra sé stessa;
// una di sfondo avrebbe la pagina che l'utente sta guardando.
const DOMANDE_WEB_IN_VISTA = Object.freeze(new Set(['capture_visible_tab', 'capture_feedback_topbar']));

// Quelle che cambiano ciò che l'utente guarda (barra, schermo intero, schede e finestre davanti,
// l'ombra del feedback, la lettura altrove): da un sito solo la scheda in primo piano, da ogni suo riquadro.
const DOMANDE_WEB_SCHEDA_IN_VISTA = Object.freeze(new Set([
  'shell_action', 'toggle_fullscreen', 'exit_fullscreen', 'open_url', 'open_new_tab', 'open_home',
  'open_options', 'open_incognito', 'open_spellcheck_page', 'auth_signin', 'filo_run_action',
  'filo_confirm_action', 'feedback_annotate', 'feedback_clear_draw', 'tts_stop_reading',
  'apri_collegamento_filo', 'apri_comunque', 'wallet_invite_open', 'aiuto_apri_file', 'aiuto_mostra_file',
]));
// Spegnere l'ombra resta libero: lo chiede anche una pagina che si chiude in secondo piano.
const vuoleLaScheda = (type, msg) => DOMANDE_WEB_SCHEDA_IN_VISTA.has(type)
  && !(type === 'feedback_annotate' && !(msg && msg.on));

// La barra in alto porta i titoli delle altre schede: a un sito la si fotografa solo mentre
// l'utente ci ha disegnato sopra, l'unico motivo per cui il riquadro del feedback la chiede.
const DOMANDE_WEB_COL_DISEGNO = Object.freeze(new Set(['capture_feedback_topbar']));

// Il «Ha funzionato?» dell'Aiuto pubblica i passi per chi userà Filo su quel sito: da un sito vale solo per
// l'indirizzo della pagina che lo chiede, o un sito scriverebbe i percorsi di un altro (#589.1, giro 3).
const INDIRIZZO_DELLA_DOMANDA = new Map([['save_path', (msg) => msg && msg.payload && msg.payload.session && msg.payload.session.rawUrl]]);
function sulSitoDelMittente(type, msg, indirizzi) {
  const leggi = INDIRIZZO_DELLA_DOMANDA.get(type);
  if (!leggi) return true;
  const host = hostDi(leggi(msg));
  return Boolean(host) && (indirizzi || []).some((u) => hostDi(u) === host);
}

function domandaAmmessaDaUnSito(type, { inVista = false, schedaInVista = false, disegnoSullaBarra = false, indirizzi = [] } = {}, msg = null) {
  if (typeof type !== 'string' || !DOMANDE_WEB.has(type)) return false;
  if (DOMANDE_WEB_IN_VISTA.has(type) && inVista !== true) return false;
  if (vuoleLaScheda(type, msg) && inVista !== true && schedaInVista !== true) return false;
  if (!sulSitoDelMittente(type, msg, indirizzi)) return false;
  return !DOMANDE_WEB_COL_DISEGNO.has(type) || disegnoSullaBarra === true;
}

// Quelle che il codice di Filo nelle pagine fa solo dopo un gesto dell'utente (Incolla, Detta, Salva per dopo, la voce
// della dettatura, l'invio di un feedback, gli scaricamenti, un altro paese, il «Ha funzionato?» dell'Aiuto) e gli
// scomparti che scrive solo così (dizionario, correzioni, disposizione del menu): da un sito vogliono un gesto vero e
// recente su quella scheda.
const DOMANDE_WEB_COL_GESTO = Object.freeze(new Set([
  'permesso_filo', 'save_page', 'save_link', 'set_saved_page_thumb', 'update_settings',
  'submit_feedback', 'credits_award_feedback', 'redteam_submit',
  'download_image', 'download_media', 'download_link', 'geo_propose_accept', 'save_path', 'icon_layout_drop',
  'aiuto_apri_file', 'aiuto_mostra_file', 'aiuto_trascina_file',
]));
const CHIAVI_STORAGE_WEB_COL_GESTO = Object.freeze(['sn_personal_dict', 'sn_autocorrect', 'sn_icon_layout']);
// Un gesto, una scrittura: la lista tiene le ultime mille, e un «Ha funzionato?» costa due chiamate al modello.
const DOMANDE_WEB_UNA_PER_GESTO = Object.freeze(new Set(['save_page', 'save_link', 'save_path']));

/** La domanda di un sito vuole un gesto dell'utente? PURA. */
function vuoleUnGesto(type, msg = null) {
  if (DOMANDE_WEB_COL_GESTO.has(type)) return true;
  let chiavi = [];
  if (type === '_storage:set') chiavi = msg && msg.obj && typeof msg.obj === 'object' ? Object.keys(msg.obj) : [];
  else if (type === '_storage:remove') chiavi = msg ? [].concat(msg.keys) : [];
  return chiavi.some((k) => CHIAVI_STORAGE_WEB_COL_GESTO.includes(k));
}

// Ciò che i content script leggono davvero, campo per campo anche dentro le sezioni
// (`true` solo per valori tutti dell'utente): un segreto aggiunto domani resta a casa.
const CAMPI_WEB = Object.freeze({
  theme: true,
  themeTokens: true,
  tabColor: Object.freeze({
    soglia_saturazione: true, peso_centralita: true, bucket_tinta: true,
    saturazione_tab: true, luminosita_tab: true, opacita_tab: true,
  }),
  blocklist: true,
  // I siti dove il tasto destro apre il loro menu (#975): come i siti esclusi, arriva solo la voce del frame che chiede.
  menuDelSito: Object.freeze({ siti: true }),
  // L'Aiuto spento (#841) toglie la sua voce dal tasto destro anche sui siti.
  featureFlags: Object.freeze({ spellcheck: true, help: true }),
  // La spiegazione che parte da sola alla selezione (#818): spenta, la pagina aspetta il tasto destro.
  spiegaAnticipata: true,
  // I tasti di Spiega e Aiuto scelti dall'utente (#842): il menu del tasto destro li scrive accanto alle voci.
  scorciatoie: true,
  tts: Object.freeze({ voice: true, rate: true, pitch: true }),
  // Quanto restano gli avvisi di Filo dentro la pagina: la durata delle Preferenze vale anche lì.
  notifications: Object.freeze({ durationSec: true }),
  // Il microfono dell'Aiuto su una pagina: finito di parlare, la richiesta parte da sola o resta da correggere.
  dictation: Object.freeze({ autoSend: true, silenceSec: true, cancelSec: true }),
  models: Object.freeze({ transcribe_audio: true }),
  // Voci aperte (le scrive anche l'owner dalla config condivisa): di ognuna
  // passa solo quanto serve al menu della dettatura per scegliere il modello.
  modelRegistry: Object.freeze({
    [OGNI_VOCE]: Object.freeze({ provider: true, model: true, openrouter: true, label: true, inputs: true, outputs: true }),
  }),
});

// Ciò che un content script SCRIVE nelle impostazioni: la voce della dettatura
// scelta dal menu. Tutto il resto (proxy, protezioni, spesa, stile…) solo da Filo.
const CAMPI_WEB_SCRITTURA = Object.freeze({
  models: Object.freeze({ transcribe_audio: true }),
});

// I messaggi spinti a tutte le schede che il codice di Filo dentro le pagine
// ascolta. Un tipo nuovo non raggiunge i siti finché non lo si aggiunge qui: ogni
// spinta a più schede passa da messaggioPerDestinazione (sentinella nei test unit).
const SPINTE_WEB = Object.freeze(new Set([
  'settings_updated',
  'cookies_config_update',
  'ad_skip_config_update',
  'feedback_draw_state',
  'show_toast',
  'tts_global_reading',
  'tts_stop',
  'fullscreen_changed',
  'icon_layout_changed',
]));

// Quelli che si mostrano una volta sola, nella pagina in vista: a un sito vanno
// solo al frame principale della scheda in primo piano, che è l'unico a mostrarli.
const SPINTE_WEB_IN_VISTA = Object.freeze(new Set(['show_toast']));

// Gli scomparti del magazzino che i content script usano. `settings` si legge
// (ritagliato) ma non si scrive mai da un sito. Il segno dei feedback no: uguale su ogni sito,
// riconoscerebbe l'utente ovunque; al feedback mandato da un sito lo mette il main (#589.1 giro 5).
const CHIAVI_STORAGE_WEB = Object.freeze([
  'settings',
  'sn_personal_dict',
  'sn_autocorrect',
  'sn_icon_layout',
  'sn_qr_in_primary_migrated',
]);
const CHIAVI_STORAGE_WEB_SCRITTURA = Object.freeze(CHIAVI_STORAGE_WEB.filter((k) => k !== 'settings'));

// Le bozze dei riquadri (feedback, attacco red-team) scritte in un sito restano a quel sito (#1071): ognuno legge e
// scrive solo le chiavi che portano la SUA origine, quella del riquadro che chiede e non della scheda (un riquadro
// incorporato è un altro sito). Un documento senza origine (sandbox, data:) non ne ha: «null» è di tutti.
const BOZZE_PER_SITO = Object.freeze(['sn_feedback_draft_text', 'sn_redteam_attack_draft', 'sn_redteam_desc_draft']);
const chiaveDelSito = (k, origineRiquadro) => typeof k === 'string' && typeof origineRiquadro === 'string'
  && origineRiquadro !== '' && origineRiquadro !== 'null'
  && BOZZE_PER_SITO.some((b) => k === `${b}@${origineRiquadro}`);

// Le azioni di Filo che il codice dentro un sito chiede: la barra d'aiuto propone un
// feedback e apre i link («apri in una nuova scheda»). Il resto no, nemmeno confermato:
// la conferma nella pagina la dà anche il sito.
const AZIONI_WEB = Object.freeze(new Set(['INVIA_FEEDBACK', 'NAVIGA']));

// Da un sito NAVIGA apre solo indirizzi web, che il sito sa già aprire da sé; le
// pagine di Filo no. Un indirizzo senza schema lo completa l'apertura con https.
function indirizzoWeb(url) {
  const s = String(url ?? '').trim();
  if (!s) return false;
  try { return ['http:', 'https:'].includes(new URL(s).protocol.toLowerCase()); } catch (_) { return true; }
}

const isFilo = (url) => String(url || '').startsWith('filo://');

// Un destinatario vale come Filo solo se lo è anche la scheda che lo contiene:
// l'indirizzo di un riquadro lo sceglie la pagina, e un sito può puntarlo su filo://.
const destinazioneFilo = (url, pagina) => isFilo(url) && (pagina === undefined || isFilo(pagina));

const hostDi = (url) => { try { return new URL(String(url || '')).hostname; } catch (_) { return ''; } };

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function proietta(valore, regola) {
  if (regola === true) return valore;
  if (!valore || typeof valore !== 'object' || Array.isArray(valore)) return undefined;
  const out = {};
  const chiavi = own(regola, OGNI_VOCE) ? Object.keys(valore) : Object.keys(regola).filter((k) => own(valore, k));
  for (const k of chiavi) {
    if (k === '__proto__') continue;
    const sotto = proietta(valore[k], own(regola, OGNI_VOCE) ? regola[OGNI_VOCE] : regola[k]);
    if (sotto !== undefined) out[k] = sotto;
  }
  return out;
}

// Ogni campo di `valore`, a ogni livello, è previsto dalla regola?
function dentroLaRegola(valore, regola) {
  if (regola === true) return true;
  if (!valore || typeof valore !== 'object' || Array.isArray(valore)) return false;
  return Object.keys(valore).every((k) => {
    if (k === '__proto__') return false;
    const sotto = own(regola, OGNI_VOCE) ? regola[OGNI_VOCE] : (own(regola, k) ? regola[k] : undefined);
    return sotto !== undefined && dentroLaRegola(valore[k], sotto);
  });
}

// Dei siti esclusi arriva solo la voce che tocca `indirizzi` (il riquadro e la
// scheda che lo contiene), con lo stesso confronto del content script.
function esclusiDelSito(elenco, indirizzi) {
  if (!Array.isArray(elenco)) return [];
  const host = (indirizzi || []).map(hostDi).filter(Boolean);
  return elenco.filter((d) => typeof d === 'string' && d && host.some((h) => h === d || h.endsWith(`.${d}`)));
}

function impostazioniPerWeb(settings, indirizzi = []) {
  if (!settings || typeof settings !== 'object') return settings;
  const out = proietta(settings, CAMPI_WEB);
  if (own(out, 'blocklist')) out.blocklist = esclusiDelSito(out.blocklist, indirizzi);
  if (out.menuDelSito && own(out.menuDelSito, 'siti')) out.menuDelSito.siti = esclusiDelSito(out.menuDelSito.siti, indirizzi);
  return out;
}

// Le risposte che portano un elenco di tutti i siti: a un sito torna solo la sua voce, come nella lettura delle
// impostazioni (#589.1 giro 4). Una domanda ammessa che risponde con dati degli altri siti si ritaglia qui.
const RISPOSTE_WEB = new Map([
  ['filo_spento_imposta', (r, indirizzi) => ({ ...r, siti: esclusiDelSito(r.siti, indirizzi) })],
  ['menu_del_sito_imposta', (r, indirizzi) => ({ ...r, siti: esclusiDelSito(r.siti, indirizzi) })],
]);
function rispostaPerUnSito(type, risposta, indirizzi = []) {
  const ritaglia = RISPOSTE_WEB.get(type);
  if (!ritaglia || !risposta || typeof risposta !== 'object' || !own(risposta, 'siti')) return risposta;
  return ritaglia(risposta, indirizzi);
}

function impostazioniPerOrigine(settings, origine, indirizzi = [origine]) {
  return isFilo(origine) ? settings : impostazioniPerWeb(settings, indirizzi);
}

// Il riquadro che chiede e la scheda che lo contiene: i due indirizzi che il
// content script confronta coi siti esclusi.
function indirizziDelMittente(sender) {
  let riquadro = '';
  try { riquadro = String(sender?.frame?.url || ''); } catch (_) { riquadro = ''; }
  return [riquadro, String(sender?.tab?.url || sender?.url || '')];
}

// #843 — dall'Aiuto di un sito si spegne o si riaccende Filo solo lì: si aggiunge il nome del sito, si tolgono le voci
// che lo coprono. Mai un altro sito, che il testo della pagina potrebbe far nominare.
function filoSulSitoStesso(action, origine) {
  const N = globalThis.SN_NOMI_SITO || require('../../shared/nomiSito.js');
  const D = globalThis.SN_PAGINE_DELICATE || require('../../shared/pagineDelicate.js');
  if (!globalThis.SN_PREF) require('../../shared/preferences.js');
  const P = globalThis.SN_PREF;
  const chiave = action.chiave ?? action.key ?? action.nome ?? action.name ?? action.preferenza;
  const setter = P.setterDellaChiave(chiave);
  if (!setter || setter.scrive.length !== 1 || setter.scrive[0] !== 'blocklist') return false;
  const host = hostDi(origine);
  const sito = N.daScritto(host);
  if (!sito) return false;
  const r = D.risolviSchede(action.valore ?? action.value ?? action.valoreNuovo ?? action.val, { schede: [], attiva: origine });
  const b = r.rifiuto ? null : P.buildPreferencePartial(chiave, r.valore);
  const e = b && !b.rifiuto && b.elenco;
  if (!e || !e.voci.length) return false;
  if (e.op === 'aggiungi') return e.voci.every((v) => v === sito);
  return e.op === 'togli' && e.voci.every((v) => N.copre(v, host));
}

function azioneAmmessaDa(action, origine) {
  if (isFilo(origine)) return true;
  if (!action || typeof action !== 'object') return false;
  const type = String(action.type || '').toUpperCase();
  if (type === 'IMPOSTA_PREFERENZA') {
    try { return filoSulSitoStesso(action, origine); } catch (_) { return false; }
  }
  if (!AZIONI_WEB.has(type)) return false;
  return type !== 'NAVIGA' || indirizzoWeb(action.url ?? action.href ?? action.link);
}

// Un salvataggio di preferenze chiesto da un sito passa solo se tocca soltanto
// i campi di CAMPI_WEB_SCRITTURA: altrimenti si rifiuta intero.
function scritturaImpostazioniAmmessa(incoming, origine) {
  if (isFilo(origine)) return true;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return false;
  return dentroLaRegola(incoming, CAMPI_WEB_SCRITTURA);
}

// Per le spinte: `null` = «a questo destinatario non si manda». Verso un sito passano i
// tipi di SPINTE_WEB con le impostazioni ritagliate; `pagina` è la scheda che contiene
// il riquadro, `dove` dice se la scheda è in primo piano e se chi riceve è un riquadro.
function messaggioPerDestinazione(message, url, pagina, dove = {}) {
  if (destinazioneFilo(url, pagina) || !message || typeof message !== 'object') return message;
  if (!SPINTE_WEB.has(message.type)) return null;
  if (SPINTE_WEB_IN_VISTA.has(message.type) && (dove.inVista !== true || dove.riquadro)) return null;
  if (!own(message, 'settings')) return message;
  return { ...message, settings: impostazioniPerWeb(message.settings, [url, pagina]) };
}

// Una spinta a una scheda, frame per frame (#405: i content script girano anche nei
// riquadri), ognuno col messaggio ritagliato sul suo indirizzo e su `inVista` (la
// scheda in primo piano della finestra). Ogni spinta a più schede passa da qui.
function spingiAllaScheda(wc, message, { inVista = false } = {}) {
  if (!wc || wc.isDestroyed?.()) return;
  let pagina = '';
  try { pagina = String(wc.getURL() || ''); } catch (_) { pagina = ''; }
  let frames = null;
  try { frames = wc.mainFrame && wc.mainFrame.framesInSubtree; } catch (_) { frames = null; }
  if (!frames || !frames.length) {
    try { const m = messaggioPerDestinazione(message, pagina, undefined, { inVista }); if (m) wc.send('filo:broadcast', m); } catch (_) {}
    return;
  }
  for (const f of frames) {
    try {
      if (f.detached) continue;
      const m = messaggioPerDestinazione(message, f.url, pagina, { inVista, riquadro: Boolean(f.parent) });
      if (m) f.send('filo:broadcast', m);
    } catch (_) {}
  }
}

// Una finestra riceve solo nel frame principale: la shell, oppure una finestra
// aperta da un sito (i popup di accesso), che vale come sito.
function spingiAllaFinestra(win, message) {
  try {
    const wc = win && win.webContents;
    if (!wc || wc.isDestroyed?.()) return;
    const m = messaggioPerDestinazione(message, wc.getURL(), undefined, { inVista: Boolean(win.isFocused?.()) });
    if (m) wc.send('filo:broadcast', m);
  } catch (_) {}
}

// Le chiavi che un sito può chiedere al magazzino, nella stessa forma della
// richiesta (null = tutte le sue, stringa, elenco, oggetto coi valori di ripiego).
function chiaviStoragePerOrigine(keys, origine, origineRiquadro) {
  if (isFilo(origine)) return keys;
  const ammessa = (k) => typeof k === 'string' && (CHIAVI_STORAGE_WEB.includes(k) || chiaveDelSito(k, origineRiquadro));
  if (keys == null) return [...CHIAVI_STORAGE_WEB];
  if (typeof keys === 'string') return ammessa(keys) ? keys : [];
  if (Array.isArray(keys)) return keys.filter(ammessa);
  if (typeof keys === 'object') {
    const out = {};
    for (const k of Object.keys(keys)) if (ammessa(k)) out[k] = keys[k];
    return out;
  }
  return [];
}

// Scrivere o togliere scomparti da un sito: solo quelli dei content script.
function scritturaStorageAmmessa(keys, origine, origineRiquadro) {
  if (isFilo(origine)) return true;
  const elenco = Array.isArray(keys) ? keys : [keys];
  return elenco.every((k) => typeof k === 'string'
    && (CHIAVI_STORAGE_WEB_SCRITTURA.includes(k) || chiaveDelSito(k, origineRiquadro)));
}

// Letture dello storage grezzo (chrome.storage.local.get): la chiave `settings`
// segue la stessa regola delle risposte e delle spinte.
function storagePerOrigine(valore, origine, chiave = 'settings', indirizzi = [origine]) {
  if (isFilo(origine) || !valore || typeof valore !== 'object' || !own(valore, chiave)) return valore;
  return { ...valore, [chiave]: impostazioniPerWeb(valore[chiave], indirizzi) };
}

module.exports = {
  CANALI_WEB,
  DOMANDE_WEB,
  DOMANDE_WEB_IN_VISTA,
  DOMANDE_WEB_SCHEDA_IN_VISTA,
  DOMANDE_WEB_COL_DISEGNO,
  DOMANDE_WEB_COL_GESTO,
  CHIAVI_STORAGE_WEB_COL_GESTO,
  DOMANDE_WEB_UNA_PER_GESTO,
  domandaAmmessaDaUnSito,
  vuoleUnGesto,
  RISPOSTE_WEB,
  rispostaPerUnSito,
  CAMPI_WEB,
  CAMPI_WEB_SCRITTURA,
  SPINTE_WEB,
  SPINTE_WEB_IN_VISTA,
  CHIAVI_STORAGE_WEB,
  BOZZE_PER_SITO,
  AZIONI_WEB,
  isFilo,
  impostazioniPerWeb,
  impostazioniPerOrigine,
  indirizziDelMittente,
  azioneAmmessaDa,
  scritturaImpostazioniAmmessa,
  messaggioPerDestinazione,
  spingiAllaScheda,
  spingiAllaFinestra,
  chiaviStoragePerOrigine,
  scritturaStorageAmmessa,
  storagePerOrigine,
};
