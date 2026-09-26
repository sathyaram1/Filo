// Whitelist (stage 2): lista curata di eTLD+1 noti e fidati per IDENTITÀ.
//
// Il confronto è ESATTO sull'eTLD+1 normalizzato. Se combacia, saltiamo i
// controlli di impersonazione e l'LLM: un sosia ha sempre un eTLD+1 diverso e
// non combacia mai. NON certifica la sicurezza: i controlli indipendenti dal
// contenuto (certificato, contenuto misto, download, filtro contenuti) girano
// comunque.
//
// Include tutti i domini legittimi dei brand (così il sito vero non si
// auto-segnala) più i siti più trafficati in IT/EN. Allungarla è sicuro.

'use strict';

const { BRANDS } = require('./brands');
const { S3 } = require('./psl');

const EXTRA = [
  // Motori / portali
  'bing.com', 'duckduckgo.com', 'wikipedia.org', 'wikimedia.org',
  'reddit.com', 'quora.com', 'medium.com', 'stackoverflow.com',
  'stackexchange.com',
  // Google properties + infra/CDN (evitano falsi positivi combosquat:
  // contengono "google" ma sono domini ufficiali)
  'youtube.com', 'youtu.be', 'google.co.uk', 'google.de', 'google.fr',
  'google.es', 'android.com', 'chromium.org', 'gstatic.com',
  'googleusercontent.com', 'googleapis.com', 'googletagmanager.com',
  'google-analytics.com', 'ggpht.com', 'doubleclick.net', 'withgoogle.com',
  'goo.gl', 'recaptcha.net',
  // CDN/infra di altri brand (contengono il token del brand ma sono ufficiali)
  'fbcdn.net', 'cdninstagram.com', 'licdn.com', 'twimg.com',
  'paypalobjects.com', 'icloud-content.com',
  // Microsoft / Apple ecosistema
  'bing.net', 'msn.com', 'skype.com', 'xbox.com', 'windows.com',
  'sharepoint.com', 'onedrive.com', 'azure.com', 'visualstudio.com',
  // Dev / infra
  'gitlab.com', 'bitbucket.org', 'npmjs.com', 'pypi.org', 'cloudflare.com',
  'jsdelivr.net', 'unpkg.com', 'vercel.app', 'netlify.app', 'heroku.com',
  'digitalocean.com', 'aws.amazon.com', 'amazonaws.com',
  // Media / news (IT + EN)
  'bbc.com', 'bbc.co.uk', 'cnn.com', 'nytimes.com', 'theguardian.com',
  'repubblica.it', 'corriere.it', 'ilsole24ore.com', 'ansa.it', 'rai.it',
  'gazzetta.it', 'lastampa.it',
  // Streaming / intrattenimento
  'spotify.com', 'twitch.tv', 'primevideo.com', 'disneyplus.com',
  'soundcloud.com', 'vimeo.com',
  // Servizi / produttività
  'notion.so', 'slack.com', 'zoom.us', 'trello.com', 'atlassian.com',
  'figma.com', 'canva.com', 'adobe.com', 'wordpress.com', 'wordpress.org',
  'mozilla.org', 'archive.org', 'imdb.com',
  // PA / istituzioni IT
  'gov.it', 'agid.gov.it', 'inps.it', 'agenziaentrate.gov.it',
  'spid.gov.it', 'pagopa.it', 'governo.it',
  // AI
  'openai.com', 'anthropic.com', 'claude.ai', 'chatgpt.com',
  'huggingface.co', 'perplexity.ai', 'gemini.google.com',
];

const WHITELIST = new Set();
for (const b of BRANDS) for (const d of b.domains) WHITELIST.add(d);
for (const d of EXTRA) WHITELIST.add(d);

// Confronto esatto dell'eTLD+1 normalizzato con la lista.
function isWhitelisted(registrable) {
  return !!registrable && WHITELIST.has(registrable);
}

// Pagine che chiunque pubblica sotto un dominio in whitelist: il dominio dice chi ospita, non chi ha scritto.
// Restano fuori gli accessi della piattaforma stessa e OneDrive, che non mostra pagine caricate.
const HOSTED = [
  { host: /^sites\.google\.com$/, platform: 'Google Sites' },
  { host: /^docs\.google\.com$/, platform: 'Google Documenti e Moduli' },
  { host: /^script\.google\.com$/, path: /^\/(a\/[^/]+\/)?macros\//, platform: 'Google Apps Script' },
  { host: /^(forms|sway)\.(office\.com|cloud\.microsoft)$/, platform: 'Microsoft Forms e Sway' },
  { host: /^ia\d+\.us\.archive\.org$/, platform: 'archive.org' },
  { host: /^(www\.)?archive\.org$/, path: /^\/download\//, platform: 'archive.org' },
  { host: /^(www\.)?notion\.so$/, path: /^\/(?!(login|signup)(\/|$))[^/]+/, platform: 'Notion' },
  { host: /^(www\.)?canva\.com$/, path: /^\/design\//, platform: 'Canva' },
  // Indirizzi per percorso: s3.amazonaws.com/<secchio>/<file>, storage.googleapis.com/<secchio>/<file>.
  { host: S3, path: /^\/[^/]+\/./, platform: 'Amazon S3' },
  { host: /^(storage|firebasestorage)\.googleapis\.com$/, path: /^\/[^/]+\/./, platform: 'Google Cloud Storage' },
];

function hostedPlatform(host, path) {
  const h = String(host || '').toLowerCase();
  const p = String(path || '/');
  const r = HOSTED.find((x) => x.host.test(h) && (!x.path || x.path.test(p)));
  return r ? r.platform : null;
}

module.exports = { WHITELIST, isWhitelisted, hostedPlatform };
