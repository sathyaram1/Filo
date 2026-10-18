// Siti ospitati su piattaforme a sottodominio per utente (github.io, vercel.app, s3…): il dominio che conta è
// quello dell'utente, non la piattaforma. Regola in src/main/services/safebrowse/psl.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { getDomainInfo } = require('../../src/main/services/safebrowse/psl.js');
const { evaluate } = require('../../src/main/services/safebrowse/engine.js');

const livello = (url) => evaluate(url).level;
const dominio = (host) => getDomainInfo(host).registrable;

test('una pagina personale su github.io non passa per «GitHub su un altro dominio»', () => {
  const v = evaluate('https://sathya.github.io/la-soglia/');
  assert.equal(v.level, 'safe', JSON.stringify(v));
  assert.equal(dominio('sathya.github.io'), 'sathya.github.io');
  assert.equal(livello('https://qualcuno.gitlab.io/'), 'safe');
});

test('le piattaforme stesse e i loro siti ufficiali restano tranquilli', () => {
  for (const url of [
    'https://github.io/', 'https://gitlab.io/', 'https://medium.com/', 'https://www.medium.com/',
    'https://wordpress.com/', 'https://vercel.app/', 'https://s3.amazonaws.com/bucket/file',
    'https://storage.googleapis.com/bucket/file', 'https://fonts.googleapis.com/css',
    'https://lh3.googleusercontent.com/x', 'https://microsoft.sharepoint.com/',
    'https://googleblog.blogspot.com/', 'https://contoso-my.sharepoint.com/',
  ]) assert.equal(livello(url), 'safe', url);
  assert.equal(dominio('medium.com'), 'medium.com');
});

test('un sosia ospitato su una piattaforma viene ancora segnalato', () => {
  const gh = evaluate('https://paypal-login.github.io/');
  assert.notEqual(gh.level, 'safe', JSON.stringify(gh));
  assert.match(gh.message.title, /PayPal/);
  assert.equal(gh.message.body.startsWith('paypal-login.github.io '), true, gh.message.body);
});

test('una piattaforma in whitelist non copre più le pagine che ospita', () => {
  for (const url of [
    'https://paypal-verifica.vercel.app/', 'https://paypal-verifica.netlify.app/',
    'https://paypal-conto.s3.amazonaws.com/index.html', 'https://intesa-accesso.sharepoint.com/',
    'https://poste-rimborso.wordpress.com/', 'https://binance-premi.medium.com/',
    'https://paypal-login.s3.us-east-1.amazonaws.com/', 'https://paypal-login.s3.eu-west-1.amazonaws.com/index.html',
    'https://paypal-login.s3-website-us-east-1.amazonaws.com/', 'https://paypal-login.s3-website.eu-west-1.amazonaws.com/',
  ]) assert.notEqual(livello(url), 'safe', url);
  assert.equal(dominio('paypal-login.s3.us-east-1.amazonaws.com'), 'paypal-login.s3.us-east-1.amazonaws.com');
  assert.equal(livello('https://mio-sito.s3-website.eu-west-1.amazonaws.com/'), 'safe');
  // Cognito: il prefisso della pagina d'accesso lo sceglie l'utente, la regione no.
  assert.notEqual(livello('https://paypal-login.auth.us-east-1.amazoncognito.com/login'), 'safe');
  assert.notEqual(livello('https://paypal-login.auth-fips.us-gov-west-1.amazoncognito.com/login'), 'safe');
  assert.equal(dominio('paypal-login.auth.eu-west-1.amazoncognito.com'), 'paypal-login.auth.eu-west-1.amazoncognito.com');
});

test('GitHub su un suffisso che non è suo resta sospetto', () => {
  assert.notEqual(livello('https://github.co/'), 'safe');
});

test('il nome di un sito ospitato non passa per un errore di battitura del marchio', () => {
  for (const url of [
    'https://email.github.io/', 'https://posts.github.io/', 'https://apply.github.io/', 'https://photon.github.io/',
    'https://team.netlify.app/', 'https://stream.vercel.app/',
  ]) assert.equal(livello(url), 'safe', url);
  // Il sosia fatto di lettere che si somigliano resta un blocco, anche ospitato.
  assert.equal(livello('https://paypa1.github.io/'), 'pericoloso');
});

