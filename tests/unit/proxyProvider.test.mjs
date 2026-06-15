// Unit test per src/main/services/proxyTab.js — l'astrazione ProxyProvider
// del proxy per-tab ("Apri da un altro paese"): risoluzione del template
// endpoint, precedenza env > impostazioni, separazione credenziali, tier.
// Logica pura: gira via `npm run test:unit` senza Electron né rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const P = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'proxyTab.js'));

test('normalizeCountry: accetta alpha-2, normalizza il case, rifiuta il resto', () => {
  assert.equal(P.normalizeCountry('us'), 'us');
  assert.equal(P.normalizeCountry('FR'), 'fr');
  assert.equal(P.normalizeCountry(' de '), 'de');
  assert.equal(P.normalizeCountry('usa'), null);
  assert.equal(P.normalizeCountry(''), null);
  assert.equal(P.normalizeCountry(null), null);
  assert.equal(P.normalizeCountry('u1'), null);
});

test('endpointFor: sostituisce {country}/{COUNTRY} e separa le credenziali', () => {
  const ep = P.endpointFor('http://user-{country}:pw@gate.example.com:7000', 'fr');
  assert.equal(ep.proxyRules, 'http://gate.example.com:7000');
  assert.deepEqual(ep.auth, { username: 'user-fr', password: 'pw' });
  const up = P.endpointFor('socks5://x-{COUNTRY}@h:1', 'jp');
  assert.equal(up.auth.username, 'x-JP');
});

test('endpointFor: senza schema il default è socks5 (DNS lato proxy)', () => {
  const ep = P.endpointFor('gate.example.com:1080', 'us');
  assert.equal(ep.proxyRules, 'socks5://gate.example.com:1080');
  assert.equal(ep.auth, null);
});

test('resolve: tier datacenter di default, residential su richiesta', () => {
  const settings = { proxy: { datacenter: 'socks5://dc:1', residential: 'socks5://res:2' } };
  const env = {};
  const dc = P.resolve('us', { settings, env });
  assert.equal(dc.tier, 'datacenter');
  assert.equal(dc.proxyRules, 'socks5://dc:1');
  const res = P.resolve('us', { tier: 'residential', settings, env });
  assert.equal(res.tier, 'residential');
  assert.equal(res.proxyRules, 'socks5://res:2');
});

test('resolve: null se il tier richiesto non è configurato (nessun fallback implicito)', () => {
  const env = {};
  assert.equal(P.resolve('us', { settings: {}, env }), null);
  // Solo datacenter configurato → residential NON ripiega in silenzio.
  const settings = { proxy: { datacenter: 'socks5://dc:1' } };
  assert.equal(P.resolve('us', { tier: 'residential', settings, env }), null);
  assert.ok(P.resolve('us', { settings, env }));
});

test('resolve: env vince sulle impostazioni e porta il bypass', () => {
  const settings = { proxy: { datacenter: 'socks5://from-settings:1' } };
  const env = { FILO_PROXY_DATACENTER: 'socks5://from-env:9', FILO_PROXY_BYPASS: '<-loopback>' };
  const r = P.resolve('gb', { settings, env });
  assert.equal(r.proxyRules, 'socks5://from-env:9');
  assert.equal(r.bypassRules, '<-loopback>');
  assert.equal(r.country, 'gb');
});

test('resolve: paese non valido → null', () => {
  const settings = { proxy: { datacenter: 'socks5://dc:1' } };
  assert.equal(P.resolve('europa', { settings, env: {} }), null);
});

test('isConfigured: true solo con un endpoint datacenter', () => {
  assert.equal(P.isConfigured({}, {}), false);
  assert.equal(P.isConfigured({ proxy: { residential: 'socks5://r:1' } }, {}), false);
  assert.equal(P.isConfigured({ proxy: { datacenter: 'socks5://d:1' } }, {}), true);
  assert.equal(P.isConfigured({}, { FILO_PROXY_DATACENTER: 'socks5://d:1' }), true);
});

test('LOCATIONS: lista curata (~5-8 paesi, non 50) con codici alpha-2 unici', () => {
  assert.ok(P.LOCATIONS.length >= 5 && P.LOCATIONS.length <= 8);
  const codes = P.LOCATIONS.map((l) => l.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const l of P.LOCATIONS) {
    assert.match(l.code, /^[a-z]{2}$/);
    assert.ok(l.label);
  }
  assert.ok(codes.includes('us')); // default da spec
});

