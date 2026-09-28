// Cosa delle impostazioni raggiunge una pagina che non è filo:// (i content script di un sito):
// solo i campi di CAMPI_WEB, sia nelle risposte sia nelle spinte. Le pagine filo:// hanno l'oggetto intero.
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

const isFilo = (url) => String(url || '').startsWith('filo://');

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

function impostazioniPerWeb(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  return proietta(settings, CAMPI_WEB);
}

function impostazioniPerOrigine(settings, origine) {
  return isFilo(origine) ? settings : impostazioniPerWeb(settings);
}

// Per le spinte: il messaggio che porta `settings` viene ritagliato sul
// destinatario, qualunque sia il suo tipo.
function messaggioPerDestinazione(message, url) {
  if (isFilo(url) || !message || typeof message !== 'object' || !own(message, 'settings')) return message;
  return { ...message, settings: impostazioniPerWeb(message.settings) };
}

// Letture dello storage grezzo (chrome.storage.local.get): la chiave `settings`
// segue la stessa regola delle risposte e delle spinte.
function storagePerOrigine(valore, origine, chiave = 'settings') {
  if (isFilo(origine) || !valore || typeof valore !== 'object' || !own(valore, chiave)) return valore;
  return { ...valore, [chiave]: impostazioniPerWeb(valore[chiave]) };
}

module.exports = {
  CAMPI_WEB,
  isFilo,
  impostazioniPerWeb,
  impostazioniPerOrigine,
  messaggioPerDestinazione,
  storagePerOrigine,
};