test('gli indirizzi ufficiali dei marchi non fanno scattare l\'avviso', () => {
  for (const url of [
    'https://login.microsoftonline.com/', 'https://www.microsoft365.com/', 'https://github.dev/',
    'https://fuzzy-space-8080.app.github.dev/', 'https://www.amazon.nl/', 'https://www.amazon.ca/',
    'https://www.ebay.de/', 'https://www.google.ch/', 'https://www.paypal.it/', 'https://negozio.myshopify.com/',
    'https://myshopify.com/', 'https://dl.dropboxusercontent.com/s/x', 'https://app.auth.us-east-1.amazoncognito.com/login',
    'https://m365.cloud.microsoft/', 'https://outlook.cloud.microsoft/mail/',
  ]) assert.equal(livello(url), 'safe', url);
});

test('i cookie della modalità privacy seguono solo le piattaforme che il web già separa', () => {
  const { normalize } = require('../../src/main/services/safebrowse/normalize.js');
  const perCookie = (url) => normalize(url, { soloPsl: true }).registrable;
  assert.equal(perCookie('https://myblog.wordpress.com/'), 'wordpress.com');
  assert.equal(perCookie('https://someone.medium.com/'), 'medium.com');
  assert.equal(perCookie('https://contoso-my.sharepoint.com/'), 'sharepoint.com');
  assert.equal(perCookie('https://sathya.github.io/'), 'sathya.github.io');
  // Per il giudizio invece il blog è un sito a sé.
  assert.equal(normalize('https://myblog.wordpress.com/').registrable, 'myblog.wordpress.com');
  const sito = readFileSync(new URL('../../src/main/services/stessoSito.js', import.meta.url), 'utf8');
  assert.match(sito, /normalize\(url, \{ soloPsl: true \}\)/);
});

test('un Microsoft Form su cloud.microsoft resta una pagina ospitata da giudicare', () => {
  const v = evaluate('https://forms.cloud.microsoft/r/abc', { hasPassword: true });
  assert.equal(v.whitelisted, false);
  assert.equal(v.needsLlm, true, JSON.stringify(v.reasons));
});

test('sotto un suffisso nazionale ogni sito è suo, e una voce fidata che è un suffisso (gov.it) li copre tutti', () => {
  assert.equal(dominio('www.salute.gov.it'), 'salute.gov.it');
  assert.equal(dominio('tienda.com.co'), 'tienda.com.co');
  for (const url of ['https://www.salute.gov.it/', 'https://www.interno.gov.it/', 'https://www.agenziaentrate.gov.it/']) {
    assert.deepEqual(evaluate(url).reasons, ['whitelisted'], url);
  }
  assert.notEqual(livello('https://paypal-login.com.co/'), 'safe');
  assert.notEqual(evaluate('https://paypal-login.vercel.app/').reasons[0], 'whitelisted');
});

// #730 — la piattaforma che ospita non va riconosciuta a mano: vale tutta la sezione privata della PSL.
const PSL = JSON.parse(readFileSync(new URL('../../src/vendor/public-suffix-list/privata.json', import.meta.url), 'utf8'));
const { PRIVATE_AVVISO, DEL_MARCHIO } = require('../../src/main/services/safebrowse/psl.js');

test('un sosia ospitato viene segnalato anche su piattaforme che nessuno ha elencato a mano', () => {
  for (const host of [
    'paypal-login.weebly.com', 'paypal-login.us-east-1.elasticbeanstalk.com', 'paypal-com.translate.goog',
    'paypal-login.wixsite.com', 'paypal-login.webflow.io', 'paypal-login.glitch.me', 'paypal-login.lovable.app',
    // Fuori dalla PSL, o con una zona che la PSL non descrive.
    'paypal-login.z13.web.core.windows.net', 'paypal-login-abc123.z01.azurefd.net', 'paypal-login.mybluehost.me',
    'paypal-login.zohosites.com', 'paypal-login.odoo.com', 'paypal-login.webnode.page', 'paypal-login.mailchimpsites.com',
  ]) {
    const v = evaluate('https://' + host + '/');
    assert.notEqual(v.level, 'safe', host);
    assert.match(v.message.title, /PayPal/, host);
    assert.equal(v.message.body.startsWith(host + ' '), true, v.message.body);
  }
});

