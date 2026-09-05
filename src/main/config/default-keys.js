// Chiavi API "di default" che fanno funzionare Filo appena installato, senza
// che l'utente debba configurare nulla.
//
// SICUREZZA — perché le chiavi vere non stanno nel repo:
//   Il repo è pubblico: committare chiavi vere le renderebbe estraibili da
//   chiunque. Le chiavi vengono invece scritte a BUILD-TIME dalla CI in un file
//   generato (default-keys.generated.json) che è gitignorato e finisce SOLO
//   dentro l'eseguibile impacchettato. Stesso livello di fiducia di un secret
//   CI: chi ha il binario ha le chiavi, ma non sono nel repo pubblico.
//
//   Le chiavi vivono SOLO nel processo main e non vengono mai inviate alle
//   pagine (renderer/preload). Le richieste AI girano nel main (vedi
//   handlers.js), che allega la chiave al provider: il client non la vede mai.
//
// PRECEDENZA (dalla più alta):
//   1. default-keys.generated.json   → scritto dalla CI (vedi scripts/bake-default-config.mjs)
//   2. env FILO_DEFAULT_*             → comodo per lo sviluppo locale
//   3. vuoto                          → lo sviluppatore usa le proprie chiavi dalle Opzioni
//
// La CI (release.yml) esegue `node scripts/bake-default-config.mjs` PRIMA del
// build: lo script legge le chiavi correnti (override admin da Firestore
// config/secrets, oppure i secret FILO_DEFAULT_* del job) e le scrive nel file
// generato. Così, ad ogni release (ogni 6h), le chiavi ruotate dall'admin si
// propagano a TUTTI gli utenti — anche quelli senza login.
//
// A runtime l'admin loggato può comunque ruotare queste chiavi dalla pagina
// "Modelli predefiniti" (override via Firestore, vedi defaultsStore.js): in quel
// caso l'override remoto ha la precedenza sulle chiavi baked, ma è leggibile
// solo dagli utenti loggati. Gli utenti non loggati ricadono su queste chiavi
// baked, che il prossimo build CI riallinea.

const fs = require('fs');
const path = require('path');

function fromEnv(name) {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

// Legge il file generato dalla CI, se presente. Non deve mai lanciare: in
// sviluppo locale il file non esiste e si ricade su env/vuoto.
function fromGeneratedFile() {
  try {
    const p = path.join(__dirname, 'default-keys.generated.json');
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    const keys = (j && typeof j === 'object' && j.apiKeys && typeof j.apiKeys === 'object')
      ? j.apiKeys
      : j;
    const pick = (k) => (typeof keys[k] === 'string' ? keys[k].trim() : '');
    return { openrouter: pick('openrouter'), tavily: pick('tavily') };
  } catch (_) {
    return null; // file assente o malformato → nessun contributo
  }
}

// Snapshot letto una volta all'avvio del processo main: file generato > env.
function readSnapshot() {
  const gen = fromGeneratedFile() || {};
  return {
    openrouter: gen.openrouter || fromEnv('FILO_DEFAULT_OPENROUTER_KEY'),
    tavily: gen.tavily || fromEnv('FILO_DEFAULT_TAVILY_KEY'),
  };
}

const DEFAULT_KEYS = readSnapshot();

function getBuildKeys() {
  return { ...DEFAULT_KEYS };
}

// True se almeno una chiave di default è disponibile (file generato o env).
function hasAnyBuildKey() {
  return Boolean(DEFAULT_KEYS.openrouter || DEFAULT_KEYS.tavily);
}

module.exports = { getBuildKeys, hasAnyBuildKey };
