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
