// #1375 — le imitazioni dei marchi le giudica un classificatore sulle lettere (src/main/services/safebrowse/imitazioni.js):
// sui domini veri di truffa e di siti leciti tenuti fuori dall'addestramento prende le imitazioni e lascia stare i siti
// veri, in pochi millisecondi, e il menu del link dice quello che dice l'apertura della pagina.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SB = join(ROOT, 'src', 'main', 'services', 'safebrowse');
const { evaluate, codiceImitazione } = require(join(SB, 'engine.js'));
const IM = require(join(SB, 'imitazioni.js'));
const { normalize } = require(join(SB, 'normalize.js'));
require(join(ROOT, 'src', 'shared', 'linkSospetto.js'));
const LS = globalThis.SN_LINK_SOSPETTO;

const menu = (u) => LS.conImitazione(LS.analizza(u), codiceImitazione(u));
const imitazioneNelMenu = (u) => menu(u).some((c) => /^(typosquatting|omografo|nome_altrui):/.test(c));
const livello = (u, ctx = {}) => evaluate(u, ctx).level;

const PROVE = readFileSync(join(ROOT, 'tests', 'unit', 'dati', 'imitazioni-prova.tsv'), 'utf8')
  .split('\n').filter((r) => r && !r.startsWith('#')).map((r) => r.split('\t'));

test('sui domini di prova prende le imitazioni e lascia stare i siti veri', () => {
  const imitazioni = PROVE.filter(([, m]) => m !== '-');
  const veri = PROVE.filter(([, m]) => m === '-');
  assert.ok(imitazioni.length > 500 && veri.length > 800, 'le prove sono sparite');
  const prese = imitazioni.filter(([h]) => evaluate('https://' + h + '/').imp);
  const falsi = veri.filter(([h]) => evaluate('https://' + h + '/').imp).map(([h]) => h);
  // Le regole di prima, sulle stesse prove, prendevano il 42% delle imitazioni e davano l'avviso al 18% dei siti veri.
  assert.ok(prese.length / imitazioni.length >= 0.85, `imitazioni prese ${prese.length}/${imitazioni.length}`);
  assert.ok(falsi.length / veri.length <= 0.015, `falsi allarmi ${falsi.length}/${veri.length}: ${falsi.join(', ')}`);
});

test('i falsi allarmi delle segnalazioni di prima non tornano, né all’apertura né nel menu', () => {
  for (const u of [
    'https://www.amazon.com.mx/', 'https://netflixstudios.com/', 'https://apple.news/', 'https://www.laposte.fr/',
    'https://www.laposte.net/', 'https://www.telegraph.co.uk/news/', 'https://www.cloud.it/', 'https://telegra.ph/pagina',
    'https://spid.register.it/login/selfcare/login', 'https://spid.intesigroup.com/', 'https://loginspid.infocamere.it/',
    'https://spid.intesa.it/', 'https://www.intesa.it/', 'https://posteid.poste.it/', 'https://www.postepay.it/',
    'https://bperfectcosmetics.com/', 'https://www.thebay.com/', 'https://www.dhlparcel.nl/nl', 'https://gls-spain.es/',
    'https://www.pineapple.com/', 'https://www.otherwise.com/', 'https://www.imposte.it/', 'https://www.posterlounge.it/',
    'https://bnl.gov/', 'https://www.arubanetworks.com/', 'https://telegramma.it/', 'https://www.telegrafo.it/',
    'https://team.com/', 'https://email.com/', 'https://photon.com/', 'https://apply.com/', 'https://revolution.com/',
    'https://www.ilpost.it/',
  ]) {
    assert.equal(livello(u), 'safe', u);
    assert.deepEqual(menu(u).filter((c) => c.includes(':')), [], u);
  }
});

