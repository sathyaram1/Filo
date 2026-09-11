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
// A runtime l'admin ruota queste chiavi dalla pagina "Modelli predefiniti"
// (scrive il doc Firestore config/secrets, vedi defaultsStore.js). Dal #581 quel
// documento è leggibile SOLO dall'admin: per tutti gli altri la strada verso le
// chiavi ruotate è questa, cioè il prossimo build CI. Prima la leggeva anche
// qualunque utente loggato — e siccome il login è aperto a qualsiasi account
// Google e la chiave web di Firebase sta in un repo pubblico, "loggato" non era
// una barriera: bastava una GET REST per portarsi via le chiavi di tutti.

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
    // La chiave Safe Browsing non è una chiave di modelli: nel file generato sta
    // accanto ad `apiKeys`, non dentro. Si accetta anche la forma annidata,
    // perché un file scritto da un bake vecchio non deve far sparire la chiave
    // in silenzio.
    const sbRaw = (typeof j?.safeBrowsingKey === 'string' && j.safeBrowsingKey)
      || (typeof keys.safeBrowsingKey === 'string' && keys.safeBrowsingKey)
      || (typeof keys.safeBrowsing === 'string' && keys.safeBrowsing)
      || '';
    return {
      openrouter: pick('openrouter'),
      tavily: pick('tavily'),
      safeBrowsingKey: String(sbRaw).trim(),
    };
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
    safeBrowsingKey: gen.safeBrowsingKey || fromEnv('FILO_DEFAULT_SAFEBROWSING_KEY'),
  };
}

const DEFAULT_KEYS = readSnapshot();

// Solo le chiavi dei PROVIDER di modelli/ricerca: è il contratto che
// defaultsStore fonde in `apiKeys`, e la chiave Safe Browsing non va lì dentro
// (finirebbe fra le chiavi passate a un provider).
function getBuildKeys() {
  return { openrouter: DEFAULT_KEYS.openrouter, tavily: DEFAULT_KEYS.tavily };
}

// Chiave Google Safe Browsing incastonata dal build (#581): è l'unica strada
// verso un'installazione non-admin, da quando config/secrets è admin-only.
function getBuildSafeBrowsingKey() {
  return DEFAULT_KEYS.safeBrowsingKey || '';
}

// True se almeno una chiave di default è disponibile (file generato o env).
function hasAnyBuildKey() {
  return Boolean(DEFAULT_KEYS.openrouter || DEFAULT_KEYS.tavily);
}

module.exports = { getBuildKeys, getBuildSafeBrowsingKey, hasAnyBuildKey };
