// Unit test per il motore di ad-blocking (src/main/services/adblock.js):
// parsing delle liste (hosts + EasyList), matching per-dominio con suffissi e
// whitelist di base. electron è richiesto in modo pigro, quindi il modulo si
// carica qui senza Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

// La cache delle liste va in una cartella di prova, e niente rete: i giri si fanno con testi scritti qui.
process.env.NODE_ENV = 'test';
process.env.FILO_USER_DATA = cartellaTemporanea('filo-adblock-');
const A = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'adblock.js'));

test('parseList: formato hosts (0.0.0.0 / 127.0.0.1) → estrae i domini', () => {
  const set = A.parseList([
    '# commento',
    '0.0.0.0 ads.example.com',
    '127.0.0.1 tracker.test',
    '0.0.0.0 localhost',      // non è un dominio: va ignorato
    '0.0.0.0 broadcasthost',  // niente punto: ignorato
  ].join('\n'));
  assert.ok(set.has('ads.example.com'));
  assert.ok(set.has('tracker.test'));
  assert.ok(!set.has('localhost'));
  assert.ok(!set.has('broadcasthost'));
});

test('parseList: regole EasyList con ancora di dominio (||dominio^)', () => {
  const set = A.parseList([
    '! Title: EasyList',
    '[Adblock Plus 2.0]',
    '||doubleclick.net^',
    '||cdn.ads.io^$third-party',   // opzioni dopo ^: il dominio si estrae comunque
    '@@||allowed.com^',            // eccezione: NON deve finire tra i bloccati
    'example.org##.banner',        // regola cosmetica: ignorata
    '/banner/*/img',               // regola di path generica: ignorata
  ].join('\n'));
  assert.ok(set.has('doubleclick.net'));
  assert.ok(set.has('cdn.ads.io'));
  assert.ok(!set.has('allowed.com'), 'le eccezioni @@ non si bloccano');
  assert.ok(!set.has('example.org'), 'le regole cosmetiche non sono domini');
});

test('isBlockedHost: match esatto e su sottodomini', () => {
  A.setDomainsForTest(['ads.example.com', 'doubleclick.net']);
  assert.equal(A.isBlockedHost('ads.example.com'), true);
  // un sottodominio di un dominio bloccato è bloccato anch'esso
  assert.equal(A.isBlockedHost('img.ads.example.com'), true);
  assert.equal(A.isBlockedHost('doubleclick.net'), true);
  assert.equal(A.isBlockedHost('sub.doubleclick.net'), true);
  // un dominio non in lista passa
  assert.equal(A.isBlockedHost('example.com'), false);
  assert.equal(A.isBlockedHost('notads.com'), false);
});

test('whitelist di base: i domini legittimi non si bloccano mai', () => {
  // Anche se finissero in lista per errore, la whitelist vince.
  A.setDomainsForTest(['google.com', 'youtube.com', 'paypal.com']);
  assert.equal(A.isBlockedHost('google.com'), false);
  assert.equal(A.isBlockedHost('mail.google.com'), false);
  assert.equal(A.isBlockedHost('www.youtube.com'), false);
  assert.equal(A.isBlockedHost('paypal.com'), false);
  assert.ok(A.isWhitelistedHost('accounts.google.com'));
});

test('isBlockedUrl: estrae l\'host dall\'URL', () => {
  A.setDomainsForTest(['ad-server.test']);
  assert.equal(A.isBlockedUrl('https://ad-server.test/banner.js?x=1'), true);
  assert.equal(A.isBlockedUrl('https://sub.ad-server.test/x'), true);
  assert.equal(A.isBlockedUrl('https://legit.example/page'), false);
  assert.equal(A.isBlockedUrl('non-un-url'), false);
});

test('isEnabled: default-on, disattivabile col toggle', () => {
  assert.equal(A.isEnabled({}), true);                                         // assente → on
  assert.equal(A.isEnabled({ security: {} }), true);
  assert.equal(A.isEnabled({ security: { adblock: {} } }), true);
  assert.equal(A.isEnabled({ security: { adblock: { enabled: true } } }), true);
  assert.equal(A.isEnabled({ security: { adblock: { enabled: false } } }), false);
});