test('le imitazioni si fanno riconoscere, col marchio giusto', () => {
  const casi = {
    'https://paypa1.com/login': 'PayPal', 'https://arnazon.it/': 'Amazon', 'https://poste.it.accesso-sicuro.net/login': 'Poste Italiane',
    'https://intesasanpaolo.com.accesso.net/': 'Intesa Sanpaolo', 'https://unicredit-sicurezza.com/': 'UniCredit',
    'https://bancoposta-online.com/': 'BancoPosta', 'https://paypal.support/': 'PayPal', 'https://netflix.top/': 'Netflix',
    'https://amazon.shop/': 'Amazon', 'https://inps-rimborso.com/': 'INPS', 'https://dhl-pacco.com/': 'DHL',
    'https://аррӏе.com/': 'Apple', 'https://rnicrosoft.com/': 'Microsoft', 'https://steamcommunlty.com/': 'Steam',
    'https://paypal-login.github.io/': 'PayPal', 'https://www.paypal.com@accesso-sicuro.net/login': 'PayPal',
    'https://laposte-suivi-colis.com/': 'La Poste', 'https://telegram-login.com/': 'Telegram',
  };
  for (const [u, marchio] of Object.entries(casi)) {
    const v = evaluate(u);
    assert.ok(v.imp, `nessuna imitazione su ${u}`);
    assert.equal(v.imp.brand.display, marchio, u);
    assert.notEqual(v.level, 'safe', u);
    assert.ok(LS.avviso(menu(u)).includes('imitazione'), `il menu tace su ${u}`);
  }
});

// Refusi che lo script di addestramento non scrive da sé: il modello li deve riconoscere, non ricordare.
test('i refusi di una lettera sul nome di un marchio, anche in fondo, danno l’avviso all’apertura e nel menu', () => {
  const refusi = [
    'paypaal.com', 'paypali.com', 'paypak.com', 'paypl.com', 'amazone.com', 'amazonm.com', 'amazoon.com', 'amazn.com',
    'microsofte.com', 'microsotf.com', 'microsoftx.com', 'linkedim.com', 'linkedinr.com', 'netflixe.com', 'netflx.com',
    'instagrem.com', 'whatsappe.com', 'whatsappt.com', 'facebooc.com', 'facebookr.com', 'yahop.com', 'icloude.com',
    'icluod.com',
  ];
  const persi = refusi.filter((h) => livello('https://' + h + '/') === 'safe' || !imitazioneNelMenu('https://' + h + '/'));
  assert.deepEqual(persi, []);
});

// La forma più comune dei sosia: il marchio attaccato a una parola da truffa, anche quando il marchio è una parola
// (poste, apple) e su una piattaforma dove chiunque pubblica.
test('il marchio attaccato a una parola da truffa dà l’avviso, all’apertura e nel menu', () => {
  const nomi = [
    'posteonline.it', 'poste-id.it', 'postesecure.it', 'check-poste.it', 'poste-sicurezza.com', 'apple-id.it',
    'supportapple.com', 'secure-google.com', 'googlehelp.com', 'unicredit-online.it', 'microsoft-online.com',
    'accountamazon.com', 'outlookaccount.com', 'accountamazon.wixsite.com', 'appleaccount.github.io', 'posteonline.web.app',
  ];
  const persi = nomi.filter((h) => livello('https://' + h + '/') === 'safe' || !imitazioneNelMenu('https://' + h + '/'));
  assert.deepEqual(persi, []);
  const marchi = ['poste', 'google', 'apple', 'microsoft', 'unicredit', 'amazon', 'outlook', 'icloud', 'paypal', 'netflix'];
  const parole = ['secure', 'login', 'verify', 'account', 'support', 'update', 'accesso', 'sicurezza', 'help', 'online'];
  const tutti = [];
  for (const m of marchi) for (const p of parole) for (const s of ['com', 'it']) tutti.push(`${p}-${m}.${s}`, `${m}-${p}.${s}`, `${p}${m}.${s}`, `${m}${p}.${s}`);
  const senza = tutti.filter((h) => livello('https://' + h + '/') === 'safe');
  assert.ok(senza.length / tutti.length < 0.04, `${senza.length}/${tutti.length} senza avviso: ${senza.slice(0, 20).join(', ')}`);
});

