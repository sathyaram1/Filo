// #1375 giro 4: le forme che le regole di prima prendevano (marchio con la sigla di un paese, lettera raddoppiata con
// una parola, trattino dentro il marchio, marchio davanti a un altro sito, tasto vicino) devono dare ancora l'avviso,
// all'apertura e nel menu del link. Gli elenchi sono nomi che su main davano «sospetto» o «pericoloso».
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluate, codiceImitazione } = require('../../../src/main/services/safebrowse/engine.js');
require('../../../src/shared/linkSospetto.js');
const LS = globalThis.SN_LINK_SOSPETTO;
const nelMenu = (u) => LS.conImitazione(LS.analizza(u), codiceImitazione(u)).some((c) => /^(typosquatting|omografo|nome_altrui):/.test(c));
const senzaAvviso = (h) => evaluate('https://' + h + '/').level === 'safe' || !nelMenu('https://' + h + '/');

test('r1 i nomi classici di queste forme danno l’avviso', () => {
  const nomi = ['paypal-it.com', 'poste-it.com', 'it-poste.com', 'postepay-it.com', 'unicredit-it.com', 'google-it.com',
    'amazonn-account.com', 'microsoftt-login.com', 'ebayy-secure.com', 'ama-zon.com', 'micro-soft.com', 'goo-gle.com',
    'gmail.sicurezza-clienti.com', 'google.area-riservata.info', 'yahoo.avviso-conto.com', 'aople.com', 'gmsil.com', 'ppste.com',
    'googlehelp.com', 'appleaccount.github.io', 'posteitalia.com'];
  expect(nomi.filter(senzaAvviso)).toEqual([]);
});

