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
//   gestori — chi usa il nome per conto del marchio senza esserne il sito (i gestori SPID accreditati): lì il
//             nome non è un'imitazione, ma il dominio non entra nella whitelist.
//
// La lista è volutamente corta e curata: pochi brand ad altissimo valore, per
// tenere bassi i falsi positivi. Allungarla è sicuro finché i token restano
// parole distintive (evita token generici tipo "pay" o "mail" da soli).
// È l'unico elenco: la usa anche l'avviso sui link del tasto destro (#725.8).

'use strict';

const BRANDS = [
  // Pagamenti / finanza
  { token: 'paypal', display: 'PayPal', domains: ['paypal.com', 'paypal.me', 'paypal.it', 'paypal.de', 'paypal.fr', 'paypal.es', 'paypal.co.uk', 'paypalobjects.com', 'paypal-communication.com', 'paypal-community.com'] },
  { token: 'stripe', display: 'Stripe', domains: ['stripe.com', 'stripe.network', 'stripe.dev'] },
  { token: 'venmo', display: 'Venmo', domains: ['venmo.com'] },
  { token: 'wise', display: 'Wise', domains: ['wise.com', 'transferwise.com'] },
  { token: 'revolut', display: 'Revolut', domains: ['revolut.com', 'revolut.me'] },
  { token: 'chase', display: 'Chase', domains: ['chase.com', 'jpmorganchase.com'] },
  { token: 'wellsfargo', display: 'Wells Fargo', domains: ['wellsfargo.com', 'wf.com'] },
  { token: 'bankofamerica', display: 'Bank of America', domains: ['bankofamerica.com'] },
  { token: 'unicredit', display: 'UniCredit', domains: ['unicredit.it', 'unicreditgroup.eu', 'unicredit.eu', 'unicredit.ro', 'unicreditbank.cz', 'unicreditbank.hu', 'unicreditbank.si', 'unicreditbank.rs', 'unicreditbank.ba', 'unicreditbulbank.bg'] },
  { token: 'intesa', display: 'Intesa Sanpaolo', domains: ['intesasanpaolo.com', 'intesasanpaolovita.it', 'intesasanpaoloassicura.com', 'intesasanpaoloprivatebanking.it'] },
  { token: 'intesasanpaolo', display: 'Intesa Sanpaolo', domains: ['intesasanpaolo.com', 'intesasanpaolovita.it', 'intesasanpaoloassicura.com', 'intesasanpaoloprivatebanking.it'] },
  { token: 'isybank', display: 'Isybank', domains: ['isybank.com', 'isybank.it'] },
  { token: 'poste', display: 'Poste Italiane', domains: ['poste.it', 'posteitaliane.it', 'postemobile.it', 'postevita.it', 'postel.it'] },
  { token: 'bancoposta', display: 'Poste Italiane', domains: ['poste.it', 'posteitaliane.it'] },
  { token: 'nexi', display: 'Nexi', domains: ['nexi.it', 'nexigroup.com'] },
  { token: 'bper', display: 'BPER Banca', domains: ['bper.it'] },
  { token: 'bancobpm', display: 'Banco BPM', domains: ['bancobpm.it'] },
  { token: 'bnl', display: 'BNL', domains: ['bnl.it'] },
  { token: 'montepaschi', display: 'Monte dei Paschi di Siena', domains: ['mps.it', 'gruppomps.it'] },
  { token: 'mediolanum', display: 'Banca Mediolanum', domains: ['bancamediolanum.it', 'mediolanum.com', 'mediolanum.it'] },
  { token: 'fineco', display: 'Fineco', domains: ['finecobank.com', 'fineco.it'] },

  // Enti e servizi italiani imitati nelle mail truffa
  { token: 'inps', display: 'INPS', domains: ['inps.it'] },
  { token: 'agenziaentrate', display: 'Agenzia delle Entrate', domains: ['agenziaentrate.gov.it', 'agenziaentrateriscossione.gov.it'] },
  { token: 'agenziadelleentrate', display: 'Agenzia delle Entrate', domains: ['agenziaentrate.gov.it', 'agenziaentrateriscossione.gov.it'] },
  // Le pagine d'accesso SPID stanno sui domini dei gestori (spid.register.it, loginspid.infocamere.it): #725.8.
  { token: 'spid', display: 'SPID', domains: ['spid.gov.it'],
    gestori: ['aruba.it', 'infocert.it', 'intesa.it', 'lepida.it', 'namirialtsp.com', 'poste.it', 'register.it', 'sieltecloud.it',
      'tim.it', 'intesigroup.com', 'teamsystem.com', 'eht.eu', 'infocamere.it'] },
  { token: 'aruba', display: 'Aruba', domains: ['aruba.it', 'arubapec.it', 'arubacloud.com', 'cloud.it'] },
  { token: 'telepass', display: 'Telepass', domains: ['telepass.com'] },
  { token: 'brt', display: 'BRT', domains: ['brt.it'] },
  { token: 'gls', display: 'GLS', domains: ['gls-italy.com', 'gls-group.eu', 'gls-group.com', 'gls-pakete.de', 'gls-us.com', 'gls-canada.com',
    'gls-spain.es', 'gls-portugal.pt', 'gls-hungary.com', 'gls-czech.com', 'gls-slovakia.sk', 'gls-croatia.com', 'gls-slovenia.com', 'gls-romania.ro'] },
  { token: 'dhl', display: 'DHL', domains: ['dhl.com', 'dhl.it', 'dhl.de', 'dhl.co.uk', 'express.dhl', 'dhlparcel.nl', 'dhlparcel.co.uk', 'dhlparcel.be', 'dhlparcel.es'] },

  // Crypto
  { token: 'coinbase', display: 'Coinbase', domains: ['coinbase.com'] },
  { token: 'binance', display: 'Binance', domains: ['binance.com', 'binance.us'] },
  { token: 'metamask', display: 'MetaMask', domains: ['metamask.io'] },
  { token: 'kraken', display: 'Kraken', domains: ['kraken.com'] },
  { token: 'ledger', display: 'Ledger', domains: ['ledger.com', 'ledgerwallet.com'] },

  // Email / account / cloud
  { token: 'google', display: 'Google', domains: ['google.com', 'google.it', 'google.co', 'gmail.com', 'googlemail.com', 'googleblog.blogspot.com', 'google.ch', 'google.at', 'google.nl', 'google.be', 'google.pl', 'google.pt', 'google.ca', 'google.com.au', 'google.co.jp', 'google.com.br', 'google.co.in', 'google.co.uk', 'google.de', 'google.fr', 'google.es', 'google.se', 'google.dk', 'google.no', 'google.fi', 'google.ie', 'google.gr', 'google.ro', 'google.hu', 'google.cz', 'google.sk', 'google.si', 'google.hr', 'google.lu', 'google.com.mx', 'google.com.ar', 'google.com.tr', 'google.co.za', 'googleusercontent.com', 'googleapis.com', 'googlevideo.com', 'googlesyndication.com', 'googleadservices.com', 'googletagmanager.com', 'google-analytics.com'] },
  { token: 'gmail', display: 'Gmail', domains: ['gmail.com', 'google.com'] },
  { token: 'microsoft', display: 'Microsoft', domains: ['microsoft.com', 'live.com', 'office.com', 'office365.com', 'microsoft.sharepoint.com', 'microsoftonline.com', 'microsoft365.com', 'cloud.microsoft', 'microsoft.net', 'microsoftonline-p.com', 'microsoftstore.com'] },
  { token: 'outlook', display: 'Outlook', domains: ['outlook.com', 'live.com', 'microsoft.com'] },
  { token: 'office365', display: 'Microsoft 365', domains: ['office.com', 'office365.com', 'microsoft.com', 'microsoft365.com'] },
  { token: 'apple', display: 'Apple', domains: ['apple.com', 'icloud.com', 'me.com', 'apple.co', 'apple.news', 'cdn-apple.com', 'apple-cloudkit.com'] },
  { token: 'icloud', display: 'iCloud', domains: ['icloud.com', 'apple.com', 'icloud.com.cn', 'icloud-content.com'] },
  { token: 'dropbox', display: 'Dropbox', domains: ['dropbox.com', 'dropboxusercontent.com', 'dropboxstatic.com', 'dropboxapi.com'] },
  { token: 'yahoo', display: 'Yahoo', domains: ['yahoo.com', 'yahoo.it', 'yahoo.co.jp', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'yahoo.es', 'yahoo.net'] },
  { token: 'proton', display: 'Proton', domains: ['proton.me', 'protonmail.com', 'protonmail.ch', 'protonvpn.com', 'proton.ch'] },

  // Social / comunicazione
  { token: 'facebook', display: 'Facebook', domains: ['facebook.com', 'fb.com', 'facebook.net', 'facebookmail.com', 'fbcdn.net'] },
  { token: 'instagram', display: 'Instagram', domains: ['instagram.com', 'instagr.am', 'cdninstagram.com', 'instagram-engineering.com'] },
  { token: 'whatsapp', display: 'WhatsApp', domains: ['whatsapp.com', 'whatsapp.net', 'wa.me'] },
  { token: 'twitter', display: 'X (Twitter)', domains: ['twitter.com', 'x.com', 't.co', 'twimg.com'] },
  { token: 'linkedin', display: 'LinkedIn', domains: ['linkedin.com', 'lnkd.in', 'licdn.com'] },
  { token: 'tiktok', display: 'TikTok', domains: ['tiktok.com', 'tiktokcdn.com', 'tiktokv.com'] },
  { token: 'telegram', display: 'Telegram', domains: ['telegram.org', 't.me', 'telegram.me', 'telegra.ph', 'telegram.dog'] },
  { token: 'discord', display: 'Discord', domains: ['discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media'] },
  { token: 'netflix', display: 'Netflix', domains: ['netflix.com', 'netflix.net', 'netflixtechblog.com'] },
  { token: 'youtube', display: 'YouTube', domains: ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'youtubekids.com', 'youtube.it', 'youtube.de', 'youtube.fr', 'youtube.es', 'youtube.co.uk', 'youtube.ch', 'youtube.at', 'youtube.nl', 'youtube.be', 'youtube.pl', 'youtube.pt', 'youtube.ca', 'youtube.com.br', 'youtube.co.jp', 'youtube.com.au'] },
  { token: 'steam', display: 'Steam', domains: ['steampowered.com', 'steamcommunity.com', 'steamstatic.com', 'steamgames.com', 'steamdeck.com', 'steamusercontent.com'] },

  // Shopping
  { token: 'amazon', display: 'Amazon', domains: ['amazon.com', 'amazon.it', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.es', 'amazon.nl', 'amazon.ca', 'amazon.se', 'amazon.pl', 'amazon.ae', 'amazon.sg', 'amazon.in', 'amazon.co.jp', 'amazon.com.au', 'amazon.com.br', 'amazon.com.mx', 'amazon.com.tr', 'amazon.eg', 'amazon.sa', 'amazon.cn', 'amazoncognito.com', 'amazon.jobs', 'amazon.science', 'aboutamazon.com', 'aboutamazon.it', 'aboutamazon.co.uk', 'aboutamazon.de', 'aboutamazon.fr', 'aboutamazon.es', 'media-amazon.com', 'ssl-images-amazon.com', 'amazonses.com', 'amazontrust.com'] },
  { token: 'ebay', display: 'eBay', domains: ['ebay.com', 'ebay.it', 'ebay.de', 'ebay.co.uk', 'ebay.fr', 'ebay.es', 'ebay.ca', 'ebay.com.au', 'ebay.at', 'ebay.ch', 'ebay.nl', 'ebay.be', 'ebay.ie', 'ebay.pl', 'ebayinc.com', 'ebaystatic.com', 'ebayimg.com'] },
  { token: 'aliexpress', display: 'AliExpress', domains: ['aliexpress.com', 'aliexpress.us', 'aliexpress.ru'] },
  { token: 'shopify', display: 'Shopify', domains: ['shopify.com', 'myshopify.com', 'shopify.dev'] },

  // Dev / lavoro
  { token: 'github', display: 'GitHub', domains: ['github.com', 'github.io', 'github.dev', 'githubusercontent.com', 'githubassets.com', 'githubstatus.com', 'githubapp.com'] },
  { token: 'gitlab', display: 'GitLab', domains: ['gitlab.com', 'gitlab.io', 'gitlab-static.net'] },
];

// Parole vere che contengono un marchio o ne distano una lettera: non sono imitazioni (imposte, cloud, mail, post.ch).
// Ricavate dalle parole più usate in italiano e in inglese; una parola che un truffatore userebbe (amazons) non ci va.
const PAROLE = [
  'papal',
  'strip', 'strips', 'strike', 'stirpe', 'stripes', 'striped', 'strive', 'stride', 'strife', 'tripe', 'pinstripe',
  'vengo', 'vento', 'vendo', 'venom',
  'otherwise', 'likewise', 'unwise', 'wiser', 'wisely', 'wisest', 'clockwise', 'streetwise', 'bitwise',
  'revolt', 'revolution', 'revolutions', 'revolutionary',
  'case', 'chose', 'phase', 'cease', 'chased', 'chases', 'chaser', 'chasers', 'chaste', 'chasm', 'chaise', 'chasse',
  'purchase', 'purchased', 'purchases',
  'intera', 'intesi', 'inteso', 'intese', 'intensa',
  'post', 'posta', 'posti', 'posto', 'posts', 'posse', 'pose', 'oste', 'ponte', 'porte', 'foste', 'peste', 'piste',
  'posate', 'coste', 'soste', 'paste', 'poster', 'posters', 'posted', 'posteri', 'posteriore', 'posteriori',
  'posterior', 'posterity', 'preposterous', 'imposter', 'posteggio', 'posteggi', 'imposte', 'proposte', 'risposte',
  'disposte', 'opposte', 'esposte', 'composte', 'supposte', 'riposte', 'apposte', 'deposte',
  'banconota',
  'nexity', 'nexium',
  'finance',
  'ledge', 'ledgers', 'lodger',
  'googled', 'goggle',
  'mail', 'email', 'gail', 'grail',
  'apply', 'ample', 'apples', 'applet', 'appleby', 'applejack', 'pineapple', 'pineapples', 'grapple', 'snapple',
  'cloud',
  'proto', 'protons', 'protone', 'protoni', 'photon',
  'twister', 'titter',
  'linked', 'linkin',
  'telegraph', 'telegraaf', 'telegrafo', 'telegrafi', 'telegramma', 'telegrammi', 'telegrams',
  'discard', 'discordia', 'discordant',
  'team', 'stem', 'seam', 'steal', 'steak', 'stead', 'stream', 'steamy', 'steamed', 'steamer', 'steamers',
  'steaming', 'steamboat', 'steampunk',
  'amazonas', 'amazonia', 'amazonian',
  'spider', 'spiders', 'spiderman', 'spidey', 'spidi',
  'ruba', 'araba',
  'telecast', 'telepace', 'telepath',
  'glsl',
];

// Indice per lookup veloce: eTLD+1 legittimo → brand (per non flaggare il vero).
const LEGIT_DOMAINS = new Map();
for (const b of BRANDS) {
  for (const d of b.domains) LEGIT_DOMAINS.set(d, b);
}

// Vero se l'eTLD+1 dato è un dominio legittimo di un brand noto.
function isLegitBrandDomain(registrable) {
  return LEGIT_DOMAINS.has(registrable);
}

module.exports = { BRANDS, PAROLE, LEGIT_DOMAINS, isLegitBrandDomain };