test('parseList: una regola con un percorso dopo ^ non blocca il sito intero (#576)', () => {
  const set = A.parseList([
    '||dev.to^*/bb/post_body_bottom^',
    '||alicdn.com^*-300x250.$domain=~alibaba.com',
    '||ads.vere.test^',
    '||popup.vere.test^$popup,third-party',
  ].join('\n'));
  assert.ok(!set.has('dev.to'), 'dev.to si aprirebbe solo come pagina d\'errore');
  assert.ok(!set.has('alicdn.com'));
  assert.ok(set.has('ads.vere.test'));
  assert.ok(set.has('popup.vere.test'));
});

test('parseList: le regole che cambiano la richiesta o valgono su certi siti non bloccano il dominio', () => {
  const set = A.parseList([
    '||sito-con-csp.test^$csp=script-src \'self\'',
    '||tf1.test^$media,rewrite=abp-resource:blank-mp3,domain=tf1.fr',
    '||imgur.test^$domain=ghostbin.me',
    '||cdn.test^$third-party,domain=~casa.test',
    '||tracker.test^$removeparam=utm_source',
  ].join('\n'));
  assert.ok(!set.has('sito-con-csp.test'), 'una csp= spegnerebbe il sito');
  assert.ok(!set.has('tf1.test'));
  assert.ok(!set.has('imgur.test'), 'domain= positivo: vale solo su quei siti');
  assert.ok(set.has('cdn.test'), 'un domain= solo negativo blocca ancora');
  assert.ok(!set.has('tracker.test'));
});

const LISTA = [
  '[Adblock Plus 2.0]',
  '##.ad-slot',
  '###ad_top',
  '##div[id^="div-gpt-ad"]',
  'betaseries.com###banner_top',
  'betaseries.com##a[href^="/partner/"]',
  'betaseries.com#?#.blockSearch:has(.adsbygoogle)',
  'esempio.test#?#.box:has-text(Sponsor)',
  'sito-buono.test#@#.ad-slot',
  'rotto.test##.x}body{display:none',
  '@@||accounts.google.com^$generichide',
  '@@||negozio.test^$elemhide',
  '@@$generichide,domain=altro.test|~niente.test',
].join('\n');

