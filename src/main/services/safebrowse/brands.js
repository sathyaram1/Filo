// I marchi che le truffe imitano più spesso, coi loro indirizzi veri (`domains`, mai un'imitazione e fidati per
// identità in whitelist.js) e gli altri che ne portano il nome di diritto (`omonimi`, non fidati). L'elenco unico per
// l'apertura e per l'avviso sui link: chi imita chi lo giudica imitazioni.js. Un indirizzo qui si scrive solo se certo.

'use strict';

const BRANDS = [
  // Pagamenti / finanza
  { token: 'paypal', display: 'PayPal', domains: ['paypal.com', 'paypal.me', 'paypal.it', 'paypal.de', 'paypal.fr', 'paypal.es', 'paypal.co.uk', 'paypal-community.com', 'paypalobjects.com'] },
  { token: 'stripe', display: 'Stripe', domains: ['stripe.com', 'stripe.network', 'stripe.dev'] },
  { token: 'venmo', display: 'Venmo', domains: ['venmo.com'] },
  { token: 'wise', display: 'Wise', domains: ['wise.com', 'transferwise.com'] },
  { token: 'revolut', display: 'Revolut', domains: ['revolut.com', 'revolut.me'] },
  { token: 'chase', display: 'Chase', domains: ['chase.com', 'jpmorganchase.com'] },
  { token: 'wellsfargo', display: 'Wells Fargo', domains: ['wellsfargo.com', 'wf.com'] },
  { token: 'bankofamerica', display: 'Bank of America', domains: ['bankofamerica.com'] },
  { token: 'unicredit', display: 'UniCredit', domains: ['unicredit.it', 'unicreditgroup.eu', 'unicredit.eu', 'unicredit.ro', 'unicreditbank.cz', 'unicreditbank.hu', 'unicreditbank.si', 'unicreditbank.rs', 'unicreditbank.ba', 'unicreditbulbank.bg', 'unicredit.de', 'hypovereinsbank.de'] },
  { token: 'intesa', display: 'Intesa Sanpaolo', omonimi: ['intesa.it'], domains: ['intesasanpaolo.com', 'intesasanpaolovita.it', 'intesasanpaoloassicura.com', 'intesasanpaoloprivatebanking.it'] },
  { token: 'intesasanpaolo', display: 'Intesa Sanpaolo', domains: ['intesasanpaolo.com', 'intesasanpaolovita.it', 'intesasanpaoloassicura.com', 'intesasanpaoloprivatebanking.it'] },
  { token: 'poste', display: 'Poste Italiane', domains: ['poste.it', 'posteitaliane.it', 'postemobile.it', 'postevita.it', 'postel.it', 'postepay.it'] },
  { token: 'nexi', display: 'Nexi', domains: ['nexi.it', 'nexigroup.com'] },

  // Crypto
  { token: 'coinbase', display: 'Coinbase', domains: ['coinbase.com'] },
  { token: 'binance', display: 'Binance', domains: ['binance.com', 'binance.us'] },
  { token: 'metamask', display: 'MetaMask', domains: ['metamask.io'] },
  { token: 'kraken', display: 'Kraken', domains: ['kraken.com'] },
  { token: 'ledger', display: 'Ledger', domains: ['ledger.com', 'ledgerwallet.com'] },

  // Email / account / cloud
  { token: 'google', display: 'Google', domains: ['google.com', 'google.it', 'gmail.com', 'googlemail.com', 'googleblog.blogspot.com', 'google.ch', 'google.at', 'google.nl', 'google.be', 'google.pl', 'google.pt', 'google.ca', 'google.com.au', 'google.co.jp', 'google.com.br', 'google.co.in', 'google-research.github.io', 'google-deepmind.github.io', 'google-developers.appspot.com', 'google.co', 'google.co.uk', 'google.de', 'google.fr', 'google.es', 'google.se', 'google.dk', 'google.no', 'google.fi', 'google.ie', 'google.gr', 'google.ro', 'google.hu', 'google.cz', 'google.sk', 'google.si', 'google.hr', 'google.lu', 'google.com.mx', 'google.com.ar', 'google.com.tr', 'google.co.za', 'googleusercontent.com', 'googleapis.com', 'googletagmanager.com', 'google-analytics.com', 'googleblog.com'] },
  { token: 'gmail', display: 'Gmail', domains: ['gmail.com', 'google.com'] },
  { token: 'microsoft', display: 'Microsoft', domains: ['microsoft.com', 'live.com', 'office.com', 'office365.com', 'microsoft.sharepoint.com', 'microsoftonline.com', 'microsoft365.com', 'cloud.microsoft', 'officecdn-microsoft-com.akamaized.net', 'microsoft.net', 'microsoftonline-p.com'] },
  { token: 'outlook', display: 'Outlook', domains: ['outlook.com', 'live.com', 'microsoft.com'] },
  { token: 'office365', display: 'Microsoft 365', domains: ['office.com', 'office365.com', 'microsoft.com', 'microsoft365.com'] },
  { token: 'apple', display: 'Apple', domains: ['apple.com', 'icloud.com', 'me.com', 'apple.co', 'apple.news', 'cdn-apple.com'] },
  { token: 'icloud', display: 'iCloud', domains: ['icloud.com', 'apple.com', 'icloud-content.com'] },
  { token: 'dropbox', display: 'Dropbox', domains: ['dropbox.com', 'dropboxusercontent.com', 'dropbox.tech'] },
  { token: 'yahoo', display: 'Yahoo', domains: ['yahoo.com', 'yahoo.it', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'yahoo.es', 'yahoo.net'] },
  { token: 'proton', display: 'Proton', domains: ['proton.me', 'protonmail.com', 'protonmail.ch', 'protonvpn.com', 'proton.ch'] },

  // Social / comunicazione
  { token: 'facebook', display: 'Facebook', domains: ['facebook.com', 'fb.com', 'facebookmail.com', 'fbcdn.net'] },
  { token: 'instagram', display: 'Instagram', domains: ['instagram.com', 'instagram-engineering.com', 'instagr.am', 'cdninstagram.com'] },
  { token: 'whatsapp', display: 'WhatsApp', domains: ['whatsapp.com', 'wa.me'] },
  { token: 'twitter', display: 'X (Twitter)', domains: ['twitter.com', 'x.com', 't.co', 'twimg.com'] },
  { token: 'linkedin', display: 'LinkedIn', domains: ['linkedin.com', 'lnkd.in', 'licdn.com'] },
  { token: 'tiktok', display: 'TikTok', domains: ['tiktok.com'] },
  { token: 'telegram', display: 'Telegram', domains: ['telegram.org', 't.me', 'telegra.ph'] },
  { token: 'discord', display: 'Discord', domains: ['discord.com', 'discord.gg', 'discordstatus.com'] },
  { token: 'netflix', display: 'Netflix', domains: ['netflix.com', 'netflix.net', 'nflxvideo.net', 'nflximg.net', 'nflxext.com', 'netflixstudios.com'] },
  { token: 'steam', display: 'Steam', domains: ['steampowered.com', 'steamcommunity.com', 'steamcommunity-a.akamaihd.net', 'steamstore-a.akamaihd.net', 'steamstatic.com', 'steamgames.com', 'steamdeck.com', 'steamusercontent.com', 'steamuserimages-a.akamaihd.net', 'steamcdn-a.akamaihd.net'] },

  // Shopping
  { token: 'amazon', display: 'Amazon', domains: ['amazon.com', 'amazon.it', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.es', 'amazon.nl', 'amazon.ca', 'amazon.se', 'amazon.pl', 'amazon.ae', 'amazon.sg', 'amazon.in', 'amazon.co.jp', 'amazon.com.au', 'amazon.com.br', 'amazoncognito.com', 'amazon-science.github.io', 'amazon.com.mx', 'amazon.com.tr', 'amazon.eg', 'amazon.sa', 'amazon.cn', 'amazon.science', 'aboutamazon.com', 'aboutamazon.it', 'aboutamazon.co.uk', 'aboutamazon.de', 'aboutamazon.fr', 'aboutamazon.es', 'media-amazon.com', 'ssl-images-amazon.com', 'amazonses.com', 'amazon-adsystem.com', 'images-amazon.com'] },
  { token: 'ebay', display: 'eBay', domains: ['ebay.com', 'ebay.it', 'ebay.de', 'ebay.co.uk', 'ebay.fr', 'ebay.es', 'ebay.ca', 'ebay.com.au', 'ebay.at', 'ebay.ch', 'ebay.nl', 'ebay.be', 'ebay.ie', 'ebay.pl', 'ebayinc.com', 'ebaystatic.com', 'ebayimg.com', 'ebay.com.my'] },
  { token: 'aliexpress', display: 'AliExpress', domains: ['aliexpress.com', 'aliexpress.us', 'aliexpress.ru'] },
  { token: 'shopify', display: 'Shopify', domains: ['shopify.com', 'myshopify.com'] },

  // Dev / lavoro
  { token: 'github', display: 'GitHub', domains: ['github.com', 'github.io', 'github.dev', 'githubusercontent.com', 'githubapp.com', 'githubuniverse.com'] },
  { token: 'gitlab', display: 'GitLab', domains: ['gitlab.com', 'gitlab.io'] },

  // I marchi più imitati nelle truffe d'Europa e d'America, oltre a quelli sopra: banche, spedizioni, servizi.
  { token: 'citibank', display: 'Citi', domains: ['citi.com', 'citibank.com', 'citibankonline.com', 'citigroup.com'] },
  { token: 'americanexpress', display: 'American Express', domains: ['americanexpress.com', 'aexp.com', 'americanexpress.it', 'americanexpress.co.uk'] },
  { token: 'mastercard', display: 'Mastercard', domains: ['mastercard.com', 'mastercard.us', 'mastercard.it', 'mastercard.co.uk', 'mastercard.de'] },
  { token: 'capitalone', display: 'Capital One', domains: ['capitalone.com', 'capitalone.co.uk', 'capitalone.ca'] },
  { token: 'jpmorgan', display: 'J.P. Morgan', domains: ['jpmorgan.com', 'jpmorganchase.com', 'chase.com'] },
  { token: 'usaa', display: 'USAA', domains: ['usaa.com'] },
  { token: 'navyfederal', display: 'Navy Federal', domains: ['navyfederal.org'] },
  { token: 'hsbc', display: 'HSBC', domains: ['hsbc.com', 'hsbc.co.uk', 'hsbc.com.hk', 'hsbc.fr', 'hsbc.com.mx', 'hsbc.com.au', 'hsbc.co.in', 'hsbc.ae', 'hsbc.com.sg', 'hsbc.ca', 'hsbcnet.com', 'hsbc.com.my', 'hsbc.com.cn'] },
  { token: 'barclays', display: 'Barclays', domains: ['barclays.co.uk', 'barclays.com', 'barclays.it', 'barclays.de', 'barclays.fr'] },
  { token: 'barclaycard', display: 'Barclaycard', domains: ['barclaycard.co.uk', 'barclaycard.com', 'barclaycardus.com', 'barclaycard.de'] },
  { token: 'lloydsbank', display: 'Lloyds Bank', domains: ['lloydsbank.com', 'lloydsbank.co.uk', 'lloydsbankinggroup.com'] },
  { token: 'natwest', display: 'NatWest', domains: ['natwest.com', 'natwestgroup.com', 'natwestinternational.com'] },
  { token: 'halifax', display: 'Halifax', domains: ['halifax.co.uk', 'halifax-online.co.uk'] },
  { token: 'santander', display: 'Santander', domains: ['santander.com', 'santander.co.uk', 'santander.it', 'santander.de', 'santander.pl', 'santander.pt', 'santander.com.br', 'santander.com.mx', 'santander.cl', 'santander.com.ar', 'santanderbank.com', 'santanderconsumer.it', 'santanderconsumer.com', 'santanderconsumer.de', 'santanderconsumer.es', 'bancosantander.es'] },
  { token: 'bbva', display: 'BBVA', domains: ['bbva.com', 'bbva.es', 'bbva.mx', 'bbva.it', 'bbva.pe', 'bbva.com.co', 'bbva.com.ar', 'bbvaopenmind.com', 'bbvaresearch.com'] },
  { token: 'caixabank', display: 'CaixaBank', domains: ['caixabank.es', 'caixabank.com'] },
  { token: 'deutschebank', display: 'Deutsche Bank', domains: ['db.com', 'deutsche-bank.de'] },
  { token: 'sparkasse', display: 'Sparkasse', domains: ['sparkasse.de', 'sparkasse.at', 'sparkasse.it'] },
  { token: 'commerzbank', display: 'Commerzbank', domains: ['commerzbank.de', 'commerzbank.com'] },
  { token: 'volksbank', display: 'Volksbank', domains: ['volksbank.de', 'volksbank.at', 'volksbank.it', 'vr.de'] },
  { token: 'postbank', display: 'Postbank', domains: ['postbank.de'] },
  { token: 'bnpparibas', display: 'BNP Paribas', domains: ['bnpparibas.com', 'bnpparibas.fr', 'bnpparibas.it', 'bnpparibas.be', 'bnpparibas.de', 'bnpparibas.es', 'bnpparibas.pl', 'bnpparibas.co.uk', 'bnl.it', 'bnpparibasfortis.be', 'bnpparibas-am.com', 'bnpparibas-pf.com'] },
  { token: 'creditagricole', display: 'Crédit Agricole', domains: ['credit-agricole.fr', 'credit-agricole.com', 'credit-agricole.it', 'ca-cib.com', 'credit-agricole.pl'] },
  { token: 'societegenerale', display: 'Société Générale', domains: ['societegenerale.com', 'societegenerale.fr', 'sg.fr'] },
  { token: 'laposte', display: 'La Poste', domains: ['laposte.fr', 'laposte.net', 'labanquepostale.fr', 'lapostegroupe.com'] },
  { token: 'labanquepostale', display: 'La Banque Postale', domains: ['labanquepostale.fr'] },
  { token: 'ameli', display: 'Assurance Maladie (ameli)', domains: ['ameli.fr'] },
  { token: 'impots', display: 'impots.gouv.fr', domains: ['impots.gouv.fr'] },
  { token: 'hmrc', display: 'HMRC', domains: ['hmrc.gov.uk', 'tax.service.gov.uk'] },
  { token: 'rabobank', display: 'Rabobank', domains: ['rabobank.nl', 'rabobank.com', 'rabobank.co.nz', 'rabobank.com.au'] },
  { token: 'abnamro', display: 'ABN AMRO', domains: ['abnamro.nl', 'abnamro.com'] },
  { token: 'unicaja', display: 'Unicaja', domains: ['unicajabanco.es'] },
  { token: 'n26', display: 'N26', domains: ['n26.com'] },
  { token: 'bunq', display: 'bunq', domains: ['bunq.com', 'bunq.me'] },
  { token: 'klarna', display: 'Klarna', domains: ['klarna.com', 'klarna.net'] },
  { token: 'afterpay', display: 'Afterpay', domains: ['afterpay.com', 'afterpay.com.au'] },
  { token: 'satispay', display: 'Satispay', domains: ['satispay.com'] },
  { token: 'westernunion', display: 'Western Union', domains: ['westernunion.com', 'wu.com', 'westernunion.it', 'westernunion.co.uk', 'westernunion.de', 'westernunion.fr'] },
  { token: 'moneygram', display: 'MoneyGram', domains: ['moneygram.com'] },
  { token: 'cashapp', display: 'Cash App', domains: ['cash.app', 'squareup.com', 'block.xyz'] },
  { token: 'zelle', display: 'Zelle', domains: ['zellepay.com'] },
  { token: 'interac', display: 'Interac', domains: ['interac.ca'] },
  { token: 'desjardins', display: 'Desjardins', domains: ['desjardins.com'] },
  { token: 'scotiabank', display: 'Scotiabank', domains: ['scotiabank.com'] },
  { token: 'rbcroyalbank', display: 'RBC Royal Bank', domains: ['rbcroyalbank.com', 'rbc.com'] },
  { token: 'commbank', display: 'CommBank', domains: ['commbank.com.au', 'netbank.com.au', 'cba.com.au'] },
  { token: 'westpac', display: 'Westpac', domains: ['westpac.com.au', 'westpac.co.nz', 'westpac.com'] },
  { token: 'auspost', display: 'Australia Post', domains: ['auspost.com.au'] },
  { token: 'nubank', display: 'Nubank', domains: ['nubank.com.br', 'nu.com.mx'] },
  { token: 'itau', display: 'Itaú', domains: ['itau.com.br', 'itau.com', 'itau.cl'] },
  { token: 'bradesco', display: 'Bradesco', domains: ['bradesco.com.br', 'bradescoseguros.com.br'] },
  { token: 'mercadolibre', display: 'Mercado Libre', domains: ['mercadolibre.com', 'mercadolibre.com.ar', 'mercadolibre.com.mx', 'mercadolibre.cl', 'mercadolibre.com.co', 'mercadolibre.com.pe', 'mercadolibre.com.uy', 'mercadolivre.com.br', 'mercadopago.com', 'mercadopago.com.ar', 'mercadopago.com.br', 'mercadopago.com.mx'] },
  { token: 'mercadopago', display: 'Mercado Pago', domains: ['mercadopago.com', 'mercadopago.com.ar', 'mercadopago.com.br', 'mercadopago.com.mx', 'mercadopago.cl', 'mercadolibre.com'] },
  { token: 'rakuten', display: 'Rakuten', domains: ['rakuten.co.jp', 'rakuten.com', 'rakuten.fr', 'rakuten.de', 'rakuten.it', 'rakuten.tv', 'rakuten-bank.co.jp', 'rakuten-card.co.jp', 'rakuten-sec.co.jp', 'rakuten.ne.jp', 'r10s.jp'] },

  // Banche e servizi italiani più imitati
  { token: 'bancobpm', display: 'Banco BPM', domains: ['bancobpm.it', 'webank.it'] },
  { token: 'bper', display: 'BPER Banca', domains: ['bper.it'] },
  { token: 'fineco', display: 'Fineco', domains: ['finecobank.com', 'fineco.it'], omonimi: ['finecooking.com'] },
  { token: 'mediolanum', display: 'Banca Mediolanum', domains: ['bancamediolanum.it'], omonimi: ['mediolanumforum.it'] },
  { token: 'montepaschi', display: 'Monte dei Paschi', domains: ['mps.it', 'gruppomps.it'] },
  { token: 'credem', display: 'Credem', domains: ['credem.it'] },
  { token: 'chebanca', display: 'CheBanca!', domains: ['chebanca.it'] },
  { token: 'widiba', display: 'Widiba', domains: ['widiba.it'] },
  { token: 'isybank', display: 'isybank', domains: ['isybank.com', 'isybank.it'] },
  { token: 'bnl', display: 'BNL', domains: ['bnl.it'], omonimi: ['bnl.gov'] },
  { token: 'agenziadelleentrate', display: 'Agenzia delle Entrate', domains: ['agenziaentrate.gov.it', 'agenziaentrate.it', 'agenziaentrateriscossione.gov.it'] },
  // I gestori dell'identità digitale usano il nome SPID sui loro siti: sono loro, non imitazioni.
  { token: 'spid', display: 'SPID', domains: ['spid.gov.it'], omonimi: ['aruba.it', 'infocert.it', 'intesa.it', 'lepida.it', 'namirialtsp.com', 'namirial.com', 'poste.it', 'register.it', 'sieltecloud.it', 'tim.it', 'intesigroup.com', 'teamsystem.com', 'eht.eu', 'infocamere.it', 'agid.gov.it', 'gov.it'] },
  { token: 'bancoposta', display: 'BancoPosta', domains: ['poste.it', 'posteitaliane.it'] },
  { token: 'postepay', display: 'Postepay', domains: ['postepay.it', 'poste.it', 'posteitaliane.it'] },
  { token: 'inps', display: 'INPS', domains: ['inps.it', 'inps.gov.it'] },
  { token: 'agenziaentrate', display: 'Agenzia delle Entrate', domains: ['agenziaentrate.gov.it', 'agenziaentrate.it', 'agenziaentrateriscossione.gov.it'] },
  { token: 'pagopa', display: 'pagoPA', domains: ['pagopa.it', 'pagopa.gov.it'] },
  { token: 'aruba', display: 'Aruba', domains: ['aruba.it', 'arubapec.it', 'arubabusiness.it', 'arubacloud.com', 'cloud.it'], omonimi: ['aruba.com', 'visitaruba.com', 'arubanetworks.com', 'arubainstanton.com'] },
  { token: 'enel', display: 'Enel', domains: ['enel.it', 'enel.com', 'enelx.com', 'enelgreenpower.com', 'enelenergia.it', 'servizioelettriconazionale.it'] },
  { token: 'telepass', display: 'Telepass', domains: ['telepass.com', 'telepass.it'] },
  { token: 'trenitalia', display: 'Trenitalia', domains: ['trenitalia.com', 'trenitalia.it', 'fsitaliane.it', 'lefrecce.it'] },
  { token: 'italotreno', display: 'Italo', domains: ['italotreno.it', 'italotreno.com'] },
  { token: 'vodafone', display: 'Vodafone', domains: ['vodafone.com', 'vodafone.it', 'vodafone.co.uk', 'vodafone.de', 'vodafone.es', 'vodafone.pt', 'vodafone.nl', 'vodafone.ie', 'vodafone.gr', 'vodafone.com.tr', 'vodafone.ro', 'vodafone.cz', 'vodafone.com.au', 'vodafone.co.nz'] },
  { token: 'windtre', display: 'WindTre', domains: ['windtre.it', 'windtrebusiness.it'] },
  { token: 'iliad', display: 'Iliad', domains: ['iliad.it', 'iliad.fr'] },
  { token: 'fastweb', display: 'Fastweb', domains: ['fastweb.it'] },
  { token: 'subito', display: 'Subito', domains: ['subito.it'] },
  { token: 'esselunga', display: 'Esselunga', domains: ['esselunga.it', 'esselungaacasa.it'] },

  // Spedizioni
  { token: 'dhl', display: 'DHL', domains: ['dhl.com', 'dhl.de', 'dhl.it', 'dhl.co.uk', 'dhl.fr', 'dhl.es', 'dhl.nl', 'dhl.be', 'dhl.ch', 'dhl.at', 'dhl.pl', 'dhl.cz', 'dhl.se', 'dhl.dk', 'dhl.fi', 'dhl.pt', 'dhl.ie', 'dhl.us', 'dhl.ca', 'dhl.com.au', 'dhl.com.mx', 'dhl.com.br', 'dhl.co.in', 'dhl.co.jp', 'dhlparcel.nl', 'dhlparcel.co.uk', 'deutschepost.de', 'dpdhl.com', 'logistics.dhl', 'express.dhl', 'dhlecommerce.co.uk'] },
  { token: 'fedex', display: 'FedEx', domains: ['fedex.com', 'fedex.it', 'fedex.de', 'fedex.co.uk', 'fedex.fr', 'fedex.ca', 'fedex.com.au', 'fedex.com.br', 'fedex.com.mx'] },
  { token: 'usps', display: 'USPS', domains: ['usps.com', 'uspsoig.gov', 'uspis.gov'] },
  { token: 'royalmail', display: 'Royal Mail', domains: ['royalmail.com', 'royalmailgroup.com', 'parcelforce.com'] },
  { token: 'evri', display: 'Evri', domains: ['evri.com'] },
  { token: 'correos', display: 'Correos', domains: ['correos.es', 'correosexpress.com', 'correos.cl', 'correosdemexico.gob.mx'] },
  { token: 'postnl', display: 'PostNL', domains: ['postnl.nl', 'postnl.be'] },
  { token: 'inpost', display: 'InPost', domains: ['inpost.pl', 'inpost.it', 'inpost.co.uk', 'inpost.eu'] },
  { token: 'chronopost', display: 'Chronopost', domains: ['chronopost.fr'] },
  { token: 'colissimo', display: 'Colissimo', domains: ['colissimo.fr', 'laposte.fr'] },
  { token: 'canadapost', display: 'Canada Post', domains: ['canadapost.ca', 'canadapost-postescanada.ca'] },
  { token: 'brt', display: 'BRT', domains: ['brt.it'] },
  { token: 'gls', display: 'GLS', domains: ['gls-italy.com', 'gls-group.eu', 'gls-group.com', 'gls-pakete.de', 'gls-us.com', 'gls-canada.com', 'gls-spain.es', 'gls-portugal.pt', 'gls-hungary.com', 'gls-czech.com', 'gls-slovakia.sk', 'gls-croatia.com', 'gls-slovenia.com', 'gls-romania.ro', 'gls-poland.com', 'gls-info.nl'] },

  // Negozi, viaggi, intrattenimento
  { token: 'alibaba', display: 'Alibaba', domains: ['alibaba.com', 'alibabacloud.com', 'alibaba-inc.com', 'alibabagroup.com', 'alicdn.com', '1688.com'] },
  { token: 'walmart', display: 'Walmart', domains: ['walmart.com', 'walmart.ca', 'walmart.com.mx', 'walmartimages.com', 'walmart.org', 'walmartcareers.com'] },
  { token: 'costco', display: 'Costco', domains: ['costco.com', 'costco.ca', 'costco.co.uk', 'costco.com.mx', 'costco.co.jp', 'costco.com.au', 'costco.es', 'costco.fr', 'costco.co.kr', 'costco.com.tw', 'costcotravel.com', 'costcobusinessdelivery.com'] },
  { token: 'bestbuy', display: 'Best Buy', domains: ['bestbuy.com', 'bestbuy.ca'] },
  { token: 'etsy', display: 'Etsy', domains: ['etsy.com', 'etsy.me', 'etsystatic.com'] },
  { token: 'zalando', display: 'Zalando', domains: ['zalando.it', 'zalando.de', 'zalando.com', 'zalando.fr', 'zalando.es', 'zalando.co.uk', 'zalando.nl', 'zalando.be', 'zalando.at', 'zalando.ch', 'zalando.pl', 'zalando.se', 'zalando.dk', 'zalando.fi', 'zalando.no', 'zalando.cz', 'zalando-lounge.com', 'zalando-prive.it', 'zalando.net'] },
  { token: 'vinted', display: 'Vinted', domains: ['vinted.com', 'vinted.it', 'vinted.fr', 'vinted.de', 'vinted.es', 'vinted.co.uk', 'vinted.nl', 'vinted.be', 'vinted.pl', 'vinted.cz', 'vinted.lt', 'vinted.at', 'vinted.pt', 'vinted.se', 'vinted.net'] },
  { token: 'ikea', display: 'IKEA', domains: ['ikea.com', 'ikea.it', 'ikea.net', 'ikea.de', 'ikea.co.uk', 'ikea.fr', 'ikea.es', 'ikea.cn', 'ikea.co.jp', 'ingka.com'] },
  { token: 'lidl', display: 'Lidl', domains: ['lidl.it', 'lidl.de', 'lidl.com', 'lidl.fr', 'lidl.es', 'lidl.co.uk', 'lidl.nl', 'lidl.be', 'lidl.at', 'lidl.ch', 'lidl.pl', 'lidl.cz', 'lidl.ie', 'lidl.pt', 'lidl-shop.nl', 'lidl-reisen.de'] },
  { token: 'carrefour', display: 'Carrefour', domains: ['carrefour.fr', 'carrefour.it', 'carrefour.com', 'carrefour.es', 'carrefour.be', 'carrefour.com.br', 'carrefour.pl', 'carrefour.ro', 'carrefour.com.ar'] },
  { token: 'decathlon', display: 'Decathlon', domains: ['decathlon.it', 'decathlon.fr', 'decathlon.com', 'decathlon.de', 'decathlon.es', 'decathlon.co.uk', 'decathlon.be', 'decathlon.nl', 'decathlon.pl', 'decathlon.pt', 'decathlon.ch', 'decathlon.at', 'decathlon.ca', 'decathlon.in'] },
  { token: 'booking', display: 'Booking.com', domains: ['booking.com', 'bstatic.com', 'bookingholdings.com'] },
  { token: 'airbnb', display: 'Airbnb', domains: ['airbnb.com', 'airbnb.it', 'airbnb.co.uk', 'airbnb.de', 'airbnb.fr', 'airbnb.es', 'airbnb.ca', 'airbnb.com.au', 'airbnb.com.br', 'airbnb.mx', 'airbnb.nl', 'airbnb.ch', 'airbnb.at', 'airbnb.be', 'airbnb.ie', 'airbnb.pt', 'airbnb.jp', 'airbnb.co.in', 'muscache.com'] },
  { token: 'expedia', display: 'Expedia', domains: ['expedia.com', 'expedia.it', 'expedia.co.uk', 'expedia.de', 'expedia.fr', 'expedia.es', 'expedia.ca', 'expedia.com.au', 'expediagroup.com'] },
  { token: 'ryanair', display: 'Ryanair', domains: ['ryanair.com'] },
  { token: 'easyjet', display: 'easyJet', domains: ['easyjet.com'] },
  { token: 'lufthansa', display: 'Lufthansa', domains: ['lufthansa.com', 'lufthansagroup.com', 'lufthansa-technik.com', 'miles-and-more.com'] },
  { token: 'spotify', display: 'Spotify', domains: ['spotify.com', 'scdn.co', 'spotifycdn.com', 'spotify.design'] },
  { token: 'disney', display: 'Disney', domains: ['disney.com', 'disney.it', 'disney.co.uk', 'disney.de', 'disney.fr', 'disneyplus.com', 'disneystore.com', 'disneylandparis.com', 'disneycareers.com', 'thewaltdisneycompany.com'] },
  { token: 'hbomax', display: 'HBO Max', domains: ['hbomax.com', 'max.com', 'hbo.com'] },
  { token: 'primevideo', display: 'Prime Video', domains: ['primevideo.com', 'amazon.com'] },
  { token: 'youtube', display: 'YouTube', domains: ['youtube.com', 'youtu.be', 'ytimg.com', 'youtube-nocookie.com', 'youtubekids.com', 'withyoutube.com', 'youtube.it', 'youtube.de', 'youtube.fr', 'youtube.es', 'youtube.co.uk', 'youtube.ch', 'youtube.at', 'youtube.nl', 'youtube.be', 'youtube.pl', 'youtube.pt', 'youtube.ca', 'youtube.com.br', 'youtube.co.jp', 'youtube.com.au'] },
  { token: 'roblox', display: 'Roblox', domains: ['roblox.com', 'rbxcdn.com'] },
  { token: 'epicgames', display: 'Epic Games', domains: ['epicgames.com', 'unrealengine.com', 'fortnite.com', 'epicgames.dev'] },
  { token: 'fortnite', display: 'Fortnite', domains: ['fortnite.com', 'epicgames.com'] },
  { token: 'playstation', display: 'PlayStation', domains: ['playstation.com', 'playstation.net', 'sonyentertainmentnetwork.com'] },
  { token: 'xbox', display: 'Xbox', domains: ['xbox.com', 'xboxlive.com', 'microsoft.com'] },
  { token: 'nintendo', display: 'Nintendo', domains: ['nintendo.com', 'nintendo.co.jp', 'nintendo.it', 'nintendo.co.uk', 'nintendo.de', 'nintendo.fr', 'nintendo.es', 'nintendo.net', 'nintendo.com.au', 'nintendo-europe.com'] },
  { token: 'snapchat', display: 'Snapchat', domains: ['snapchat.com', 'snap.com', 'sc-cdn.net', 'snapkit.com'] },
  { token: 'pinterest', display: 'Pinterest', domains: ['pinterest.com', 'pinterest.it', 'pinterest.co.uk', 'pinterest.de', 'pinterest.fr', 'pinterest.es', 'pinterest.ca', 'pinterest.com.au', 'pinterest.jp', 'pinimg.com'] },
  { token: 'reddit', display: 'Reddit', domains: ['reddit.com', 'redd.it', 'redditmedia.com', 'redditstatic.com', 'redditinc.com'] },
  { token: 'hotmail', display: 'Hotmail', domains: ['hotmail.com', 'hotmail.it', 'hotmail.co.uk', 'hotmail.de', 'hotmail.fr', 'hotmail.es', 'live.com', 'outlook.com', 'microsoft.com'] },
  { token: 'onedrive', display: 'OneDrive', domains: ['onedrive.com', 'onedrive.live.com', 'live.com', 'microsoft.com', 'sharepoint.com', '1drv.ms'] },
  { token: 'sharepoint', display: 'SharePoint', domains: ['sharepoint.com', 'microsoft.com', 'sharepointonline.com'] },
  { token: 'skype', display: 'Skype', domains: ['skype.com', 'microsoft.com'] },
  { token: 'docusign', display: 'DocuSign', domains: ['docusign.com', 'docusign.net'] },
  { token: 'adobe', display: 'Adobe', domains: ['adobe.com', 'adobe.io', 'adobelogin.com', 'adobecc.com', 'adobedtm.com', 'typekit.net', 'acrobat.com', 'adobestock.com', 'adobeexchange.com'] },
  { token: 'wetransfer', display: 'WeTransfer', domains: ['wetransfer.com', 'we.tl'] },
  { token: 'webex', display: 'Webex', domains: ['webex.com', 'cisco.com'] },
  { token: 'salesforce', display: 'Salesforce', domains: ['salesforce.com', 'force.com', 'salesforce-sites.com', 'sfdcstatic.com', 'salesforceliveagent.com', 'trailhead.com'] },
  { token: 'okta', display: 'Okta', domains: ['okta.com', 'oktacdn.com', 'okta-emea.com', 'oktapreview.com'] },
  { token: 'godaddy', display: 'GoDaddy', domains: ['godaddy.com', 'secureserver.net'] },
  { token: 'namecheap', display: 'Namecheap', domains: ['namecheap.com'] },
  { token: 'verizon', display: 'Verizon', domains: ['verizon.com', 'verizonwireless.com', 'vzw.com', 'verizon.net'] },
  { token: 'tmobile', display: 'T-Mobile', domains: ['t-mobile.com', 't-mobile.de', 't-mobile.nl', 't-mobile.cz', 't-mobile.pl'] },
  { token: 'xfinity', display: 'Xfinity', domains: ['xfinity.com', 'comcast.net', 'comcast.com'] },
  { token: 'telekom', display: 'Telekom', domains: ['telekom.de', 'telekom.com', 't-online.de', 'telekom.hu', 'telekom.sk'] },
  { token: 'swisscom', display: 'Swisscom', domains: ['swisscom.ch', 'swisscom.com'] },
  { token: 'mcafee', display: 'McAfee', domains: ['mcafee.com'] },
  { token: 'norton', display: 'Norton', domains: ['norton.com', 'nortonlifelock.com', 'symantec.com'] },
  { token: 'chatgpt', display: 'ChatGPT', domains: ['chatgpt.com', 'openai.com', 'oaistatic.com', 'oaiusercontent.com'] },
  { token: 'openai', display: 'OpenAI', domains: ['openai.com', 'chatgpt.com'] },

  // Crypto
  { token: 'trezor', display: 'Trezor', domains: ['trezor.io'] },
  { token: 'trustwallet', display: 'Trust Wallet', domains: ['trustwallet.com'] },
  { token: 'opensea', display: 'OpenSea', domains: ['opensea.io'] },
  { token: 'uniswap', display: 'Uniswap', domains: ['uniswap.org'] },
  { token: 'pancakeswap', display: 'PancakeSwap', domains: ['pancakeswap.finance'] },
  { token: 'walletconnect', display: 'WalletConnect', domains: ['walletconnect.com', 'walletconnect.org', 'reown.com'] },
  { token: 'bitpanda', display: 'Bitpanda', domains: ['bitpanda.com'] },
  { token: 'kucoin', display: 'KuCoin', domains: ['kucoin.com'] },
  { token: 'bybit', display: 'Bybit', domains: ['bybit.com'] },
  { token: 'bitget', display: 'Bitget', domains: ['bitget.com'] },
  { token: 'bitfinex', display: 'Bitfinex', domains: ['bitfinex.com'] },
  { token: 'robinhood', display: 'Robinhood', domains: ['robinhood.com'] },
  { token: 'blockchain', display: 'Blockchain.com', domains: ['blockchain.com', 'blockchain.info'] },
  { token: 'phantom', display: 'Phantom', domains: ['phantom.app'] },
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
// Gli indirizzi di paese dei marchi, dagli elenchi dei siti più visitati: lasciati fuori, insegnavano al classificatore
// che quel marchio nel nome di un sito è quasi sempre innocuo, e spegnevano googlehelp e microsoft-online.
const PAESI = {
  google: `ru com.hk co.id com.eg com.pk com.sa co.th com.tw co.kr com.ua com.ng com.co cn com.sg com.ph co.ve com.pe ae dz
    co.il cl az com.vn com.my lk kz bg com.kw rs by co.nz com.bd com.do com.ec lt tn iq com.gt lv com.pr co.ma com.ly jo
    com.gh ba com.bo com.lb com.uy ee com.sv com.qa com.bh com.kh com.af com.ni com.cy com.py com.np com.mm hn tt cm co.ke
    com.om co.tz mg co.cr sn com.cu am ge com.bn mn ci ht al co.hu us in net eu com.pg co.bw mv gm com.pa vg co.ug bi ps
    com.jm mu bs cat je com.fj com.bz im co.zm sh com.vc kg com.et so bj cd co.ao co.zw pn tl rw mw co.uz co.ls sc co.mz
    co.ck md ga com.na mk vu tg com.mt co.vi cg dm gl com.sl ad me gy to is sr com.gi li bf ml com.ag gg com.tj la fm sm
    com.sb gp ws dj ne bt st td nr com.ai com.nf cv as ki tm cf nu tk ms dev ng hk jp ac ai com.ru com.tn`,
  microsoft: 'us cloud ai cn design',
  outlook: 'cn de jp fr com.br it es',
  apple: 'cn com.cn',
  amazon: 'co.za eu ie at com.sg ch jp',
  yahoo: 'com.br jp com.tw ca com.hk com.au com.mx gr co.in com.sg com.ar co.id',
  facebook: 'com.br de',
};
ALTRI_INDIRIZZI.microsoft.push('onmicrosoft.com', 'onmicrosoft.us', 'onmicrosoft.de', 'onmicrosoft.cn', 'microsoftonline.us',
  'microsoftonline.cn');
for (const [t, s] of Object.entries(PAESI)) (ALTRI_INDIRIZZI[t] = ALTRI_INDIRIZZI[t] || []).push(...s.split(/\s+/).filter(Boolean).map((x) => `${t}.${x}`));
for (const b of BRANDS) b.domains.push(...(ALTRI_INDIRIZZI[b.token] || []));

// Marchi che sono anche parole, o stanno dentro parole comuni (pineapple, otherwise, purchase, steampunk), con le loro
// forme tipiche: per il classificatore sono un indizio, non una regola. Un marchio nuovo che è una parola va qui.
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
  ['adobe', []], ['booking', []], ['subito', []], ['disney', []], ['norton', []], ['phantom', []], ['blockchain', []],
  ['aruba', []], ['ameli', []], ['impots', []], ['halifax', []], ['santander', []], ['correos', []], ['sparkasse', []],
  ['volksbank', []], ['postbank', []], ['telekom', []], ['zelle', []], ['desjardins', []], ['decathlon', []],
  ['carrefour', []], ['iliad', []], ['mercadolibre', []], ['bancoposta', []], ['chebanca', []], ['trezor', []],
  ['opensea', []], ['robinhood', []], ['telepass', []], ['mediolanum', []], ['wetransfer', []], ['salesforce', []],
  ['namecheap', []], ['mcafee', []], ['playstation', []], ['spid', []], ['interac', []], ['evri', []],
]);
// Le parole che accompagnano un marchio in un sosia (krakenlogin, securechase, postespedizioni): un indizio per il
// classificatore. Le radici italiane prendono la desinenza (rimborso, notifiche).
const PAROLE_TRUFFA = [
  'login', 'logon', 'signin', 'accedi', 'accesso', 'access', 'auth', 'verify', 'verifica', 'verification', 'secure',
  'security', 'sicurezza', 'account', 'check', 'conto', 'support', 'supporto', 'assistenza', 'help', 'service', 'servizi',
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

// Indice per lookup veloce: eTLD+1 legittimo → brand (per non flaggare il vero).
const LEGIT_DOMAINS = new Map();
for (const b of BRANDS) {
  for (const d of b.domains) LEGIT_DOMAINS.set(d, b);
}

// Vero se l'eTLD+1 dato è un dominio legittimo di un brand noto.
function isLegitBrandDomain(registrable) {
  return LEGIT_DOMAINS.has(registrable);
}

module.exports = { BRANDS, LEGIT_DOMAINS, isLegitBrandDomain, MARCHI_PAROLA, PAROLE_TRUFFA, soloTruffa };
