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

const EXTRA = [
  // Motori / portali
  'bing.com', 'duckduckgo.com', 'wikipedia.org', 'wikimedia.org',
  'reddit.com', 'quora.com', 'medium.com', 'stackoverflow.com',
  'stackexchange.com',
  // Google properties
  'youtube.com', 'youtu.be', 'google.co.uk', 'google.de', 'google.fr',
  'google.es', 'android.com', 'chromium.org', 'gstatic.com',
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

module.exports = { WHITELIST, isWhitelisted };