test('occultamento: la pagina riceve le regole generiche e quelle del suo sito (#576)', () => {
  A.setCosmeticForTest(LISTA);
  A.configureFromSettings({});
  const p = A.cosmeticForPage('https://www.betaseries.com/it/episode/pantheon/s01e02');
  assert.equal(p.tokens, true);
  assert.match(p.css, /^#banner_top\{display:none!important\}$/m);
  assert.match(p.css, /^a\[href\^="\/partner\/"\]\{display:none!important\}$/m);
  assert.match(p.css, /^\.blockSearch:has\(\.adsbygoogle\)\{display:none!important\}$/m, 'un #?# in CSS vero vale');
  assert.match(p.css, /^div\[id\^="div-gpt-ad"\]\{display:none!important\}$/m);
  assert.doesNotMatch(p.css, /ad-slot|ad_top/, 'id e classi semplici arrivano dopo, se la pagina li ha');
  assert.doesNotMatch(A.cosmeticForPage('https://altrove.test/').css, /banner_top/, 'le regole di un sito restano sue');
  assert.doesNotMatch(A.cosmeticForPage('https://esempio.test/').css, /has-text/, 'le regole procedurali non sono CSS');
});

test('occultamento: id e classi della pagina tornano come CSS solo se la lista li nasconde', () => {
  A.setCosmeticForTest(LISTA);
  A.configureFromSettings({});
  const css = A.cosmeticForTokens('https://www.example.org/', ['ad_top', 'main'], ['ad-slot', 'container']);
  assert.equal(css, '#ad_top{display:none!important}\n.ad-slot{display:none!important}');
  assert.equal(A.cosmeticForTokens('https://sito-buono.test/', [], ['ad-slot']), '', 'eccezione #@# del sito');
  assert.equal(A.cosmeticForTokens('https://x.test/', [{}, 'a'.repeat(121)], 'non-un-array'), '');
});

test('occultamento: $generichide e $elemhide spengono le regole dove la lista lo dice', () => {
  A.setCosmeticForTest(LISTA);
  A.configureFromSettings({});
  const acc = A.cosmeticForPage('https://accounts.google.com/signin');
  assert.equal(acc.tokens, false);
  assert.doesNotMatch(acc.css, /div-gpt-ad/);
  assert.equal(A.cosmeticForTokens('https://accounts.google.com/', ['ad_top'], []), '');
  assert.deepEqual(A.cosmeticForPage('https://www.negozio.test/'), { css: '', tokens: false });
  assert.equal(A.cosmeticForPage('https://altro.test/').tokens, false);
  assert.equal(A.cosmeticForPage('https://niente.test/').tokens, true);
});

test('occultamento: un selettore con graffe non scrive CSS nella pagina', () => {
  A.setCosmeticForTest(LISTA);
  A.configureFromSettings({});
  assert.doesNotMatch(A.cosmeticForPage('https://rotto.test/').css, /body\{display:none/);
});

test('occultamento: spento col toggle, e fuori dalle pagine web', () => {
  A.setCosmeticForTest(LISTA);
  A.configureFromSettings({ security: { adblock: { enabled: false } } });
  assert.deepEqual(A.cosmeticForPage('https://www.betaseries.com/'), { css: '', tokens: false });
  assert.equal(A.cosmeticForTokens('https://www.example.org/', ['ad_top'], []), '');
  A.configureFromSettings({});
  assert.deepEqual(A.cosmeticForPage('filo://home/'), { css: '', tokens: false });
  assert.deepEqual(A.cosmeticForPage('file:///C:/x.html'), { css: '', tokens: false });
});

test('aggiornamento: le regole di occultamento vengono dalle liste EasyList, non dai commenti di un file hosts', async () => {
  const HOSTS = '# Title: hosts\n#### sezione ####\n0.0.0.0 ads.hosts.test\n';
  const r = await A.refresh({
    force: true,
    sources: ['hosts', 'easylist'],
    fetchImpl: async (u) => (u === 'hosts' ? HOSTS : LISTA + '\n||rete.test^'),
  });
  assert.equal(r.ok, true);
  assert.equal(A.isBlockedHost('ads.hosts.test'), true);
  assert.equal(A.isBlockedHost('rete.test'), true);
  A.configureFromSettings({});
  const css = A.cosmeticForPage('https://www.betaseries.com/').css;
  assert.match(css, /#banner_top/);
  assert.doesNotMatch(css, /sezione/);
});

test('aggiornamento: se arriva solo il file hosts si tengono le regole di occultamento che c\'erano', async () => {
  A.setCosmeticForTest(LISTA);
  A.configureFromSettings({});
  await A.refresh({ force: true, sources: ['hosts', 'easylist'], fetchImpl: async (u) => (u === 'hosts' ? '0.0.0.0 a.test\n' : null) });
  assert.match(A.cosmeticForPage('https://www.betaseries.com/').css, /#banner_top/);
});

test('cache: le regole sopravvivono al riavvio, e una cache di prima delle regole si riscarica subito', async () => {
  await A.refresh({ force: true, sources: ['easylist'], fetchImpl: async () => LISTA + '\n||rete.test^' });
  A.setCosmeticForTest('');
  await A.init({});
  assert.match(A.cosmeticForPage('https://www.betaseries.com/').css, /#banner_top/);
  assert.ok(A.status().updatedAt > 0);

  const file = join(process.env.FILO_USER_DATA, 'adblock', 'lists.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ updatedAt: Date.now(), count: 1, domains: ['vecchio.test'] }));
  await A.init({});
  assert.equal(A.isBlockedHost('vecchio.test'), true, 'i domini della cache vecchia valgono finché non arriva la nuova');
  assert.equal(A.status().updatedAt, 0, 'cache senza regole di occultamento: da riscaricare');
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).domains.length);
});