test('nessuna piattaforma della PSL privata, né di quelle aggiunte a mano, lascia passare un sosia', () => {
  const regole = PSL.rules.filter((r) => !r.startsWith('!')).map((r) => r.replace(/^\*\./, 'cliente.'));
  const passano = [...regole, ...PRIVATE_AVVISO]
    .filter((r) => !DEL_MARCHIO.has(r))
    .filter((r) => livello('https://paypal-login.' + r + '/') === 'safe');
  assert.deepEqual(passano, []);
  for (const r of [...regole, ...PRIVATE_AVVISO]) assert.equal(livello('https://mio-sito.' + r + '/'), 'safe', r);
});

test('un marchio che è una parola, dentro una parola sua, non fa sosia un sito ospitato; uno distintivo anche attaccato a una parola qualunque', () => {
  for (const url of [
    'https://pineapple-bakery.wixsite.com/', 'https://steampunk-fiera.weebly.com/', 'https://proposte-viaggi.webflow.io/',
    'https://purchase-tickets.carrd.co/', 'https://otherwise-studio.framer.app/', 'https://streetwise.wixsite.com/',
    'https://applecross.weebly.com/',
  ]) assert.equal(livello(url), 'safe', url);
  // Se chiede la password, lo giudica il modello.
  assert.equal(evaluate('https://pineapple-bakery.wixsite.com/', { hasPassword: true }).needsLlm, true);
  for (const host of [
    'paypallogin.weebly.com', 'appleid-verify.wixsite.com', 'mypaypal.github.io', 'paypal2024.netlify.app',
    'securepaypal-it.weebly.com', 'paypalitalia.weebly.com', 'posteitaliane-rimborso.weebly.com',
    'steamcommunity-gift.weebly.com', 'bancaintesa.weebly.com', 'office365-login.weebly.com', 'paypa1-login.github.io',
    'p-a-y-p-a-l.weebly.com', 'appleid.weebly.com', 'postepay-sblocco.wixsite.com',
    // Il marchio distintivo incollato a una parola che non è da truffa (decisione dell'owner sul #730).
    'paypalresolution.vercel.app', 'paypaldispute.netlify.app', 'paypalinc.github.io', 'amazonprimevideo.netlify.app',
    'netflixpremium.vercel.app', 'coinbasepro.github.io', 'binancefutures.netlify.app', 'instagramcopyright.vercel.app',
    'facebookbusiness.netlify.app', 'metamaskrestore.netlify.app', 'metamaskextension.github.io', 'paypalresolution.weebly.com',
    'amazonas-tours.wixsite.com',
  ]) assert.notEqual(livello('https://' + host + '/'), 'safe', host);
});

test('un marchio che è una parola, attaccato a una parola da truffa, fa sosia anche fuori dalle sue forme scritte a mano', () => {
  for (const host of [
    'krakenlogin.com', 'stripelogin.com', 'telegramlogin.com', 'revolutlogin.com', 'appleverify.com', 'chaseverify.com',
    'outlookverify.com', 'discordgift.com', 'discordgifts.com', 'applestore-refund.com', 'securechase.com',
    'myapple-login.com', 'app1everify.com', 'applelogin.github.io', 'steamlogin.vercel.app', 'chaselogin.wixsite.com',
  ]) assert.notEqual(livello('https://' + host + '/'), 'safe', host);
  for (const host of [
    'pineapple.com', 'revolution.com', 'clockwise.com', 'likewise.com', 'composte.it', 'applesauce.com', 'steamboat.com',
    'applecart.com', 'discordant.com', 'steamship.com', 'pinapple.com',
  ]) assert.equal(livello('https://' + host + '/'), 'safe', host);
});

