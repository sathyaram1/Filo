// Banner dei cookie (#754), logica pura del main: regole EasyList Cookie per nascondere, indice
// Consent-O-Matic per rifiutare, nomi dei cookie di consenso da togliere quando l'utente vuole rivedere il banner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CB = require(join(ROOT, 'src', 'main', 'services', 'cookieBanners.js'));
const CR = require(join(ROOT, 'src', 'main', 'services', 'consentRules.js'));
const Cookies = require(join(ROOT, 'src', 'main', 'services', 'cookies.js'));
// Nell'app il sito registrabile lo dà il normalizzatore del rilevamento siti pericolosi, caricato all'avvio.
require(join(ROOT, 'src', 'main', 'services', 'safebrowse', 'index.js'));

const LISTA = [
  '! commento',
  '[Adblock Plus 2.0]',
  '###cookie-notice',
  '##.gdpr-bar',
  '##.wrap > .consent-widget',
  'esempio.it###banner-privacy',
  'visahq.*##.vi__modal_cookie',
  'esempio.it#@#.gdpr-bar',
  'altro.com,~sub.altro.com##.cmp-box',
  '##.x:has-text(cookie)',
  'sito.com##+js(set, foo, 1)',
  '||cookiebot.com^$third-party',
  '@@||consent.example^',
].join('\n');

test('parseCosmetic: id e classi generiche a parte, complessi in lista, niente regole di rete né procedurali', () => {
  const l = CB.parseCosmetic(LISTA);
  assert.ok(l.ids.has('cookie-notice'));
  assert.ok(l.classes.has('gdpr-bar'));
  assert.deepEqual(l.complex, ['.wrap > .consent-widget']);
  assert.deepEqual(l.specific.get('esempio.it'), ['#banner-privacy']);
  assert.deepEqual(l.specific.get('visahq.*'), ['.vi__modal_cookie']);
  assert.deepEqual(l.exceptions.get('esempio.it'), ['.gdpr-bar']);
  assert.deepEqual(l.exceptions.get('sub.altro.com'), ['.cmp-box']);
  const tutto = JSON.stringify({ c: l.complex, s: [...l.specific.values()] });
  assert.ok(!tutto.includes('has-text'), 'le regole procedurali non diventano selettori');
  assert.ok(!tutto.includes('+js'), 'gli scriptlet non diventano selettori');
  assert.ok(!tutto.includes('cookiebot.com'), 'le regole di rete restano fuori');
});

test('hostKeys: domini padre e forme «nome.*», mai il solo dominio di primo livello', () => {
  const k = CB.hostKeys('www.visahq.co.uk');
  assert.ok(k.includes('www.visahq.co.uk'));
  assert.ok(k.includes('visahq.co.uk'));
  assert.ok(k.includes('visahq.*'));
  assert.ok(!k.includes('uk'));
});

test('forHost e matchTokens: regole del sito, eccezioni rispettate, solo i nomi che la lista conosce', () => {
  CB.setListForTest(LISTA);
  const e = CB.forHost('www.esempio.it');
  assert.deepEqual(e.specific, ['#banner-privacy']);
  assert.ok(e.complex.includes('.wrap > .consent-widget'));
  assert.deepEqual(CB.matchTokens('www.esempio.it', ['cookie-notice', 'main'], ['gdpr-bar', 'nav']), ['#cookie-notice'],
    'su esempio.it la classe .gdpr-bar è un\'eccezione');
  assert.deepEqual(CB.matchTokens('altrove.org', [], ['gdpr-bar', 'nav']), ['.gdpr-bar']);
  assert.deepEqual(CB.forHost('booking.visahq.com').specific, ['.vi__modal_cookie']);
  assert.deepEqual(CB.forHost('sub.altro.com').specific, [], 'la negazione ~sub.altro.com toglie la regola lì');
  assert.deepEqual(CB.forHost('www.altro.com').specific, ['.cmp-box']);
});

test('matchTokens: input sporco non passa (non stringhe, troppi elementi)', () => {
  CB.setListForTest(LISTA);
  assert.deepEqual(CB.matchTokens('x.org', [null, 5, { a: 1 }, 'cookie-notice'], 'nope'), ['#cookie-notice']);
  const tanti = Array.from({ length: 20000 }, (_, i) => 'x' + i);
  assert.deepEqual(CB.matchTokens('x.org', tanti, tanti), []);
});

test('Consent-O-Matic: il ruleset impacchettato porta la licenza MIT e il commit da cui viene', () => {
  const dir = join(ROOT, 'src', 'vendor', 'consent-o-matic');
  const lic = readFileSync(join(dir, 'LICENSE'), 'utf8');
  assert.match(lic, /MIT License/);
  assert.match(lic, /Janus Bager Kristensen and Rolf Bagge/);
  const data = JSON.parse(readFileSync(join(dir, 'rules.json'), 'utf8'));
  assert.match(data.commit, /^[0-9a-f]{40}$/);
  assert.ok(CR.count() > 100, 'le regole si caricano');
  assert.equal(CR.getRule('__proto__'), null);
  assert.equal(CR.getRule('non-esiste'), null);
  assert.ok(CR.getRule('didomi.io'));
});

test('Consent-O-Matic: l\'indice porta il primo selettore di ogni rilevatore, e i matcher «url» li decide il main', () => {
  const idx = new Map(CR.detectIndex('https://www.example.com/'));
  assert.ok(idx.has('didomi.io'));
  assert.ok(idx.get('didomi.io').every((sels) => sels.every((s) => typeof s === 'string' && s)));
  assert.ok(!idx.has('google_consentdomain_1'), 'regola legata a consent.google.com: fuori su un altro sito');
  const g = new Map(CR.detectIndex('https://consent.google.com/ml?continue=x'));
  assert.ok(g.has('google_consentdomain_1'));
  assert.equal(CR.urlMatches({ url: ['a.com'], negated: true }, 'https://b.com/'), true);
  assert.equal(CR.urlMatches({ url: ['^https://x\\.'], regexp: true }, 'https://x.org/'), true);
});

test('cookie di consenso: si tolgono quelli dei CMP, mai login, carrello o statistiche', () => {
  for (const n of ['euconsent-v2', 'OptanonConsent', 'OptanonAlertBoxClosed', 'didomi_token', 'CookieConsent', '_sp_v1_consent', 'cmplz_marketing', 'cookieyes-consent']) {
    assert.equal(Cookies.isConsentName(n), true, n);
  }
  for (const n of ['sessionid', 'PHPSESSID', 'cart', 'auth_token', 'remember_me', 'lang']) {
    assert.equal(Cookies.isConsentName(n), false, n);
  }
});

test('siti coi banner: si confronta il sito registrabile, e solo sulle pagine web', () => {
  const sites = Cookies.getBannerSites({ security: { cookies: { bannerSites: ['Esempio.it', '', null] } } });
  assert.deepEqual(sites, ['esempio.it']);
  assert.equal(Cookies.isBannerSiteIn(sites, 'https://www.esempio.it/articolo'), true);
  assert.equal(Cookies.isBannerSiteIn(sites, 'https://altro.it/'), false);
  assert.equal(Cookies.isBannerSiteIn(sites, 'filo://security/'), false);
});
