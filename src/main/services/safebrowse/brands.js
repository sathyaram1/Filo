// Brand ad alto valore per il phishing: i bersagli che gli attaccanti imitano più spesso.
// `domains` sono gli eTLD+1 LEGITTIMI, che NON sono impersonazione.
// Lista corta per tenere bassi i falsi positivi: mai token generici come «pay» o «mail».

'use strict';

const BRANDS = [
  { token: 'paypal', display: 'PayPal', domains: ['paypal.com', 'paypal.me'] },
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

  { token: 'coinbase', display: 'Coinbase', domains: ['coinbase.com'] },
  { token: 'binance', display: 'Binance', domains: ['binance.com'] },
  { token: 'metamask', display: 'MetaMask', domains: ['metamask.io'] },
  { token: 'kraken', display: 'Kraken', domains: ['kraken.com'] },
  { token: 'ledger', display: 'Ledger', domains: ['ledger.com'] },

  { token: 'google', display: 'Google', domains: ['google.com', 'google.it', 'gmail.com', 'googlemail.com'] },
  { token: 'gmail', display: 'Gmail', domains: ['gmail.com', 'google.com'] },
  { token: 'microsoft', display: 'Microsoft', domains: ['microsoft.com', 'live.com', 'office.com', 'office365.com'] },
  { token: 'outlook', display: 'Outlook', domains: ['outlook.com', 'live.com', 'microsoft.com'] },
  { token: 'office365', display: 'Microsoft 365', domains: ['office.com', 'office365.com', 'microsoft.com'] },
  { token: 'apple', display: 'Apple', domains: ['apple.com', 'icloud.com', 'me.com'] },
  { token: 'icloud', display: 'iCloud', domains: ['icloud.com', 'apple.com'] },
  { token: 'dropbox', display: 'Dropbox', domains: ['dropbox.com'] },
  { token: 'yahoo', display: 'Yahoo', domains: ['yahoo.com', 'yahoo.it'] },
  { token: 'proton', display: 'Proton', domains: ['proton.me', 'protonmail.com'] },

  { token: 'facebook', display: 'Facebook', domains: ['facebook.com', 'fb.com'] },
  { token: 'instagram', display: 'Instagram', domains: ['instagram.com'] },
  { token: 'whatsapp', display: 'WhatsApp', domains: ['whatsapp.com'] },
  { token: 'twitter', display: 'X (Twitter)', domains: ['twitter.com', 'x.com'] },
  { token: 'linkedin', display: 'LinkedIn', domains: ['linkedin.com'] },
  { token: 'tiktok', display: 'TikTok', domains: ['tiktok.com'] },
  { token: 'telegram', display: 'Telegram', domains: ['telegram.org', 't.me'] },
  { token: 'discord', display: 'Discord', domains: ['discord.com', 'discord.gg'] },
  { token: 'netflix', display: 'Netflix', domains: ['netflix.com'] },
  { token: 'steam', display: 'Steam', domains: ['steampowered.com', 'steamcommunity.com'] },

  { token: 'amazon', display: 'Amazon', domains: ['amazon.com', 'amazon.it', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.es'] },
  { token: 'ebay', display: 'eBay', domains: ['ebay.com', 'ebay.it'] },
  { token: 'aliexpress', display: 'AliExpress', domains: ['aliexpress.com'] },
  { token: 'shopify', display: 'Shopify', domains: ['shopify.com'] },

  { token: 'github', display: 'GitHub', domains: ['github.com'] },
  { token: 'gitlab', display: 'GitLab', domains: ['gitlab.com'] },
];

// Indice eTLD+1 legittimo → brand, per non flaggare il sito vero.
const LEGIT_DOMAINS = new Map();
for (const b of BRANDS) {
  for (const d of b.domains) LEGIT_DOMAINS.set(d, b);
}

function isLegitBrandDomain(registrable) {
  return LEGIT_DOMAINS.has(registrable);
}

module.exports = { BRANDS, LEGIT_DOMAINS, isLegitBrandDomain };
