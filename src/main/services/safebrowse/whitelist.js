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
  'google-analytics.com', 'youtube-nocookie.com', 'ggpht.com', 'doubleclick.net', 'withgoogle.com',
  'goo.gl', 'recaptcha.net',
  // CDN/infra di altri brand (contengono il token del brand ma sono ufficiali)
  'fbcdn.net', 'cdninstagram.com', 'licdn.com', 'twimg.com',
  'paypalobjects.com', 'icloud-content.com', 'amazon-adsystem.com',
  'media-amazon.com', 'ssl-images-amazon.com', 'images-amazon.com',
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
  'soundcloud.com', 'vimeo.com', 'fandom.com',
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
// `owner` è la parte del percorso che dice di chi è la pagina (il secchio, il sito, il documento): su questi domini il
// proprietario sta lì, e i file sotto di lui sono suoi. Un percorso che non la contiene conta come la piattaforma.
const HOSTED = [
  { host: /^sites\.google\.com$/, owner: /^\/[^/]+\/[^/]+/, platform: 'Google Sites' },
  { host: /^docs\.google\.com$/, owner: /^(\/a\/[^/]+)?\/[^/]+\/d\/(e\/)?[^/]+/, platform: 'Google Documenti e Moduli' },
  { host: /^script\.google\.com$/, path: /^\/(a\/macros\/[^/]+\/|(a\/[^/]+\/)?macros\/)/, owner: /^.*?\/s\/[^/]+/, platform: 'Google Apps Script' },
  // Il questionario aperto sta in `?id=` (/Pages/ResponsePage.aspx?id=…): vedi pagePath.
  { host: /^(forms|sway)\.(office\.com|cloud\.microsoft)$/, query: 'id', owner: /^\/[^/]+\/[^/]+/, platform: 'Microsoft Forms e Sway' },
  { host: /^customervoice\.microsoft\.com$/, query: 'id', owner: /^\/[^/]+\/[^/]+/, platform: 'Microsoft Customer Voice' },
  // L'app dell'utente gira in un riquadro su <utente>-<app>.hf.space; le impostazioni le vede solo chi l'ha pubblicata.
  { host: /^(www\.)?huggingface\.co$/, path: /^\/spaces\/[^/]+\/[^/]+(?=\/|$)(?!\/settings(\/|$))/, owner: /^\/spaces\/[^/]+\/[^/]+/, platform: 'Hugging Face Spaces' },
  { host: /^ia\d+\.us\.archive\.org$/, owner: /^\/[^/]+\/items\/[^/]+/, platform: 'archive.org' },
  { host: /^(www\.)?archive\.org$/, path: /^\/download\//, owner: /^\/download\/[^/]+/, platform: 'archive.org' },
  // Una pagina di Notion si apre con qualunque titolo davanti al suo codice: conta il codice, non il titolo.
  { host: /^(www\.)?notion\.so$/, path: /^\/(?!(login|signup)(\/|$))[^/]+/, owner: (p) => { const s = p.split('/')[1] || ''; const id = /[0-9a-f]{32}$/i.exec(s); return '/' + (id ? id[0].toLowerCase() : s); }, platform: 'Notion' },
  { host: /^(www\.)?canva\.com$/, path: /^\/design\//, owner: /^\/design\/[^/]+/, platform: 'Canva' },
  // Indirizzi per percorso: s3.amazonaws.com/<secchio>/<file>, storage.googleapis.com/<secchio>/<file>.
  { host: S3, path: /^\/[^/]+\/./, owner: /^\/[^/]+/, platform: 'Amazon S3' },
  { host: /^(storage|firebasestorage)\.googleapis\.com$/, path: /^\/[^/]+\/./, owner: /^(\/v0\/b)?\/[^/]+/, platform: 'Google Cloud Storage' },
];

function hostedEntry(host, path) {
  // `sites.google.com.` è lo stesso sito: col punto finale la pagina passava per la piattaforma in whitelist.
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  const p = String(path || '/');
  return HOSTED.find((x) => x.host.test(h) && (!x.path || x.path.test(p))) || null;
}

// Il percorso che dice QUALE pagina è, per verdetto, conferme e conto: dove la pagina sta in un parametro, tutti i
// questionari avrebbero lo stesso percorso e il giudizio su uno varrebbe per gli altri.
function pagePath(host, url) {
  let u;
  try { u = new URL(String(url)); } catch (_) { return '/'; }
  const r = hostedEntry(host, u.pathname);
  if (!r || !r.query) return u.pathname;
  const id = [...u.searchParams].filter(([k]) => k.toLowerCase() === r.query).map(([, v]) => r.query + '=' + encodeURIComponent(v));
  return id.length ? u.pathname + '?' + id.join('&') : u.pathname;
}

function hostedPlatform(host, path) {
  const r = hostedEntry(host, path);
  return r ? r.platform : null;
}

// Il proprietario di una pagina ospitata, come percorso ('/secchio'); null se la pagina non è ospitata.
function hostedOwner(host, path) {
  const r = hostedEntry(host, path);
  if (!r) return null;
  const p = String(path || '/');
  if (typeof r.owner === 'function') return r.owner(p);
  const m = r.owner.exec(p);
  return m ? m[0] : '';
}

module.exports = { WHITELIST, isWhitelisted, hostedPlatform, hostedOwner, pagePath };
