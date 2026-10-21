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

  // I marchi più imitati nelle truffe d'Europa e d'America, oltre a quelli sopra: banche, spedizioni, servizi.
  { token: 'citibank', display: 'Citi', domains: ['citi.com', 'citibank.com', 'citibankonline.com', 'citigroup.com'] },
  { token: 'americanexpress', display: 'American Express', domains: ['americanexpress.com', 'aexp.com', 'americanexpress.it', 'americanexpress.co.uk'] },
  { token: 'mastercard', display: 'Mastercard', domains: ['mastercard.com', 'mastercard.us', 'mastercard.it', 'mastercard.co.uk', 'mastercard.de'] },
  { token: 'capitalone', display: 'Capital One', domains: ['capitalone.com', 'capitalone.co.uk', 'capitalone.ca'] },
  { token: 'jpmorgan', display: 'J.P. Morgan', domains: ['jpmorgan.com', 'jpmorganchase.com', 'chase.com'] },
  { token: 'usaa', display: 'USAA', domains: ['usaa.com'] },
  { token: 'navyfederal', display: 'Navy Federal', domains: ['navyfederal.org'] },
  { token: 'hsbc', display: 'HSBC', domains: ['hsbc.com', 'hsbc.co.uk', 'hsbc.com.hk', 'hsbc.fr', 'hsbc.com.mx', 'hsbc.com.au', 'hsbc.co.in', 'hsbc.ae', 'hsbc.com.sg', 'hsbc.ca', 'hsbc.de', 'hsbc.it', 'hsbcnet.com', 'hsbc.lk', 'hsbc.com.my', 'hsbc.com.cn', 'hsbc.co.jp', 'hsbc.com.tw', 'hsbc.co.kr', 'hsbc.com.ar', 'hsbc.com.br', 'hsbc.bm', 'hsbc.am', 'hsbc.com.mt', 'hsbc.gr', 'hsbc.ch', 'hsbc.co.id'] },
  { token: 'barclays', display: 'Barclays', domains: ['barclays.co.uk', 'barclays.com', 'barclays.it', 'barclays.de', 'barclays.fr'] },
  { token: 'barclaycard', display: 'Barclaycard', domains: ['barclaycard.co.uk', 'barclaycard.com', 'barclaycardus.com', 'barclaycard.de'] },
  { token: 'lloydsbank', display: 'Lloyds Bank', domains: ['lloydsbank.com', 'lloydsbank.co.uk', 'lloydsbankinggroup.com'] },
  { token: 'natwest', display: 'NatWest', domains: ['natwest.com', 'natwestgroup.com', 'natwestinternational.com'] },
  { token: 'halifax', display: 'Halifax', domains: ['halifax.co.uk', 'halifax-online.co.uk'] },
  { token: 'santander', display: 'Santander', domains: ['santander.com', 'santander.co.uk', 'santander.it', 'santander.de', 'santander.pl', 'santander.pt', 'santander.com.br', 'santander.com.mx', 'santander.cl', 'santander.com.ar', 'santander.com.uy', 'santanderbank.com', 'santanderconsumer.it', 'santanderconsumer.com', 'santanderconsumer.de', 'santanderconsumer.es', 'bancosantander.es', 'santanderpb.com'] },
  { token: 'bbva', display: 'BBVA', domains: ['bbva.com', 'bbva.es', 'bbva.mx', 'bbva.it', 'bbva.pe', 'bbva.com.co', 'bbva.com.ar', 'bbva.pt', 'bbva.ch', 'bbvaopenmind.com', 'bbvaresearch.com'] },
  { token: 'caixabank', display: 'CaixaBank', domains: ['caixabank.es', 'caixabank.com'] },
  { token: 'deutschebank', display: 'Deutsche Bank', domains: ['db.com', 'deutsche-bank.de', 'deutsche-bank.es', 'deutsche-bank.it', 'deutschebank.be'] },
  { token: 'sparkasse', display: 'Sparkasse', domains: ['sparkasse.de', 'sparkasse.at', 'sparkasse.it', 'sparkasse.net', 's-bausparkasse.at', 'sparkassen-finanzportal.de', 'erstebank.at'] },
  { token: 'commerzbank', display: 'Commerzbank', domains: ['commerzbank.de', 'commerzbank.com'] },
  { token: 'volksbank', display: 'Volksbank', domains: ['volksbank.de', 'volksbank.at', 'volksbank.it', 'vr.de'] },
  { token: 'postbank', display: 'Postbank', domains: ['postbank.de'] },
  { token: 'bnpparibas', display: 'BNP Paribas', domains: ['bnpparibas.com', 'bnpparibas.fr', 'bnpparibas.it', 'bnpparibas.be', 'bnpparibas.de', 'bnpparibas.es', 'bnpparibas.pl', 'bnpparibas.co.uk', 'bnl.it', 'bnpparibasfortis.be', 'bnpparibas-am.com', 'bnpparibas-pf.com'] },
  { token: 'creditagricole', display: 'Crédit Agricole', domains: ['credit-agricole.fr', 'credit-agricole.com', 'credit-agricole.it', 'creditagricole.it', 'ca-cib.com', 'credit-agricole.pl'] },
  { token: 'societegenerale', display: 'Société Générale', domains: ['societegenerale.com', 'societegenerale.fr', 'sg.fr', 'societegenerale.de', 'societegenerale.it'] },
  { token: 'laposte', display: 'La Poste', domains: ['laposte.fr', 'laposte.net', 'laposte.com', 'labanquepostale.fr', 'labanquepostale.com', 'lapostegroupe.com'] },
  { token: 'labanquepostale', display: 'La Banque Postale', domains: ['labanquepostale.fr', 'labanquepostale.com'] },
  { token: 'ameli', display: 'Assurance Maladie (ameli)', domains: ['ameli.fr'] },
  { token: 'impots', display: 'impots.gouv.fr', domains: ['impots.gouv.fr'] },
  { token: 'hmrc', display: 'HMRC', domains: ['hmrc.gov.uk', 'tax.service.gov.uk'] },
  { token: 'ing', display: 'ING', domains: ['ing.com', 'ing.it', 'ing.de', 'ing.nl', 'ing.be', 'ing.es', 'ing.fr', 'ing.pl', 'ing.ro', 'ing.com.au', 'ing.lu', 'ing.at'] },
  { token: 'rabobank', display: 'Rabobank', domains: ['rabobank.nl', 'rabobank.com', 'rabobank.co.nz', 'rabobank.com.au'] },
  { token: 'abnamro', display: 'ABN AMRO', domains: ['abnamro.nl', 'abnamro.com', 'abnamro.de'] },
  { token: 'unicaja', display: 'Unicaja', domains: ['unicajabanco.es', 'unicaja.es'] },
  { token: 'n26', display: 'N26', domains: ['n26.com'] },
  { token: 'bunq', display: 'bunq', domains: ['bunq.com', 'bunq.me'] },
  { token: 'klarna', display: 'Klarna', domains: ['klarna.com', 'klarna.net', 'klarnaservices.com'] },
  { token: 'afterpay', display: 'Afterpay', domains: ['afterpay.com', 'afterpay.com.au'] },
  { token: 'satispay', display: 'Satispay', domains: ['satispay.com'] },
  { token: 'westernunion', display: 'Western Union', domains: ['westernunion.com', 'wu.com', 'westernunion.it', 'westernunion.co.uk', 'westernunion.de', 'westernunion.fr'] },
  { token: 'moneygram', display: 'MoneyGram', domains: ['moneygram.com'] },
  { token: 'cashapp', display: 'Cash App', domains: ['cash.app', 'cashapp.com', 'squareup.com', 'block.xyz'] },
  { token: 'zelle', display: 'Zelle', domains: ['zellepay.com', 'zelle.com'] },
  { token: 'interac', display: 'Interac', domains: ['interac.ca'] },
  { token: 'desjardins', display: 'Desjardins', domains: ['desjardins.com'] },
  { token: 'scotiabank', display: 'Scotiabank', domains: ['scotiabank.com', 'scotiaonline.scotiabank.com', 'scotiabank.ca'] },
  { token: 'rbcroyalbank', display: 'RBC Royal Bank', domains: ['rbcroyalbank.com', 'rbc.com'] },
  { token: 'commbank', display: 'CommBank', domains: ['commbank.com.au', 'netbank.com.au', 'cba.com.au'] },
  { token: 'westpac', display: 'Westpac', domains: ['westpac.com.au', 'westpac.co.nz', 'westpac.com'] },
  { token: 'auspost', display: 'Australia Post', domains: ['auspost.com.au'] },
  { token: 'nubank', display: 'Nubank', domains: ['nubank.com.br', 'nu.com.mx', 'nubank.com'] },
  { token: 'itau', display: 'Itaú', domains: ['itau.com.br', 'itau.com', 'itau.cl', 'itau.com.uy', 'itau.com.py', 'itau.co'] },
  { token: 'bradesco', display: 'Bradesco', domains: ['bradesco.com.br', 'bradesco.com', 'bradescoseguros.com.br'] },
  { token: 'mercadolibre', display: 'Mercado Libre', domains: ['mercadolibre.com', 'mercadolibre.com.ar', 'mercadolibre.com.mx', 'mercadolibre.cl', 'mercadolibre.com.co', 'mercadolibre.com.pe', 'mercadolibre.com.uy', 'mercadolivre.com.br', 'mercadopago.com', 'mercadopago.com.ar', 'mercadopago.com.br', 'mercadopago.com.mx'] },
  { token: 'mercadopago', display: 'Mercado Pago', domains: ['mercadopago.com', 'mercadopago.com.ar', 'mercadopago.com.br', 'mercadopago.com.mx', 'mercadopago.cl', 'mercadolibre.com'] },
  { token: 'rakuten', display: 'Rakuten', domains: ['rakuten.co.jp', 'rakuten.com', 'rakuten.fr', 'rakuten.de', 'rakuten.it', 'rakuten.tv', 'rakuten-bank.co.jp', 'rakuten-card.co.jp', 'rakuten-sec.co.jp', 'rakuten.ne.jp', 'r10s.jp'] },

  // Banche e servizi italiani più imitati
  { token: 'bancobpm', display: 'Banco BPM', domains: ['bancobpm.it', 'webank.it'] },
  { token: 'bper', display: 'BPER Banca', domains: ['bper.it', 'bpergroup.net', 'bperbanca.it'] },
  { token: 'fineco', display: 'Fineco', domains: ['finecobank.com', 'fineco.it'] },
  { token: 'mediolanum', display: 'Banca Mediolanum', domains: ['bancamediolanum.it', 'mediolanum.it', 'mediolanum.com', 'mediolanumgestionefondi.it'] },
  { token: 'montepaschi', display: 'Monte dei Paschi', domains: ['mps.it', 'gruppomps.it', 'montepaschi.it'] },
  { token: 'credem', display: 'Credem', domains: ['credem.it'] },
  { token: 'chebanca', display: 'CheBanca!', domains: ['chebanca.it'] },
  { token: 'widiba', display: 'Widiba', domains: ['widiba.it'] },
  { token: 'isybank', display: 'isybank', domains: ['isybank.com'] },
  { token: 'bancoposta', display: 'BancoPosta', domains: ['poste.it', 'posteitaliane.it'] },
  { token: 'postepay', display: 'Postepay', domains: ['postepay.it', 'poste.it', 'posteitaliane.it'] },
  { token: 'inps', display: 'INPS', domains: ['inps.it', 'inps.gov.it'] },
  { token: 'agenziaentrate', display: 'Agenzia delle Entrate', domains: ['agenziaentrate.gov.it', 'agenziaentrate.it', 'agenziaentrateriscossione.gov.it'] },
  { token: 'pagopa', display: 'pagoPA', domains: ['pagopa.it', 'pagopa.gov.it'] },
  { token: 'aruba', display: 'Aruba', domains: ['aruba.it', 'arubapec.it', 'arubabusiness.it', 'arubacloud.com', 'arubacloud.it', 'aruba.com', 'arubanetworks.com'] },
  { token: 'register', display: 'Register.it', domains: ['register.it', 'register.com'] },
  { token: 'enel', display: 'Enel', domains: ['enel.it', 'enel.com', 'enelx.com', 'enel.es', 'enelgreenpower.com', 'enelenergia.it', 'servizioelettriconazionale.it'] },
  { token: 'telepass', display: 'Telepass', domains: ['telepass.com', 'telepass.it'] },
  { token: 'trenitalia', display: 'Trenitalia', domains: ['trenitalia.com', 'trenitalia.it', 'fsitaliane.it', 'lefrecce.it'] },
  { token: 'italotreno', display: 'Italo', domains: ['italotreno.it', 'italotreno.com'] },
  { token: 'vodafone', display: 'Vodafone', domains: ['vodafone.com', 'vodafone.it', 'vodafone.co.uk', 'vodafone.de', 'vodafone.es', 'vodafone.pt', 'vodafone.nl', 'vodafone.ie', 'vodafone.gr', 'vodafone.com.tr', 'vodafone.ro', 'vodafone.cz', 'vodafone.hu', 'vodafone.al', 'vodafone.com.au', 'vodafone.co.nz', 'vodafone.in', 'vodafone.qa', 'vodafone.com.eg'] },
  { token: 'windtre', display: 'WindTre', domains: ['windtre.it', 'windtrebusiness.it'] },
  { token: 'iliad', display: 'Iliad', domains: ['iliad.it', 'iliad.fr', 'iliad.pl'] },
  { token: 'fastweb', display: 'Fastweb', domains: ['fastweb.it', 'fastweb.com'] },
  { token: 'subito', display: 'Subito', domains: ['subito.it'] },
  { token: 'esselunga', display: 'Esselunga', domains: ['esselunga.it', 'esselungaacasa.it'] },

  // Spedizioni
  { token: 'dhl', display: 'DHL', domains: ['dhl.com', 'dhl.de', 'dhl.it', 'dhl.co.uk', 'dhl.fr', 'dhl.es', 'dhl.nl', 'dhl.be', 'dhl.ch', 'dhl.at', 'dhl.pl', 'dhl.cz', 'dhl.se', 'dhl.dk', 'dhl.fi', 'dhl.pt', 'dhl.ie', 'dhl.us', 'dhl.ca', 'dhl.com.au', 'dhl.com.mx', 'dhl.com.br', 'dhl.co.in', 'dhl.co.jp', 'dhlparcel.nl', 'dhlparcel.co.uk', 'dhlparcel.es', 'dhlparcel.be', 'dhlecommerce.com', 'dhl-usa.com', 'deutschepost.de', 'dpdhl.com', 'dhlexpress.com', 'dhlexpress.it', 'dhlexpresscommerce.com', 'dhlecs.com', 'dhlglobalmail.com', 'dhl-news.com', 'logistics.dhl'] },
  { token: 'fedex', display: 'FedEx', domains: ['fedex.com', 'fedex.it', 'fedex.de', 'fedex.co.uk', 'fedex.fr', 'fedex.ca', 'fedex.com.au', 'fedex.com.br', 'fedex.com.mx'] },
  { token: 'usps', display: 'USPS', domains: ['usps.com', 'usps.gov', 'uspsoig.gov', 'uspis.gov'] },
  { token: 'royalmail', display: 'Royal Mail', domains: ['royalmail.com', 'royalmail.co.uk', 'royalmailgroup.com', 'parcelforce.com'] },
  { token: 'evri', display: 'Evri', domains: ['evri.com'] },
  { token: 'correos', display: 'Correos', domains: ['correos.es', 'correos.com', 'correosexpress.com', 'correos.cl', 'correosdemexico.gob.mx'] },
  { token: 'postnl', display: 'PostNL', domains: ['postnl.nl', 'postnl.com', 'postnl.be'] },
  { token: 'inpost', display: 'InPost', domains: ['inpost.pl', 'inpost.it', 'inpost.co.uk', 'inpost.eu', 'inpost.es', 'inpost.pt', 'inpost.fr'] },
  { token: 'chronopost', display: 'Chronopost', domains: ['chronopost.fr', 'chronopost.com'] },
  { token: 'colissimo', display: 'Colissimo', domains: ['colissimo.fr', 'laposte.fr'] },
  { token: 'canadapost', display: 'Canada Post', domains: ['canadapost.ca', 'canadapost-postescanada.ca', 'postescanada.ca'] },
  { token: 'bartolini', display: 'BRT', domains: ['brt.it', 'bartolini.it'] },

  // Negozi, viaggi, intrattenimento
  { token: 'alibaba', display: 'Alibaba', domains: ['alibaba.com', 'alibabacloud.com', 'alibaba-inc.com', 'alibabagroup.com', 'alicdn.com', '1688.com'] },
  { token: 'walmart', display: 'Walmart', domains: ['walmart.com', 'walmart.ca', 'walmart.com.mx', 'walmartimages.com', 'walmart.org', 'walmartcareers.com'] },
  { token: 'costco', display: 'Costco', domains: ['costco.com', 'costco.ca', 'costco.co.uk', 'costco.com.mx', 'costco.co.jp', 'costco.com.au', 'costco.es', 'costco.fr', 'costco.is', 'costco.co.kr', 'costco.com.tw', 'costcotravel.com', 'costcobusinessdelivery.com'] },
  { token: 'bestbuy', display: 'Best Buy', domains: ['bestbuy.com', 'bestbuy.ca'] },
  { token: 'etsy', display: 'Etsy', domains: ['etsy.com', 'etsy.me', 'etsystatic.com'] },
  { token: 'zalando', display: 'Zalando', domains: ['zalando.it', 'zalando.de', 'zalando.com', 'zalando.fr', 'zalando.es', 'zalando.co.uk', 'zalando.nl', 'zalando.be', 'zalando.at', 'zalando.ch', 'zalando.pl', 'zalando.se', 'zalando.dk', 'zalando.fi', 'zalando.no', 'zalando.cz', 'zalando-lounge.com', 'zalando-prive.it', 'zalando.net'] },
  { token: 'vinted', display: 'Vinted', domains: ['vinted.com', 'vinted.it', 'vinted.fr', 'vinted.de', 'vinted.es', 'vinted.co.uk', 'vinted.nl', 'vinted.be', 'vinted.pl', 'vinted.cz', 'vinted.lt', 'vinted.at', 'vinted.pt', 'vinted.se', 'vinted.net'] },
  { token: 'ikea', display: 'IKEA', domains: ['ikea.com', 'ikea.it', 'ikea.net', 'ikea.de', 'ikea.co.uk', 'ikea.fr', 'ikea.es', 'ikea.cn', 'ikea.co.jp', 'ingka.com'] },
  { token: 'lidl', display: 'Lidl', domains: ['lidl.it', 'lidl.de', 'lidl.com', 'lidl.fr', 'lidl.es', 'lidl.co.uk', 'lidl.nl', 'lidl.be', 'lidl.at', 'lidl.ch', 'lidl.pl', 'lidl.cz', 'lidl.ie', 'lidl.pt', 'lidl-shop.nl', 'lidl-reisen.de', 'lidl-travel.it'] },
  { token: 'carrefour', display: 'Carrefour', domains: ['carrefour.fr', 'carrefour.it', 'carrefour.com', 'carrefour.es', 'carrefour.be', 'carrefour.com.br', 'carrefour.pl', 'carrefour.ro', 'carrefour.com.ar'] },
  { token: 'decathlon', display: 'Decathlon', domains: ['decathlon.it', 'decathlon.fr', 'decathlon.com', 'decathlon.de', 'decathlon.es', 'decathlon.co.uk', 'decathlon.be', 'decathlon.nl', 'decathlon.pl', 'decathlon.pt', 'decathlon.ch', 'decathlon.at', 'decathlon.ca', 'decathlon.in'] },
  { token: 'booking', display: 'Booking.com', domains: ['booking.com', 'bstatic.com', 'bookingholdings.com'] },
  { token: 'airbnb', display: 'Airbnb', domains: ['airbnb.com', 'airbnb.it', 'airbnb.co.uk', 'airbnb.de', 'airbnb.fr', 'airbnb.es', 'airbnb.ca', 'airbnb.com.au', 'airbnb.com.br', 'airbnb.mx', 'airbnb.nl', 'airbnb.ch', 'airbnb.at', 'airbnb.be', 'airbnb.ie', 'airbnb.pt', 'airbnb.jp', 'airbnb.co.in', 'airbnbapi.com', 'muscache.com'] },
  { token: 'expedia', display: 'Expedia', domains: ['expedia.com', 'expedia.it', 'expedia.co.uk', 'expedia.de', 'expedia.fr', 'expedia.es', 'expedia.ca', 'expedia.com.au', 'expediagroup.com'] },
  { token: 'ryanair', display: 'Ryanair', domains: ['ryanair.com'] },
  { token: 'easyjet', display: 'easyJet', domains: ['easyjet.com'] },
  { token: 'lufthansa', display: 'Lufthansa', domains: ['lufthansa.com', 'lufthansagroup.com', 'lufthansa-technik.com', 'miles-and-more.com'] },
  { token: 'spotify', display: 'Spotify', domains: ['spotify.com', 'scdn.co', 'spotifycdn.com', 'spotify.design', 'spotify.net'] },
  { token: 'disney', display: 'Disney', domains: ['disney.com', 'disney.it', 'disney.co.uk', 'disney.de', 'disney.fr', 'disney.es', 'disneyplus.com', 'disneystore.com', 'disneystore.it', 'disneyland.com', 'disneylandparis.com', 'disneyworld.com', 'disneycareers.com', 'disneyinternational.com', 'disney-plus.net', 'disneyplus.it', 'thewaltdisneycompany.com'] },
  { token: 'hbomax', display: 'HBO Max', domains: ['hbomax.com', 'max.com', 'hbo.com'] },
  { token: 'primevideo', display: 'Prime Video', domains: ['primevideo.com', 'amazon.com'] },
  { token: 'youtube', display: 'YouTube', domains: ['youtube.com', 'youtu.be', 'ytimg.com', 'youtube-nocookie.com', 'youtubekids.com', 'withyoutube.com', 'youtubeeducation.com', 'youtubego.com'] },
  { token: 'roblox', display: 'Roblox', domains: ['roblox.com', 'rbxcdn.com', 'roblox.qq.com', 'robloxlabs.com'] },
  { token: 'epicgames', display: 'Epic Games', domains: ['epicgames.com', 'unrealengine.com', 'fortnite.com', 'epicgames.dev'] },
  { token: 'fortnite', display: 'Fortnite', domains: ['fortnite.com', 'epicgames.com'] },
  { token: 'playstation', display: 'PlayStation', domains: ['playstation.com', 'playstation.net', 'sonyentertainmentnetwork.com', 'playstation.it'] },
  { token: 'xbox', display: 'Xbox', domains: ['xbox.com', 'xboxlive.com', 'microsoft.com'] },
  { token: 'nintendo', display: 'Nintendo', domains: ['nintendo.com', 'nintendo.co.jp', 'nintendo.it', 'nintendo.co.uk', 'nintendo.de', 'nintendo.fr', 'nintendo.es', 'nintendo.net', 'nintendo.eu', 'nintendo.com.au', 'nintendo-europe.com'] },
  { token: 'snapchat', display: 'Snapchat', domains: ['snapchat.com', 'snap.com', 'sc-cdn.net', 'snapkit.com'] },
  { token: 'pinterest', display: 'Pinterest', domains: ['pinterest.com', 'pinterest.it', 'pinterest.co.uk', 'pinterest.de', 'pinterest.fr', 'pinterest.es', 'pinterest.ca', 'pinterest.com.au', 'pinterest.jp', 'pinimg.com'] },
  { token: 'reddit', display: 'Reddit', domains: ['reddit.com', 'redd.it', 'redditmedia.com', 'redditstatic.com', 'redditinc.com'] },
  { token: 'hotmail', display: 'Hotmail', domains: ['hotmail.com', 'hotmail.it', 'hotmail.co.uk', 'hotmail.de', 'hotmail.fr', 'hotmail.es', 'live.com', 'outlook.com', 'microsoft.com'] },
  { token: 'onedrive', display: 'OneDrive', domains: ['onedrive.com', 'onedrive.live.com', 'live.com', 'microsoft.com', 'sharepoint.com', '1drv.ms'] },
  { token: 'sharepoint', display: 'SharePoint', domains: ['sharepoint.com', 'microsoft.com', 'sharepointonline.com'] },
  { token: 'skype', display: 'Skype', domains: ['skype.com', 'microsoft.com'] },
  { token: 'docusign', display: 'DocuSign', domains: ['docusign.com', 'docusign.net'] },
  { token: 'adobe', display: 'Adobe', domains: ['adobe.com', 'adobe.io', 'adobelogin.com', 'adobecc.com', 'adobe.net', 'adobedtm.com', 'typekit.net', 'acrobat.com', 'adobestock.com', 'adobeexchange.com'] },
  { token: 'wetransfer', display: 'WeTransfer', domains: ['wetransfer.com', 'we.tl', 'wetransfer.net'] },
  { token: 'webex', display: 'Webex', domains: ['webex.com', 'cisco.com', 'webex.it'] },
  { token: 'salesforce', display: 'Salesforce', domains: ['salesforce.com', 'force.com', 'salesforce-sites.com', 'sfdcstatic.com', 'salesforceliveagent.com', 'trailhead.com'] },
  { token: 'okta', display: 'Okta', domains: ['okta.com', 'oktacdn.com', 'okta-emea.com', 'oktapreview.com'] },
  { token: 'godaddy', display: 'GoDaddy', domains: ['godaddy.com', 'secureserver.net', 'godaddysites.com'] },
  { token: 'namecheap', display: 'Namecheap', domains: ['namecheap.com'] },
  { token: 'verizon', display: 'Verizon', domains: ['verizon.com', 'verizonwireless.com', 'vzw.com', 'verizon.net'] },
  { token: 'tmobile', display: 'T-Mobile', domains: ['t-mobile.com', 't-mobile.de', 't-mobile.nl', 't-mobile.cz', 't-mobile.pl', 'tmobile.com'] },
  { token: 'xfinity', display: 'Xfinity', domains: ['xfinity.com', 'comcast.net', 'comcast.com'] },
  { token: 'telekom', display: 'Telekom', domains: ['telekom.de', 'telekom.com', 't-online.de', 'telekom.hu', 'telekom.sk'] },
  { token: 'swisscom', display: 'Swisscom', domains: ['swisscom.ch', 'swisscom.com'] },
  { token: 'mcafee', display: 'McAfee', domains: ['mcafee.com'] },
  { token: 'norton', display: 'Norton', domains: ['norton.com', 'nortonlifelock.com', 'gen.com', 'symantec.com'] },
  { token: 'chatgpt', display: 'ChatGPT', domains: ['chatgpt.com', 'openai.com', 'oaistatic.com', 'oaiusercontent.com'] },
  { token: 'openai', display: 'OpenAI', domains: ['openai.com', 'chatgpt.com'] },

  // Crypto
  { token: 'trezor', display: 'Trezor', domains: ['trezor.io'] },
  { token: 'trustwallet', display: 'Trust Wallet', domains: ['trustwallet.com'] },
  { token: 'opensea', display: 'OpenSea', domains: ['opensea.io'] },
  { token: 'uniswap', display: 'Uniswap', domains: ['uniswap.org', 'uniswap.io'] },
  { token: 'pancakeswap', display: 'PancakeSwap', domains: ['pancakeswap.finance'] },
  { token: 'walletconnect', display: 'WalletConnect', domains: ['walletconnect.com', 'walletconnect.org', 'reown.com'] },
  { token: 'bitpanda', display: 'Bitpanda', domains: ['bitpanda.com'] },
  { token: 'kucoin', display: 'KuCoin', domains: ['kucoin.com'] },
  { token: 'bybit', display: 'Bybit', domains: ['bybit.com'] },
  { token: 'bitget', display: 'Bitget', domains: ['bitget.com'] },
  { token: 'bitfinex', display: 'Bitfinex', domains: ['bitfinex.com'] },
  { token: 'robinhood', display: 'Robinhood', domains: ['robinhood.com'] },
  { token: 'blockchain', display: 'Blockchain.com', domains: ['blockchain.com', 'blockchain.info'] },
  { token: 'phantom', display: 'Phantom', domains: ['phantom.app', 'phantom.com'] },
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
