// Cosa passa il confine fra Filo e una pagina che non è filo:// (i content script di un sito):
// liste di ciò che è AMMESSO, mai di ciò che si toglie: spinte, impostazioni, magazzino, azioni.
// Regole e sentinelle: tests/unit/impostazioniPerOrigine.test.mjs.
'use strict';

const OGNI_VOCE = '*';

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
  featureFlags: Object.freeze({ spellcheck: true }),
  tts: Object.freeze({ voice: true, rate: true, pitch: true }),
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
  'feedback_draw_state',
  'show_toast',
  'tts_global_reading',
  'tts_stop',
  'fullscreen_changed',
  'form_recheck',
  'form_sent',
]));

// Quelli che si mostrano una volta sola, nella pagina in vista: a un sito vanno
// solo al frame principale della scheda in primo piano, che è l'unico a mostrarli.
const SPINTE_WEB_IN_VISTA = Object.freeze(new Set(['show_toast']));

// Gli scomparti del magazzino che i content script usano. `settings` si legge
// (ritagliato) ma non si scrive mai da un sito.
const CHIAVI_STORAGE_WEB = Object.freeze([
  'settings',
  'sn_personal_dict',
  'sn_autocorrect',
  'sn_icon_layout',
  'sn_qr_in_primary_migrated',
  'sn_feedback_client_id',
  'sn_feedback_draft_text',
  'sn_redteam_attack_draft',
  'sn_redteam_desc_draft',
]);
const CHIAVI_STORAGE_WEB_SCRITTURA = Object.freeze(CHIAVI_STORAGE_WEB.filter((k) => k !== 'settings'));

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
  return out;
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

function azioneAmmessaDa(action, origine) {
  if (isFilo(origine)) return true;
  if (!action || typeof action !== 'object') return false;
  const type = String(action.type || '').toUpperCase();
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
// `soloFrame(url)` restringe la spinta ai frame che lo meritano (un dato di un sito solo ai suoi).
function spingiAllaScheda(wc, message, { inVista = false, soloFrame = null } = {}) {
  if (!wc || wc.isDestroyed?.()) return;
  let pagina = '';
  try { pagina = String(wc.getURL() || ''); } catch (_) { pagina = ''; }
  let frames = null;
  try { frames = wc.mainFrame && wc.mainFrame.framesInSubtree; } catch (_) { frames = null; }
  if (!frames || !frames.length) {
    if (soloFrame && !soloFrame(pagina)) return;
    try { const m = messaggioPerDestinazione(message, pagina, undefined, { inVista }); if (m) wc.send('filo:broadcast', m); } catch (_) {}
    return;
  }
  for (const f of frames) {
    try {
      if (f.detached || (soloFrame && !soloFrame(f.url))) continue;
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
function chiaviStoragePerOrigine(keys, origine) {
  if (isFilo(origine)) return keys;
  const ammessa = (k) => typeof k === 'string' && CHIAVI_STORAGE_WEB.includes(k);
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
function scritturaStorageAmmessa(keys, origine) {
  if (isFilo(origine)) return true;
  const elenco = Array.isArray(keys) ? keys : [keys];
  return elenco.every((k) => typeof k === 'string' && CHIAVI_STORAGE_WEB_SCRITTURA.includes(k));
}

// Letture dello storage grezzo (chrome.storage.local.get): la chiave `settings`
// segue la stessa regola delle risposte e delle spinte.
function storagePerOrigine(valore, origine, chiave = 'settings', indirizzi = [origine]) {
  if (isFilo(origine) || !valore || typeof valore !== 'object' || !own(valore, chiave)) return valore;
  return { ...valore, [chiave]: impostazioniPerWeb(valore[chiave], indirizzi) };
}

module.exports = {
  CAMPI_WEB,
  CAMPI_WEB_SCRITTURA,
  SPINTE_WEB,
  SPINTE_WEB_IN_VISTA,
  CHIAVI_STORAGE_WEB,
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
