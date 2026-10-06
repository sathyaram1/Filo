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

// Le pagine degli account del marchio su GitHub Pages: lì un nome utente appartiene a uno solo, quindi sono sue (#732).
const gh = (...account) => account.map((a) => a + '.github.io');

const BRANDS = [
  // Pagamenti / finanza
  { token: 'paypal', display: 'PayPal', domains: ['paypal.com', 'paypal.me', 'paypal.it', 'paypal.de', 'paypal.fr', 'paypal.es', 'paypal.co.uk', 'paypal-community.com', ...gh('paypal', 'krakenjs')] },
  { token: 'stripe', display: 'Stripe', domains: ['stripe.com', ...gh('stripe')] },
  { token: 'venmo', display: 'Venmo', domains: ['venmo.com'] },
  { token: 'wise', display: 'Wise', domains: ['wise.com', ...gh('transferwise')] },
  { token: 'revolut', display: 'Revolut', domains: ['revolut.com'] },
  { token: 'chase', display: 'Chase', domains: ['chase.com', ...gh('jpmorganchase')] },
  { token: 'wellsfargo', display: 'Wells Fargo', domains: ['wellsfargo.com'] },
  { token: 'bankofamerica', display: 'Bank of America', domains: ['bankofamerica.com'] },
  { token: 'unicredit', display: 'UniCredit', domains: ['unicredit.it', 'unicreditgroup.eu'] },
  { token: 'intesa', display: 'Intesa Sanpaolo', domains: ['intesasanpaolo.com'] },
  { token: 'intesasanpaolo', display: 'Intesa Sanpaolo', domains: ['intesasanpaolo.com'] },
  { token: 'poste', display: 'Poste Italiane', domains: ['poste.it', 'posteitaliane.it'] },
  { token: 'nexi', display: 'Nexi', domains: ['nexi.it'] },

  // Crypto
  { token: 'coinbase', display: 'Coinbase', domains: ['coinbase.com', ...gh('coinbase')] },
  { token: 'binance', display: 'Binance', domains: ['binance.com'] },
  { token: 'metamask', display: 'MetaMask', domains: ['metamask.io', ...gh('metamask')] },
  { token: 'kraken', display: 'Kraken', domains: ['kraken.com'] },
  { token: 'ledger', display: 'Ledger', domains: ['ledger.com', ...gh('ledgerhq')] },

  // Email / account / cloud
  { token: 'google', display: 'Google', domains: ['google.com', 'google.it', 'gmail.com', 'googlemail.com', 'googleblog.blogspot.com', 'google.ch', 'google.at', 'google.nl', 'google.be', 'google.pl', 'google.pt', 'google.ca', 'google.com.au', 'google.co.jp', 'google.com.br', 'google.co.in', 'google-developers.appspot.com',
    ...gh('google', 'google-research', 'google-deepmind', 'googlechromelabs', 'googlechrome', 'googlecloudplatform', 'googleapis',
      'googlesamples', 'googlefonts', 'googlemaps', 'googlecodelabs', 'googlecreativelab', 'googleworkspace', 'googlearchive')] },
  { token: 'gmail', display: 'Gmail', domains: ['gmail.com', 'google.com'] },
  { token: 'microsoft', display: 'Microsoft', domains: ['microsoft.com', 'live.com', 'office.com', 'office365.com', 'microsoft.sharepoint.com', 'microsoftonline.com', 'microsoft365.com', 'cloud.microsoft',
    ...gh('microsoft', 'microsoftdocs', 'microsoftedge', 'microsoftgraph', 'microsoftlearning')] },
  { token: 'outlook', display: 'Outlook', domains: ['outlook.com', 'live.com', 'microsoft.com'] },
  { token: 'office365', display: 'Microsoft 365', domains: ['office.com', 'office365.com', 'microsoft.com', 'microsoft365.com'] },
  { token: 'apple', display: 'Apple', domains: ['apple.com', 'icloud.com', 'me.com', ...gh('apple')] },
  { token: 'icloud', display: 'iCloud', domains: ['icloud.com', 'apple.com'] },
  { token: 'dropbox', display: 'Dropbox', domains: ['dropbox.com', 'dropboxusercontent.com', ...gh('dropbox')] },
  { token: 'yahoo', display: 'Yahoo', domains: ['yahoo.com', 'yahoo.it', ...gh('yahoo')] },
  { token: 'proton', display: 'Proton', domains: ['proton.me', 'protonmail.com', ...gh('protonmail')] },

  // Social / comunicazione
  { token: 'facebook', display: 'Facebook', domains: ['facebook.com', 'fb.com', ...gh('facebook', 'facebookresearch', 'facebookincubator', 'facebookexperimental', 'facebookarchive')] },
  { token: 'instagram', display: 'Instagram', domains: ['instagram.com', 'instagram-engineering.com', ...gh('instagram')] },
  { token: 'whatsapp', display: 'WhatsApp', domains: ['whatsapp.com', ...gh('whatsapp')] },
  { token: 'twitter', display: 'X (Twitter)', domains: ['twitter.com', 'x.com', ...gh('twitter', 'twitterdev')] },
  { token: 'linkedin', display: 'LinkedIn', domains: ['linkedin.com', ...gh('linkedin')] },
  { token: 'tiktok', display: 'TikTok', domains: ['tiktok.com'] },
  { token: 'telegram', display: 'Telegram', domains: ['telegram.org', 't.me'] },
  { token: 'discord', display: 'Discord', domains: ['discord.com', 'discord.gg', ...gh('discord')] },
  { token: 'netflix', display: 'Netflix', domains: ['netflix.com', ...gh('netflix')] },
  { token: 'steam', display: 'Steam', domains: ['steampowered.com', 'steamcommunity.com'] },

  // Shopping
  { token: 'amazon', display: 'Amazon', domains: ['amazon.com', 'amazon.it', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.es', 'amazon.nl', 'amazon.ca', 'amazon.se', 'amazon.pl', 'amazon.ae', 'amazon.sg', 'amazon.in', 'amazon.co.jp', 'amazon.com.au', 'amazon.com.br', 'amazoncognito.com', ...gh('amazon-science')] },
  { token: 'ebay', display: 'eBay', domains: ['ebay.com', 'ebay.it', 'ebay.de', 'ebay.co.uk', 'ebay.fr', 'ebay.es', 'ebay.ca', 'ebay.com.au', 'ebay.at', 'ebay.ch', 'ebay.nl', 'ebay.be', 'ebay.ie', 'ebay.pl', ...gh('ebay')] },
  { token: 'aliexpress', display: 'AliExpress', domains: ['aliexpress.com'] },
  { token: 'shopify', display: 'Shopify', domains: ['shopify.com', 'myshopify.com', ...gh('shopify')] },

  // Dev / lavoro
  { token: 'github', display: 'GitHub', domains: ['github.com', 'github.io', 'github.dev', ...gh('github', 'githubnext')] },
  { token: 'gitlab', display: 'GitLab', domains: ['gitlab.com', 'gitlab.io', 'gitlab-org.gitlab.io', 'gitlab-com.gitlab.io'] },
];

// Marchi che sono anche parole, o stanno dentro parole comuni (pineapple, otherwise, purchase, steampunk): contano
// solo da soli fra punti e trattini, o in una delle loro forme tipiche; gli altri anche attaccati (paypallogin) (#732).
// Elenco unico per il controllo all'apertura e per l'avviso sui link: un marchio nuovo che è una parola va aggiunto qui.
const MARCHI_PAROLA = new Map([
  ['apple', ['appleid', 'applepay', 'applesupport', 'applecare', 'appleaccount']],
  ['wise', ['transferwise', 'wisetransfer']],
  ['chase', ['chasebank', 'chaseonline']],
  ['steam', ['steamcommunity', 'steampowered', 'steamgift']],
  ['poste', ['posteitaliane', 'postepay', 'posteid']],
  ['kraken', ['krakenexchange']],
  ['ledger', ['ledgerlive', 'ledgerwallet']],
  ['stripe', ['stripepay', 'stripecheckout']],
  ['proton', ['protonmail', 'protonvpn']],
  ['intesa', ['intesasanpaolo']],
  ['revolut', []],
  ['nexi', ['nexipay']],
  ['discord', ['discordapp', 'discordnitro']],
  ['outlook', ['outlookweb', 'outlooklogin']],
  ['telegram', ['telegramweb']],
]);

// Vero se `nome` (un'etichetta o più, separate da punti) porta il marchio `token` secondo la regola sopra.
// `scheletro` porta ogni pezzo alla forma con cui si legge a schermo (omoglifi, sosia).
function nominaMarchio(nome, token, scheletro = (x) => x) {
  if (!nome || !token || token.length < 3) return false; // un nome di una o due lettere sta in ogni parola (x-plane)
  const tok = scheletro(token);
  const forme = MARCHI_PAROLA.get(token);
  if (forme) {
    const pezzi = nome.split(/[.-]/).filter(Boolean);
    return pezzi.some((p) => p === token || scheletro(p) === tok)
      || forme.some((f) => nome.includes(f) || pezzi.some((p) => scheletro(p).includes(scheletro(f))));
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
