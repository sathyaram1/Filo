// #1375 giri 3 e 4: il nome intero di un marchio noto messo dove non è suo (su un altro suffisso, come sito di una
// piattaforma, davanti a un altro dominio, con un numero o «my») e i refusi a una lettera devono dare l'avviso,
// all'apertura e nel menu del link: le regole di prima li prendevano tutti.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluate, codiceImitazione } = require('../../../src/main/services/safebrowse/engine.js');
require('../../../src/shared/linkSospetto.js');
const LS = globalThis.SN_LINK_SOSPETTO;
const nelMenu = (u) => LS.conImitazione(LS.analizza(u), codiceImitazione(u)).some((c) => /^(typosquatting|omografo|nome_altrui):/.test(c));
const senzaAvviso = (h) => evaluate('https://' + h + '/').level === 'safe' || !nelMenu('https://' + h + '/');

const MARCHI = ['paypal', 'amazon', 'microsoft', 'google', 'apple', 'netflix', 'facebook', 'instagram', 'linkedin', 'ebay',
  'yahoo', 'gmail', 'icloud', 'poste', 'unicredit', 'outlook', 'dropbox', 'binance', 'coinbase'];

const FAMIGLIE = {
  'altro suffisso': (b) => ['xyz', 'top', 'shop', 'online', 'site', 'info', 'store', 'click', 'live'].map((t) => `${b}.${t}`),
  piattaforma: (b) => ['wixsite.com', 'netlify.app', 'web.app', 'vercel.app', 'pages.dev', 'firebaseapp.com', 'herokuapp.com',
    'weebly.com', 'blogspot.com', 'webflow.io'].map((p) => `${b}.${p}`),
  'davanti a un altro sito': (b) => [`${b}.com.secure-verify.net`, `${b}.com.account-check.top`, `login.${b}.com.verifica-utente.it`,
    `www.${b}.it.sicurezza-conto.com`, `${b}.com.x7241.ru`],
  'numero o my': (b) => [`${b}24.com`, `${b}-2024.com`, `my${b}.com`, `${b}365.it`],
  'una lettera in più o in meno': (b) => [b + 'e', b + 'a', ...Array.from({ length: b.length - 2 }, (_, i) => b.slice(0, i + 1) + b.slice(i + 2))]
    .map((s) => s + '.com'),
};

test('r1 i nomi classici col marchio intero fuori posto danno l’avviso', () => {
  const nomi = ['amazon.online', 'microsoft.site', 'google.xyz', 'apple.shop', 'poste.online', 'unicredit.info',
    'amazon.wixsite.com', 'microsoft.netlify.app', 'google.web.app', 'poste.firebaseapp.com',
    'microsoft.com.secure-verify.net', 'google.com.secure-verify.net', 'apple.com.secure-verify.net', 'login.gmail.com.verifica-utente.it',
    'amazon24.com', 'google-2024.com', 'myapple.com', 'myicloud.com',
    'gmal.com', 'appe.com', 'iclud.com', 'pste.com', 'postee.com'];
  expect(nomi.filter(senzaAvviso)).toEqual([]);
});

for (const [nome, forme] of Object.entries(FAMIGLIE)) {
  test(`r1 ${nome}: quasi sempre un avviso`, () => {
    const tutti = MARCHI.flatMap(forme);
    const persi = tutti.filter(senzaAvviso);
    expect(persi.length / tutti.length, `${persi.length}/${tutti.length} senza avviso: ${persi.slice(0, 30).join(', ')}`).toBeLessThan(0.05);
  });
}