test('la forma tipica di un marchio-parola scritta con un errore da persona resta un sosia, una parola vera vicina no', () => {
  for (const host of [
    'steamcommunlty.com', 'steamcomunity.com', 'steamcommunnity.com', 'steamcommmunity.com', 'steampovered.com',
    'steampowerd.com', 'posteitallane.com', 'posteitalianne.com', 'postelitaliane.com', 'appleld-verify.com',
    'discordnltro.com', 'discorddapp.com', 'discordaap.com', 'ledgerlivve.com', 'ledgerllve.com', 'protonmall.com',
    'krakenexchang.com', 'krakenexchnage.com', 'postepai.com', 'steamcommunlty.github.io', 'posteitalia.com',
    'posteitalia-verifica.com', 'steamguard-verify.com', 'krakenpro-login.com',
    'postespedizioni.com', 'postepacchi.com', 'postegiacenza.com',
  ]) assert.notEqual(livello('https://' + host + '/'), 'safe', host);
  for (const host of ['applied.com', 'applecore.wixsite.com', 'applecake.wixsite.com', 'ledgerline.com', 'posted.wixsite.com']) {
    assert.equal(livello('https://' + host + '/'), 'safe', host);
  }
  // Il confronto legge i nomi anche per come si vedono a schermo: marchi e forme devono essere già scritti così.
  const { MARCHI_PAROLA } = require('../../src/main/services/safebrowse/brands.js');
  const { skeleton } = require('../../src/main/services/safebrowse/confusables.js');
  for (const [marchio, forme] of MARCHI_PAROLA) for (const x of [marchio, ...forme]) assert.equal(skeleton(x), x, x);
});

test('una parola da truffa conta solo intera, e accanto a un marchio-parola che non sta dentro un\'altra parola', () => {
  for (const host of [
    'pineappleshop.wixsite.com', 'redapplestore.wixsite.com', 'bigappleservices.wixsite.com',
    'purchaseonline.wixsite.com', 'imposteonline.wixsite.com', 'tommychase.wixsite.com', 'chasemyers.wixsite.com',
    'myrevolution.wixsite.com', 'chasepremier.wixsite.com', 'appleaccessories.wixsite.com', 'steamhelper.weebly.com',
    'wisecards.wixsite.com', 'steamapparel.wixsite.com', 'shopwise.wixsite.com', 'storewise.wixsite.com',
    'helpwise.wixsite.com', 'economywise.wixsite.com',
  ]) assert.equal(livello('https://' + host + '/'), 'safe', host);
  // Un marchio di quattro lettere conta davanti a una parola da truffa, anche con la desinenza italiana.
  for (const host of ['wiselogin.com', 'wise-login.wixsite.com', 'nexirimborso.com', 'nexi-pagamento.com']) {
    assert.notEqual(livello('https://' + host + '/'), 'safe', host);
  }
});

test('i server dei marchi sulla rete di Akamai sono del marchio', () => {
  for (const url of [
    'https://steamcommunity-a.akamaihd.net/economy/image/abc/360fx360f', 'https://steamstore-a.akamaihd.net/public/x.png',
    'https://officecdn-microsoft-com.akamaized.net/pr/x/Office/Data/v32.cab',
  ]) assert.equal(livello(url), 'safe', url);
  assert.notEqual(livello('https://steamcommunity-login.akamaihd.net/'), 'safe');
});