test('un marchio corto caduto per caso in un nome generato (cloud, anteprime) non è un’imitazione', () => {
  const fissi = [
    'x1tuyb9bunqa2.esempio-ostile.com', 'xg2bukfvpsdh10.esempio-ostile.com', 'xr7in9n26zv16.esempio-ostile.com',
    'dhl5205f2.cloudfront.net', 'v379gkgj66dthdhl.execute-api.us-east-1.amazonaws.com', '4xe3odby-dh19lk58.vercel.app',
    'igls2i7v-6xop9h3r.vercel.app', '1eyaho3e.ngrok.io',
  ];
  assert.deepEqual(fissi.filter((h) => evaluate('https://' + h + '/').imp), []);
  // E su ventimila nomi così, quasi mai: prima uno su duemila, abbastanza per far cadere a caso un test.
  let x = 1375;
  const caso = () => { x = (x * 48271) % 2147483647; return x / 2147483647; };
  const nome = () => Array.from({ length: 8 + Math.floor(caso() * 8) }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(caso() * 36)]).join('');
  const presi = [];
  for (let i = 0; i < 20000; i++) {
    const h = nome() + ['.esempio.com', '.cloudfront.net', '.vercel.app', '.ngrok.io'][i % 4];
    if (evaluate('https://' + h + '/').imp) presi.push(h);
  }
  assert.ok(presi.length <= 3, `${presi.length} nomi generati presi per imitazioni: ${presi.slice(0, 10).join(', ')}`);
  // Il marchio corto staccato dal resto resta un'imitazione anche lì.
  for (const h of ['dhl-x7k2m9q4.vercel.app', 'n26-3fk9x2.esempio.com']) assert.ok(evaluate('https://' + h + '/').imp, h);
});

test('il menu del link e l’apertura della pagina danno lo stesso verdetto', () => {
  const urls = PROVE.map(([h]) => 'https://' + h + '/').concat([
    'https://paypal.com@wikipedia.evil.net/', 'http://paypal.com@192.168.1.1/login', 'https://mario.rossi@example.com/',
    'https://www.paypal.com/it', 'https://exаmple.com/',
  ]);
  const diversi = urls.filter((u) => imitazioneNelMenu(u) !== !!evaluate(u).imp);
  assert.deepEqual(diversi, []);
  // E il menu non ha più un elenco suo di marchi: lo prende dal main.
  const src = readFileSync(join(ROOT, 'src', 'shared', 'linkSospetto.js'), 'utf8');
  assert.ok(!/POPULAR|'paypal\.com'|'amazon\.it'/.test(src), 'linkSospetto.js ha di nuovo un suo elenco di marchi');
  const azioni = readFileSync(join(ROOT, 'src', 'content', 'actions.js'), 'utf8');
  assert.match(azioni, /MSG\.LINK_IMITAZIONE/, 'il menu non chiede più al main il verdetto sul marchio');
});

test('il controllo resta sotto qualche millisecondo per dominio', () => {
  const nomi = PROVE.map(([h]) => normalize('https://' + h + '/'));
  for (const n of nomi.slice(0, 50)) IM.giudica(n);
  let peggiore = 0;
  const t0 = process.hrtime.bigint();
  for (const n of nomi) {
    const a = process.hrtime.bigint();
    IM.giudica(n);
    peggiore = Math.max(peggiore, Number(process.hrtime.bigint() - a) / 1e6);
  }
  const media = Number(process.hrtime.bigint() - t0) / 1e6 / nomi.length;
  assert.ok(media < 2, `media ${media.toFixed(3)} ms per dominio`);
  assert.ok(peggiore < 25, `il dominio più lento ha chiesto ${peggiore.toFixed(1)} ms`);
});

test('il modello sta nel pacchetto, intero, e si legge', () => {
  const byte = statSync(IM.FILE_MODELLO).size;
  assert.ok(byte > 100000 && byte < 1.5e6, `modello di ${byte} byte`);
  const buf = readFileSync(IM.FILE_MODELLO);
  assert.equal(buf.toString('ascii', 0, 4), 'FIMI');
  const testa = JSON.parse(buf.toString('utf8', 8, 8 + buf.readUInt32LE(4)));
  assert.equal(buf.length, 8 + buf.readUInt32LE(4) + (1 << testa.bit), 'pesi troncati');
  assert.ok(testa.soglia > 0.5 && testa.soglia < 1 && testa.sogliaForte >= testa.soglia);
});
