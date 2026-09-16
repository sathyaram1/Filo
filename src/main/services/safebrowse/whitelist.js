// Whitelist (stage 2): lista curata di eTLD+1 noti e fidati per IDENTITÀ, con confronto ESATTO sull'eTLD+1 normalizzato — un sosia ha sempre un eTLD+1 diverso e non combacia mai.
// Se combacia si saltano i controlli di impersonazione e l'LLM, ma NON certifica la sicurezza: i controlli indipendenti dal contenuto (certificato, contenuto misto, download, filtro contenuti) girano comunque.
// Include tutti i domini legittimi dei brand, così il sito vero non si auto-segnala, più i siti più trafficati in IT/EN. Allungarla è sicuro.

'use strict';

const { BRANDS } = require('./brands');

const EXTRA = [
  'bing.com', 'duckduckgo.com', 'wikipedia.org', 'wikimedia.org',
  'reddit.com', 'quora.com', 'medium.com', 'stackoverflow.com',
  'stackexchange.com',
  // Domini ufficiali che contengono "google": senza, il match combosquat li segnalerebbe.
  'youtube.com', 'youtu.be', 'google.co.uk', 'google.de', 'google.fr',
  'google.es', 'android.com', 'chromium.org', 'gstatic.com',
  'googleusercontent.com', 'googleapis.com', 'googletagmanager.com',
  'google-analytics.com', 'ggpht.com', 'doubleclick.net', 'withgoogle.com',
  'goo.gl', 'recaptcha.net',
  // CDN e infrastruttura di altri brand: contengono il token del brand ma sono ufficiali.
  'fbcdn.net', 'cdninstagram.com', 'licdn.com', 'twimg.com',
  'paypalobjects.com', 'icloud-content.com',
  'bing.net', 'msn.com', 'skype.com', 'xbox.com', 'windows.com',
  'sharepoint.com', 'onedrive.com', 'azure.com', 'visualstudio.com',
  'gitlab.com', 'bitbucket.org', 'npmjs.com', 'pypi.org', 'cloudflare.com',
  'jsdelivr.net', 'unpkg.com', 'vercel.app', 'netlify.app', 'heroku.com',
  'digitalocean.com', 'aws.amazon.com', 'amazonaws.com',
  'bbc.com', 'bbc.co.uk', 'cnn.com', 'nytimes.com', 'theguardian.com',
  'repubblica.it', 'corriere.it', 'ilsole24ore.com', 'ansa.it', 'rai.it',
  'gazzetta.it', 'lastampa.it',
  'spotify.com', 'twitch.tv', 'primevideo.com', 'disneyplus.com',
  'soundcloud.com', 'vimeo.com',
  'notion.so', 'slack.com', 'zoom.us', 'trello.com', 'atlassian.com',
  'figma.com', 'canva.com', 'adobe.com', 'wordpress.com', 'wordpress.org',
  'mozilla.org', 'archive.org', 'imdb.com',
  'gov.it', 'agid.gov.it', 'inps.it', 'agenziaentrate.gov.it',
  'spid.gov.it', 'pagopa.it', 'governo.it',
  'openai.com', 'anthropic.com', 'claude.ai', 'chatgpt.com',
  'huggingface.co', 'perplexity.ai', 'gemini.google.com',
];

const WHITELIST = new Set();
for (const b of BRANDS) for (const d of b.domains) WHITELIST.add(d);
for (const d of EXTRA) WHITELIST.add(d);

function isWhitelisted(registrable) {
  return !!registrable && WHITELIST.has(registrable);
}

module.exports = { WHITELIST, isWhitelisted };
