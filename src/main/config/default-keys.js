// Chiavi API di default: Filo funziona appena installato, senza configurare niente.
// Non stanno nel repo pubblico: le scrive la CI in un file generato e gitignorato, e
// vivono solo nel main. Precedenza: file generato, poi env FILO_DEFAULT_*, poi vuoto.

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
    // La chiave Safe Browsing non è una chiave di modelli: nel file generato sta accanto ad
    // `apiKeys`. Si accetta anche la forma annidata, o un bake vecchio la farebbe sparire.
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

// Solo le chiavi dei provider di modelli/ricerca: è il contratto che defaultsStore fonde
// in `apiKeys`, e la Safe Browsing lì dentro finirebbe passata a un provider.
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
