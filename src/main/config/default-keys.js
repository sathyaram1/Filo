// Chiavi API "di default" che fanno funzionare Filo appena installato, senza
// che l'utente debba configurare nulla.
//
// SICUREZZA — perché stanno qui e non nel repo:
//   Le chiavi vere NON vanno committate (il repo è pubblico: finirebbero
//   estraibili da chiunque). Vengono iniettate a BUILD-TIME dalla CI come
//   variabili d'ambiente segrete (GitHub Actions secrets o simili). In locale,
//   durante lo sviluppo, restano vuote: lo sviluppatore usa le proprie chiavi
//   dalle Opzioni.
//
//   Vivono SOLO nel processo main e non vengono mai inviate alle pagine
//   (renderer/preload). Le richieste AI girano nel main (vedi handlers.js), che
//   allega la chiave al provider: il client non la vede mai. Per questo sono
//   "non liberamente accessibili" anche quando in uso.
//
// CI/build: definire le variabili come secret nel job che produce l'eseguibile:
//   FILO_DEFAULT_OPENROUTER_KEY, FILO_DEFAULT_GEMINI_KEY, FILO_DEFAULT_TAVILY_KEY
//
// A runtime l'admin può comunque ruotare queste chiavi dalla pagina admin
// "Modelli predefiniti" (override via Firestore, vedi defaultsStore.js): in quel
// caso l'override ha la precedenza sulle chiavi di build.

function fromEnv(name) {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

// Snapshot letto una volta all'avvio del processo main.
const DEFAULT_KEYS = {
  openrouter: fromEnv('FILO_DEFAULT_OPENROUTER_KEY'),
  gemini: fromEnv('FILO_DEFAULT_GEMINI_KEY'),
  tavily: fromEnv('FILO_DEFAULT_TAVILY_KEY'),
};

function getBuildKeys() {
  return { ...DEFAULT_KEYS };
}

// True se almeno una chiave di default è stata iniettata nel build.
function hasAnyBuildKey() {
  return Boolean(DEFAULT_KEYS.openrouter || DEFAULT_KEYS.gemini || DEFAULT_KEYS.tavily);
}

module.exports = { getBuildKeys, hasAnyBuildKey };
