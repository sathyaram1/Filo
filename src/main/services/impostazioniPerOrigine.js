// Cosa passa il confine fra Filo e una pagina che non è filo:// (i content script di un sito):
// liste di ciò che è AMMESSO, mai di ciò che si toglie: spinte, impostazioni, magazzino, azioni.
// Regole e sentinelle: tests/unit/impostazioniPerOrigine.test.mjs.
'use strict';

const OGNI_VOCE = '*';

// Ciò che i content script leggono davvero. Quello che manca qui non arriva ai
// siti: un segreto aggiunto domani resta a casa senza che nessuno se ne ricordi.
const CAMPI_WEB = Object.freeze({
  theme: true,
  themeTokens: true,
  tabColor: true,
  blocklist: true,
  featureFlags: true,
  tts: true,
  models: true,
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
// ascolta. Un tipo nuovo non raggiunge i siti finché non lo si aggiunge qui.
const SPINTE_WEB = Object.freeze(new Set([
  'settings_updated',
  'cookies_config_update',
  'feedback_draw_state',
  'show_toast',
  'tts_global_reading',
  'tts_stop',
]));

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

// Le azioni di Filo che il codice dentro un sito chiede: la barra d'aiuto propone
// un feedback. Il resto (preferenze, memoria, terminale) solo dalle pagine di Filo,
// anche confermato: la conferma disegnata dentro un sito la può dare il sito.
const AZIONI_WEB = Object.freeze(new Set(['INVIA_FEEDBACK']));

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
  return !!action && typeof action === 'object' && AZIONI_WEB.has(String(action.type || '').toUpperCase());
}

// Un salvataggio di preferenze chiesto da un sito passa solo se tocca soltanto
// i campi di CAMPI_WEB_SCRITTURA: altrimenti si rifiuta intero.
function scritturaImpostazioniAmmessa(incoming, origine) {
  if (isFilo(origine)) return true;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return false;
  return dentroLaRegola(incoming, CAMPI_WEB_SCRITTURA);
}

// Per le spinte: `null` vuol dire «a questo destinatario non si manda». Verso un
// sito passano solo i tipi di SPINTE_WEB, e le impostazioni ritagliate.
// `pagina` è l'indirizzo della scheda quando il destinatario è un suo riquadro.
function messaggioPerDestinazione(message, url, pagina) {
  if (destinazioneFilo(url, pagina) || !message || typeof message !== 'object') return message;
  if (!SPINTE_WEB.has(message.type)) return null;
  if (!own(message, 'settings')) return message;
  return { ...message, settings: impostazioniPerWeb(message.settings, [url, pagina]) };
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
  CHIAVI_STORAGE_WEB,
  AZIONI_WEB,
  isFilo,
  impostazioniPerWeb,
  impostazioniPerOrigine,
  indirizziDelMittente,
  azioneAmmessaDa,
  scritturaImpostazioniAmmessa,
  messaggioPerDestinazione,
  chiaviStoragePerOrigine,
  scritturaStorageAmmessa,
  storagePerOrigine,
};