// ─── istruzioni persistenti per dominio ("questo sito sempre dagli USA") ────

test('normalizeDomain: estrae l\'host da dominio/URL, toglie www e porta/path', () => {
  assert.equal(P.normalizeDomain('Example.com'), 'example.com');
  assert.equal(P.normalizeDomain('www.netflix.com'), 'netflix.com');
  assert.equal(P.normalizeDomain('https://news.bbc.co.uk/some/path?x=1'), 'news.bbc.co.uk');
  assert.equal(P.normalizeDomain('example.com:443/path'), 'example.com');
  assert.equal(P.normalizeDomain(' youtube.com. '), 'youtube.com');
  // Non-domini → null (niente regola su roba senza punto o con spazi).
  assert.equal(P.normalizeDomain('localhost'), null);
  assert.equal(P.normalizeDomain('non un dominio'), null);
  assert.equal(P.normalizeDomain(''), null);
  assert.equal(P.normalizeDomain(null), null);
});

test('setDomainRule: aggiunge una regola normalizzata su una nuova mappa', () => {
  const before = {};
  const after = P.setDomainRule(before, 'www.Netflix.com', 'US', 'datacenter');
  assert.deepEqual(after, { 'netflix.com': { country: 'us', tier: 'datacenter' } });
  assert.deepEqual(before, {}); // immutabilità: l'originale non cambia
  // Paese non valido o dominio non valido → null (nessuna scrittura).
  assert.equal(P.setDomainRule({}, 'netflix.com', 'europa'), null);
  assert.equal(P.setDomainRule({}, 'localhost', 'us'), null);
  // tier residenziale rispettato; default datacenter.
  assert.equal(P.setDomainRule({}, 'x.com', 'gb', 'residential')['x.com'].tier, 'residential');
  assert.equal(P.setDomainRule({}, 'x.com', 'gb')['x.com'].tier, 'datacenter');
});

test('setDomainRule: aggiornare un dominio già presente non lascia doppioni', () => {
  const r1 = P.setDomainRule({}, 'netflix.com', 'us');
  const r2 = P.setDomainRule(r1, 'WWW.netflix.com', 'gb');
  assert.deepEqual(Object.keys(r2), ['netflix.com']);
  assert.equal(r2['netflix.com'].country, 'gb');
});

test('removeDomainRule: cancella la regola (anche per chiave non normalizzata)', () => {
  const rules = { 'netflix.com': { country: 'us', tier: 'datacenter' }, 'bbc.co.uk': { country: 'gb' } };
  const after = P.removeDomainRule(rules, 'https://www.netflix.com/');
  assert.deepEqual(after, { 'bbc.co.uk': { country: 'gb' } });
  assert.deepEqual(rules, { 'netflix.com': { country: 'us', tier: 'datacenter' }, 'bbc.co.uk': { country: 'gb' } });
  // Dominio assente → mappa invariata (copia).
  assert.deepEqual(P.removeDomainRule(rules, 'altro.com'), rules);
});

test('domainRuleFor: match esatto, per sottodominio, e chiave più specifica', () => {
  const rules = {
    'bbc.co.uk': { country: 'gb', tier: 'datacenter' },
    'iplayer.bbc.co.uk': { country: 'us' },
  };
  // Esatto.
  assert.deepEqual(P.domainRuleFor(rules, 'bbc.co.uk'), { country: 'gb', tier: 'datacenter' });
  // Sottodominio non coperto da regola specifica → eredita quella del dominio.
  assert.deepEqual(P.domainRuleFor(rules, 'https://news.bbc.co.uk/x'), { country: 'gb', tier: 'datacenter' });
  // Chiave più specifica vince.
  assert.deepEqual(P.domainRuleFor(rules, 'https://iplayer.bbc.co.uk/'), { country: 'us', tier: 'datacenter' });
  // Nessuna regola → null.
  assert.equal(P.domainRuleFor(rules, 'netflix.com'), null);
  assert.equal(P.domainRuleFor({}, 'bbc.co.uk'), null);
  assert.equal(P.domainRuleFor(null, 'bbc.co.uk'), null);
  // Regola con paese corrotto → null (non si proxa verso il nulla).
  assert.equal(P.domainRuleFor({ 'x.com': { country: 'zzz' } }, 'x.com'), null);
});
