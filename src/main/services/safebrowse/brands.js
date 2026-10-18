// Brand ad alto valore per il phishing: i bersagli che gli attaccanti imitano
// più spesso (banche/pagamenti, email, cloud, social, shopping, crypto).
//
// Ogni voce:
//   token   — la "parola del brand" minuscola, usata per:
//               • matching combosquat (token come label/sottostringa)
//               • matching confusable/typo (scheletro e distanza di edit sulla
//                 sola label di brand del dominio candidato)
//   display — nome leggibile per i messaggi d'avviso ("Questo non è PayPal")
//   domains — gli eTLD+1 LEGITTIMI del brand. Se il dominio candidato è uno di
//             questi, NON è impersonazione (è il sito vero).
//
// La lista è volutamente corta e curata: pochi brand ad altissimo valore, per
// tenere bassi i falsi positivi. Allungarla è sicuro finché i token restano
// parole distintive (evita token generici tipo "pay" o "mail" da soli).

'use strict';

const BRANDS = [
  // Pagamenti / finanza
  { token: 'paypal', display: 'PayPal', domains: ['paypal.com', 'paypal.me', 'paypal.it', 'paypal.de', 'paypal.fr', 'paypal.es', 'paypal.co.uk', 'paypal-community.com'] },
  { token: 'stripe', display: 'Stripe', domains: ['stripe.com'] },
  { token: 'venmo', display: 'Venmo', domains: ['venmo.com'] },
  { token: 'wise', display: 'Wise', domains: ['wise.com'] },
  { token: 'revolut', display: 'Revolut', domains: ['revolut.com'] },
  { token: 'chase', display: 'Chase', domains: ['chase.com'] },
  { token: 'wellsfargo', display: 'Wells Fargo', domains: ['wellsfargo.com'] },
  { token: 'bankofamerica', display: 'Bank of America', domains: ['bankofamerica.com'] },
  { token: 'unicredit', display: 'UniCredit', domains: ['unicredit.it', 'unicreditgroup.eu'] },
  { token: 'intesa', display: 'Intesa Sanpaolo', domains: ['intesasanpaolo.com'] },
  { token: 'intesasanpaolo', display: 'Intesa Sanpaolo', domains: ['intesasanpaolo.com'] },
  { token: 'poste', display: 'Poste Italiane', domains: ['poste.it', 'posteitaliane.it'] },
  { token: 'nexi', display: 'Nexi', domains: ['nexi.it'] },

  // Crypto
  { token: 'coinbase', display: 'Coinbase', domains: ['coinbase.com'] },
  { token: 'binance', display: 'Binance', domains: ['binance.com'] },
  { token: 'metamask', display: 'MetaMask', domains: ['metamask.io'] },
  { token: 'kraken', display: 'Kraken', domains: ['kraken.com'] },
  { token: 'ledger', display: 'Ledger', domains: ['ledger.com'] },

  // Email / account / cloud
  { token: 'google', display: 'Google', domains: ['google.com', 'google.it', 'gmail.com', 'googlemail.com', 'googleblog.blogspot.com', 'google.ch', 'google.at', 'google.nl', 'google.be', 'google.pl', 'google.pt', 'google.ca', 'google.com.au', 'google.co.jp', 'google.com.br', 'google.co.in', 'google-research.github.io', 'google-deepmind.github.io', 'google-developers.appspot.com'] },
  { token: 'gmail', display: 'Gmail', domains: ['gmail.com', 'google.com'] },
  { token: 'microsoft', display: 'Microsoft', domains: ['microsoft.com', 'live.com', 'office.com', 'office365.com', 'microsoft.sharepoint.com', 'microsoftonline.com', 'microsoft365.com', 'cloud.microsoft', 'officecdn-microsoft-com.akamaized.net'] },
  { token: 'outlook', display: 'Outlook', domains: ['outlook.com', 'live.com', 'microsoft.com'] },
  { token: 'office365', display: 'Microsoft 365', domains: ['office.com', 'office365.com', 'microsoft.com', 'microsoft365.com'] },
  { token: 'apple', display: 'Apple', domains: ['apple.com', 'icloud.com', 'me.com'] },
  { token: 'icloud', display: 'iCloud', domains: ['icloud.com', 'apple.com'] },
  { token: 'dropbox', display: 'Dropbox', domains: ['dropbox.com', 'dropboxusercontent.com'] },
  { token: 'yahoo', display: 'Yahoo', domains: ['yahoo.com', 'yahoo.it'] },
  { token: 'proton', display: 'Proton', domains: ['proton.me', 'protonmail.com'] },

  // Social / comunicazione
  { token: 'facebook', display: 'Facebook', domains: ['facebook.com', 'fb.com'] },
  { token: 'instagram', display: 'Instagram', domains: ['instagram.com', 'instagram-engineering.com'] },
  { token: 'whatsapp', display: 'WhatsApp', domains: ['whatsapp.com'] },
  { token: 'twitter', display: 'X (Twitter)', domains: ['twitter.com', 'x.com'] },
  { token: 'linkedin', display: 'LinkedIn', domains: ['linkedin.com'] },
  { token: 'tiktok', display: 'TikTok', domains: ['tiktok.com'] },
  { token: 'telegram', display: 'Telegram', domains: ['telegram.org', 't.me'] },
  { token: 'discord', display: 'Discord', domains: ['discord.com', 'discord.gg'] },
  { token: 'netflix', display: 'Netflix', domains: ['netflix.com'] },
  { token: 'steam', display: 'Steam', domains: ['steampowered.com', 'steamcommunity.com', 'steamcommunity-a.akamaihd.net', 'steamstore-a.akamaihd.net'] },

  // Shopping
  { token: 'amazon', display: 'Amazon', domains: ['amazon.com', 'amazon.it', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.es', 'amazon.nl', 'amazon.ca', 'amazon.se', 'amazon.pl', 'amazon.ae', 'amazon.sg', 'amazon.in', 'amazon.co.jp', 'amazon.com.au', 'amazon.com.br', 'amazoncognito.com', 'amazon-science.github.io'] },
  { token: 'ebay', display: 'eBay', domains: ['ebay.com', 'ebay.it', 'ebay.de', 'ebay.co.uk', 'ebay.fr', 'ebay.es', 'ebay.ca', 'ebay.com.au', 'ebay.at', 'ebay.ch', 'ebay.nl', 'ebay.be', 'ebay.ie', 'ebay.pl'] },
  { token: 'aliexpress', display: 'AliExpress', domains: ['aliexpress.com'] },
  { token: 'shopify', display: 'Shopify', domains: ['shopify.com', 'myshopify.com'] },

  // Dev / lavoro
  { token: 'github', display: 'GitHub', domains: ['github.com', 'github.io', 'github.dev'] },
  { token: 'gitlab', display: 'GitLab', domains: ['gitlab.com', 'gitlab.io'] },
];

// Gli altri indirizzi veri dei marchi: i loro siti sulle piattaforme (il nome lì è l'account del marchio) e i server
// di file e servizi. Uno che manca dà al sito vero l'avviso del suo stesso marchio (cdn.discordapp.com, google.github.io).
const ALTRI_INDIRIZZI = {
  google: [
    'google.github.io', 'googlechromelabs.github.io', 'googlechrome.github.io', 'googlecloudplatform.github.io',
    'googlesamples.github.io', 'googleapis.github.io', 'googlefonts.github.io', 'googlemaps.github.io',
    'googlecodelabs.github.io', 'googleworkspace.github.io', 'google-gemini.github.io',
    'googleonlinesecurity.blogspot.com', 'googlewebmastercentral.blogspot.com', 'googleresearch.blogspot.com',
    'googledevelopers.blogspot.com', 'googleappsupdates.blogspot.com', 'googlechromereleases.blogspot.com',
    'googleprojectzero.blogspot.com', 'googletesting.blogspot.com', 'googlecloudplatform.blogspot.com',
    'google.org', 'googledrive.com', 'googlevideo.com', 'googlesyndication.com', 'googleadservices.com', 'googlesource.com',
  ],
  microsoft: [
    'microsoft.github.io', 'microsoftedge.github.io', 'microsoftdocs.github.io',
    'microsoftonline-p.com', 'microsoftazuread-sso.com', 'microsoftstore.com',
  ],
  apple: ['apple.github.io', 'apple-cloudkit.com', 'apple-dns.net'],
  icloud: ['icloud.com.cn'],
  facebook: [
    'facebook.github.io', 'facebookresearch.github.io', 'facebookincubator.github.io', 'facebookexperimental.github.io',
    'facebook.net',
  ],
  instagram: ['instagram.github.io'],
  whatsapp: ['whatsapp.github.io', 'whatsapp.net'],
  twitter: ['twitter.github.io'],
  linkedin: ['linkedin.github.io', 'linkedin.cn'],
  tiktok: ['tiktok.github.io', 'tiktokcdn.com', 'tiktokv.com'],
  telegram: ['telegram.me', 'telegram.dog'],
  discord: [
    'discord.github.io', 'discordapp.com', 'discordapp.net', 'discord.media', 'discord.gift', 'discord.new', 'discord.co',
    'discord.dev',
  ],
  netflix: ['netflix.github.io', 'netflix-skunkworks.github.io', 'netflixtechblog.com'],
  steam: ['steam-chat.com'],
  paypal: ['paypal.github.io'],
  stripe: ['stripe.github.io'],
  amazon: ['amazontrust.com', 'amazonpay.com', 'amazon.jobs'],
  coinbase: ['coinbase.github.io'],
  binance: ['binance.github.io'],
  metamask: ['metamask.github.io'],
  proton: ['protonmail.github.io'],
  yahoo: ['yahoo.github.io', 'yahooapis.com', 'yahoo.co.jp'],
  dropbox: ['dropbox.github.io', 'dropboxapi.com', 'dropboxstatic.com'],
  shopify: ['shopify.github.io', 'shopify.dev'],
  github: [
    'github.github.io', 'github.blog', 'githubassets.com', 'githubstatus.com', 'githubcopilot.com',
    'github-releases.githubusercontent.com', 'github-cloud.s3.amazonaws.com',
    'github-production-user-asset-6210df.s3.amazonaws.com', 'github-production-release-asset-2e65be.s3.amazonaws.com',
    'github-production-repository-file-5c1aeb.s3.amazonaws.com',
  ],
  gitlab: ['gitlab-org.gitlab.io', 'gitlab-static.net'],
};
for (const b of BRANDS) b.domains.push(...(ALTRI_INDIRIZZI[b.token] || []));

// Marchi che sono anche parole, o stanno dentro parole comuni (pineapple, otherwise, purchase, steampunk): contano
// solo da soli fra punti e trattini, o in una delle loro forme tipiche; gli altri anche attaccati (paypallogin) (#732).
// Elenco unico per il controllo all'apertura e per l'avviso sui link: un marchio nuovo che è una parola va aggiunto qui.
const MARCHI_PAROLA = new Map([
  ['apple', ['appleid', 'applepay', 'applesupport', 'applecare', 'appleaccount']],
  ['wise', ['transferwise', 'wisetransfer']],
  ['chase', ['chasebank', 'chaseonline']],
  ['steam', ['steamcommunity', 'steampowered', 'steamgift', 'steamguard']],
  ['poste', ['posteitaliane', 'postepay', 'posteid']],
  ['kraken', ['krakenexchange', 'krakenpro']],
  ['ledger', ['ledgerlive', 'ledgerwallet']],
  ['stripe', ['stripepay', 'stripecheckout']],
  ['proton', ['protonmail', 'protonvpn']],
  ['intesa', ['intesasanpaolo', 'bancaintesa']],
  ['revolut', []],
  ['nexi', ['nexipay']],
  ['discord', ['discordapp', 'discordnitro']],
  ['outlook', ['outlookweb', 'outlooklogin']],
  ['telegram', ['telegramweb']],
]);
// La forma tipica di un sosia, per tutti i marchi-parola: il marchio con accanto solo queste parole, intere
// (krakenlogin, securechase, postespedizioni). Le radici italiane prendono la desinenza (rimborso, notifiche).
const PAROLE_TRUFFA = [
  'login', 'logon', 'signin', 'accedi', 'accesso', 'access', 'auth', 'verify', 'verifica', 'verification', 'secure',
  'security', 'sicurezza', 'account', 'conto', 'support', 'supporto', 'assistenza', 'help', 'service', 'servizi',
  'refund', 'rimbors', 'gift', 'nitro', 'promo', 'bonus', 'reward', 'premi', 'claim', 'giveaway', 'airdrop',
  'wallet', 'bank', 'banca', 'pay', 'pagament', 'billing', 'fattur', 'invoice', 'card', 'carta', 'online', 'update',
  'aggiorna', 'aggiornament', 'unlock', 'sblocc', 'recover', 'restore', 'recuper', 'confirm', 'conferm', 'alert',
  'avviso', 'notific', 'store', 'shop', 'trade', 'connect', 'sync', 'token', 'dispute', 'official', 'ufficial',
  'center', 'centre', 'centro', 'portal', 'mail', 'app', 'mobile', 'sms', 'otp', 'my',
  'spedizion', 'pacc', 'giacenz', 'consegn', 'tracking', 'delivery', 'parcel',
];
const DESINENZA = /^(?:s|h[ei]|[aeio])/;
const DESINENZA_IT = /^(?:h[ei]|[aeio])/;

// Vero se `s` è fatta solo di parole da truffa intere, e di numeri: «premier», «helper», «myers» non sono premi,
// help, my. Le parole prendono il plurale e la desinenza italiana (gifts, rimborso, notifiche); con `soloItaliane`
// solo la seconda.
function soloTruffa(s, soloItaliane = false, visti = new Map()) {
  if (!s) return true;
  if (!visti.has(s)) {
    const numero = /^\d+/.exec(s);
    const desinenza = soloItaliane ? DESINENZA_IT : DESINENZA;
    visti.set(s, (!!numero && soloTruffa(s.slice(numero[0].length), soloItaliane, visti))
      || PAROLE_TRUFFA.some((w) => {
        if (!s.startsWith(w)) return false;
        const resto = s.slice(w.length);
        const des = desinenza.exec(resto);
        return soloTruffa(resto, soloItaliane, visti) || (!!des && soloTruffa(resto.slice(des[0].length), soloItaliane, visti));
      }));
  }
  return visti.get(s);
}

// Un marchio-parola di quattro lettere sta dentro troppe parole, e wise è anche un suffisso (shopwise, likewise):
// conta solo davanti a parole da truffa, senza plurale inglese (wiselogin e nexirimborso sì, shopwise e wisecards no).
// Un numero da solo non è una parola da truffa: steam2024 è una festa della scienza, steamlogin2024 un sosia.
function attaccatoATruffa(pezzo, tok) {
  const parola = (x) => !/^\d*$/.test(x);
  if (tok.length < 5) {
    const dopo = pezzo.slice(tok.length);
    return pezzo.startsWith(tok) && parola(dopo) && soloTruffa(dopo, true);
  }
  for (let i = pezzo.indexOf(tok); i >= 0; i = pezzo.indexOf(tok, i + 1)) {
    const prima = pezzo.slice(0, i);
    const dopo = pezzo.slice(i + tok.length);
    if ((parola(prima) || parola(dopo)) && soloTruffa(prima) && soloTruffa(dopo)) return true;
  }
  return false;
}

// Gli errori di chi scrive in fretta, o di chi vuole sembrare il sito vero: una lettera in più o in meno, due vicine
// scambiate, una raddoppiata al posto della seguente, o una che a schermo ne sembra un'altra (communlty, povered).
const SOMIGLIANTI = new Set(['il', 'li', 'ij', 'ji', 'lj', 'jl', 'iy', 'yi', 'vw', 'wv', 'uv', 'vu', 'mn', 'nm']);
function costoScambio(f, j, c) {
  return SOMIGLIANTI.has(f[j] + c) || f[j - 1] === c || f[j + 1] === c ? 1 : 2;
}
function distanzaErrori(p, f) {
  const d = Array.from({ length: p.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= f.length; j++) d[0][j] = j;
  for (let i = 1; i <= p.length; i++) {
    for (let j = 1; j <= f.length; j++) {
      const sub = p[i - 1] === f[j - 1] ? 0 : costoScambio(f, j - 1, p[i - 1]);
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub);
      if (i > 1 && j > 1 && p[i - 1] === f[j - 2] && p[i - 2] === f[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[p.length][f.length];
}

// La forma tipica conta col seguito che vuole (steamcommunityoffer), ma davanti solo parole da truffa: in
// purchaseonline c'è chaseonline, ed è un'altra parola.
function formaIntera(pezzo, forma) {
  for (let i = pezzo.indexOf(forma); i >= 0; i = pezzo.indexOf(forma, i + 1)) {
    if (soloTruffa(pezzo.slice(0, i))) return true;
  }
  return false;
}

// La forma tipica con un errore, col marchio intero (steamcommunlty, posteitalia), e intorno solo parole da truffa
// (posteitaliaonline). Quante lettere può sbagliare dipende da quante ne ha oltre il marchio; con due sole, solo una
// al posto di un'altra, così posted non è posteid.
function formaConErrore(pezzo, forma, token) {
  const oltre = forma.length - token.length;
  const soglia = oltre >= 8 ? 2 : oltre >= 2 ? 1 : 0;
  if (!soglia || !pezzo.includes(token)) return false;
  const inizi = [];
  const fini = [];
  for (let k = 0; k <= pezzo.length; k++) {
    if (soloTruffa(pezzo.slice(0, k))) inizi.push(k);
    if (soloTruffa(pezzo.slice(k))) fini.push(k);
  }
  for (const a of inizi) {
    for (const b of fini) {
      const parte = pezzo.slice(a, b);
      if (parte === forma || !parte.includes(token) || Math.abs(parte.length - forma.length) > soglia) continue;
      if (oltre === 2 && parte.length !== forma.length) continue;
      if (distanzaErrori(parte, forma) <= soglia) return true;
    }
  }
  return false;
}

// Vero se `nome` (un'etichetta o più, separate da punti) porta il marchio `token` secondo la regola sopra.
// `scheletro` porta ogni pezzo alla forma con cui si legge a schermo (omoglifi, sosia).
function nominaMarchio(nome, token, scheletro = (x) => x) {
  if (!nome || !token || token.length < 3) return false; // un nome di una o due lettere sta in ogni parola (x-plane)
  const tok = scheletro(token);
  const forme = MARCHI_PAROLA.get(token);
  if (forme) {
    // Ogni pezzo com'è scritto (i numeri restano numeri) e come si legge (app1e è apple); marchi e forme sono già così.
    const letture = nome.split(/[.-]/).filter(Boolean).flatMap((p) => [p, scheletro(p)]);
    return letture.some((p) => p === token || attaccatoATruffa(p, token))
      || forme.some((f) => letture.some((p) => formaIntera(p, f) || formaConErrore(p, f, token)));
  }
  // Il trattino non spezza un marchio distintivo: pay-pal resta paypal.
  return nome.split('.').some((l) => { const unito = l.replace(/-/g, ''); return unito.includes(token) || scheletro(unito).includes(tok); });
}

// Indice per lookup veloce: eTLD+1 legittimo → brand (per non flaggare il vero).
const LEGIT_DOMAINS = new Map();
for (const b of BRANDS) {
  for (const d of b.domains) LEGIT_DOMAINS.set(d, b);
}

// Vero se l'eTLD+1 dato è un dominio legittimo di un brand noto.
function isLegitBrandDomain(registrable) {
  return LEGIT_DOMAINS.has(registrable);
}

module.exports = { BRANDS, LEGIT_DOMAINS, isLegitBrandDomain, MARCHI_PAROLA, nominaMarchio };