test('i siti dei marchi sulle piattaforme e i loro server di file non hanno l\'avviso del proprio marchio', () => {
  for (const url of [
    'https://cdn.discordapp.com/attachments/1/2/foto.png', 'https://media.discordapp.net/attachments/1/2/foto.png',
    'https://discord.gift/abc', 'https://google.github.io/styleguide/', 'https://microsoft.github.io/monaco-editor/',
    'https://facebook.github.io/react-native/', 'https://netflix.github.io/', 'https://googlechromelabs.github.io/x/',
    'https://github-production-user-asset-6210df.s3.amazonaws.com/1/foto.png',
    'https://googleonlinesecurity.blogspot.com/', 'https://googleprojectzero.blogspot.com/', 'https://github.blog/',
    'https://gitlab-org.gitlab.io/x/', 'https://connect.facebook.net/it_IT/sdk.js', 'https://steam-chat.com/',
  ]) assert.equal(livello(url), 'safe', url);
  for (const host of [
    'google-login.github.io', 'microsoft-verify.github.io', 'discordapp-nitro.com', 'discordappnitro.com',
    'github-login.s3.amazonaws.com', 'googlesecurity.blogspot.com', 'discord-gift.com',
  ]) assert.notEqual(livello('https://' + host + '/'), 'safe', host);
  const brands = readFileSync(new URL('../../src/main/services/safebrowse/brands.js', import.meta.url), 'utf8');
  const chiavi = [...brands.match(/const ALTRI_INDIRIZZI = \{([\s\S]*?)\n\};/)[1].matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
  const { BRANDS } = require('../../src/main/services/safebrowse/brands.js');
  for (const k of chiavi) assert.ok(BRANDS.some((b) => b.token === k), `«${k}» non è il nome di un marchio: i suoi indirizzi andrebbero persi`);
});

test('una macchina virtuale di Azure è del cliente, non di Microsoft: niente whitelist, e il sosia ha l\'avviso', () => {
  const v = evaluate('https://paypal-login.eastus.cloudapp.azure.com/', { hasPassword: true });
  assert.equal(dominio('paypal-login.eastus.cloudapp.azure.com'), 'paypal-login.eastus.cloudapp.azure.com');
  assert.notEqual(v.level, 'safe');
  assert.match(v.message.title, /PayPal/);
  assert.equal(livello('https://portal.azure.com/'), 'safe');
  // I cookie restano quelli che il web separa: la zona di Azure non è nella PSL.
  assert.equal(getDomainInfo('paypal-login.eastus.cloudapp.azure.com', { soloPsl: true }).registrable, 'azure.com');
});

test('una regola con l\'asterisco della PSL: l\'etichetta al suo posto è del cliente', () => {
  assert.equal(dominio('ec2-1-2-3-4.compute-1.amazonaws.com'), 'ec2-1-2-3-4.compute-1.amazonaws.com');
  assert.equal(dominio('ec2-1-2-3-4.eu-west-1.compute.amazonaws.com'), 'ec2-1-2-3-4.eu-west-1.compute.amazonaws.com');
  assert.equal(dominio('app.mio.compute.estate'), 'app.mio.compute.estate');
  assert.notEqual(livello('https://paypal-login.compute.estate/'), 'safe');
});

test('i cookie seguono la PSL vera: le piattaforme aggiunte a mano restano un sito solo', () => {
  const { normalize } = require('../../src/main/services/safebrowse/normalize.js');
  const perCookie = (url) => normalize(url, { soloPsl: true }).registrable;
  assert.equal(perCookie('https://negozio.wixsite.com/'), 'negozio.wixsite.com');
  assert.equal(perCookie('https://app.us-east-1.elasticbeanstalk.com/'), 'app.us-east-1.elasticbeanstalk.com');
  assert.equal(perCookie('https://pagina.notion.site/'), 'pagina.notion.site');
  assert.equal(perCookie('https://mio.z13.web.core.windows.net/'), 'z13.web.core.windows.net');
  assert.equal(dominio('mio.z13.web.core.windows.net'), 'mio.z13.web.core.windows.net');
  assert.equal(livello('https://mio-sito.z13.web.core.windows.net/'), 'safe');
  for (const p of PRIVATE_AVVISO) assert.equal(perCookie('https://mio-sito.' + p + '/'), perCookie('https://' + p + '/'), p);
  // Quelle aggiunte a mano sono ciò che la PSL non ha: se l'elenco le accoglie, la riga a mano va tolta.
  const nellaPsl = new Set(PSL.rules.map((r) => r.replace(/^[*!]\.?/, '')));
  assert.deepEqual([...PRIVATE_AVVISO].filter((p) => nellaPsl.has(p)), []);
  // I siti di withgoogle.com sono tutti di Google: cookie separati, ma per il giudizio restano Google.
  assert.equal(perCookie('https://grow.withgoogle.com/'), 'grow.withgoogle.com');
  assert.equal(evaluate('https://googlecloud.withgoogle.com/').whitelisted, true);
});

test('la PSL impacchettata porta la licenza MPL, il commit da cui viene e regole in ASCII', () => {
  const lic = readFileSync(new URL('../../src/vendor/public-suffix-list/LICENSE', import.meta.url), 'utf8');
  assert.match(lic, /Mozilla Public License Version 2\.0/);
  assert.match(PSL.commit, /^[0-9a-f]{40}$/);
  assert.ok(PSL.rules.length > 3000, 'la sezione privata è intera');
  assert.deepEqual(PSL.rules.filter((r) => !/^(\*\.|!)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(r)), []);
  assert.ok(PSL.rules.includes('github.io') && PSL.rules.includes('*.compute.amazonaws.com'));
});