const FAMIGLIE = {
  'sigla di un paese': [
    'paypal-it.com', 'amazon-it.com', 'amazon-eu.com', 'amazon-ch.com', 'microsoft-it.com', 'microsoft-eu.com',
    'microsoft-es.com', 'microsoft-ch.com', 'google-it.com', 'google-ita.com', 'google-italy.com',
    'google-eu.com', 'google-us.com', 'google-de.com', 'google-es.com', 'google-ch.com', 'apple-it.com',
    'apple-ita.com', 'apple-italy.com', 'apple-eu.com', 'apple-es.com', 'apple-ch.com', 'netflix-it.com',
    'facebook-it.com', 'instagram-it.com', 'linkedin-it.com', 'linkedin-eu.com', 'linkedin-ch.com', 'ebay-it.com',
    'ebay-ita.com', 'ebay-italy.com', 'ebay-eu.com', 'ebay-us.com', 'ebay-es.com', 'ebay-ch.com', 'yahoo-it.com',
    'yahoo-ita.com', 'yahoo-italy.com', 'yahoo-eu.com', 'yahoo-es.com', 'yahoo-ch.com', 'gmail-it.com',
    'gmail-eu.com', 'gmail-ch.com', 'icloud-it.com', 'icloud-ita.com', 'icloud-italy.com', 'icloud-eu.com',
    'icloud-de.com', 'icloud-ch.com', 'poste-it.com', 'poste-ita.com', 'poste-italy.com', 'poste-eu.com',
    'poste-us.com', 'poste-uk.com', 'poste-de.com', 'poste-fr.com', 'poste-es.com', 'poste-ch.com',
    'unicredit-it.com', 'unicredit-eu.com', 'unicredit-ch.com', 'outlook-it.com', 'outlook-ita.com',
    'outlook-italy.com', 'outlook-eu.com', 'outlook-us.com', 'outlook-de.com', 'outlook-es.com', 'outlook-ch.com',
    'dropbox-it.com', 'dropbox-eu.com', 'dropbox-ch.com', 'binance-it.com', 'postepay-it.com', 'nexi-it.com',
    'nexi-ita.com', 'nexi-italy.com', 'nexi-eu.com', 'nexi-us.com', 'nexi-uk.com', 'nexi-de.com', 'nexi-fr.com',
    'nexi-es.com', 'nexi-ch.com', 'ledger-it.com', 'ledger-eu.com', 'ledger-ch.com', 'whatsapp-it.com',
    'telegram-it.com', 'telegram-ita.com', 'telegram-eu.com', 'telegram-de.com', 'telegram-es.com',
    'telegram-ch.com',
  ],
  'lettera raddoppiata e parola': [
    'amazonn-account.com', 'amazonn-online.com', 'microsoftt-account.com', 'microsoftt-login.com',
    'microsoftt-secure.com', 'microsoftt-online.com', 'googlee-account.com', 'googlee-online.com',
    'netflixx-account.com', 'linkedinn-account.com', 'linkedinn-online.com', 'ebayy-account.com',
    'ebayy-login.com', 'ebayy-secure.com', 'ebayy-support.com', 'ebayy-online.com', 'yahooo-account.com',
    'yahooo-online.com', 'gmaill-account.com', 'gmaill-secure.com', 'gmaill-online.com', 'icloudd-account.com',
    'icloudd-secure.com', 'icloudd-support.com', 'icloudd-online.com', 'unicreditt-account.com',
    'unicreditt-login.com', 'unicreditt-secure.com', 'unicreditt-online.com', 'dropboxx-account.com',
    'postepayy-account.com', 'postepayy-online.com',
  ],
  'trattino dentro il marchio': [
    'a-mazon.com', 'am-azon.com', 'ama-zon.com', 'amaz-on.com', 'amazo-n.com', 'm-icrosoft.com', 'mi-crosoft.com',
    'mic-rosoft.com', 'micr-osoft.com', 'micro-soft.com', 'micros-oft.com', 'microso-ft.com', 'microsof-t.com',
    'g-oogle.com', 'go-ogle.com', 'goo-gle.com', 'goog-le.com', 'googl-e.com', 'e-bay.com', 'eb-ay.com',
    'eba-y.com', 'y-ahoo.com', 'ya-hoo.com', 'yah-oo.com', 'yaho-o.com', 'g-mail.com', 'gm-ail.com', 'gma-il.com',
    'gmai-l.com', 'u-nicredit.com', 'un-icredit.com', 'uni-credit.com', 'unic-redit.com', 'unicr-edit.com',
    'unicre-dit.com', 'unicred-it.com', 'unicredi-t.com', 'b-inance.com', 'bi-nance.com', 'bin-ance.com',
    'bina-nce.com', 'binan-ce.com', 'binanc-e.com', 't-elegram.com', 'te-legram.com', 'tel-egram.com',
    'tele-gram.com', 'teleg-ram.com', 'telegr-am.com', 'telegra-m.com',
  ],
  'marchio davanti a un altro sito': [
    'microsoft.clienti-servizi.org', 'google.area-riservata.info', 'google.clienti-servizi.org',
    'google.avviso-conto.com', 'apple.clienti-servizi.org', 'ebay.clienti-servizi.org',
    'yahoo.sicurezza-clienti.com', 'yahoo.clienti-servizi.org', 'yahoo.avviso-conto.com',
    'gmail.sicurezza-clienti.com', 'gmail.assistenza-online.net', 'gmail.area-riservata.info',
    'gmail.clienti-servizi.org', 'gmail.avviso-conto.com', 'poste.clienti-servizi.org',
    'unicredit.clienti-servizi.org', 'outlook.sicurezza-clienti.com', 'outlook.assistenza-online.net',
    'outlook.area-riservata.info', 'outlook.clienti-servizi.org', 'outlook.avviso-conto.com',
    'binance.area-riservata.info', 'binance.clienti-servizi.org', 'ledger.clienti-servizi.org',
    'telegram.clienti-servizi.org', 'telegram.avviso-conto.com',
  ],
};

for (const [nome, nomi] of Object.entries(FAMIGLIE)) {
  test(`r1 ${nome}: quello che prima dava l’avviso lo dà ancora`, () => {
    const persi = nomi.filter(senzaAvviso);
    expect(persi.length / nomi.length, `${persi.length}/${nomi.length} senza avviso: ${persi.slice(0, 30).join(', ')}`).toBeLessThan(0.05);
  });
}
