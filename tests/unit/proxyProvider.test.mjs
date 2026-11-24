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

// #771 — la pagina Sicurezza dichiara l'host del fornitore, mai le credenziali,
// e lo legge dalla stessa config di isConfigured (env compresa).
test('providerHost: host del fornitore effettivo, senza credenziali', () => {
  assert.equal(P.providerHost({ proxy: { datacenter: 'socks5://user-{country}:pw@gate.testprovider.net:7000' } }, {}), 'gate.testprovider.net');
  assert.equal(P.providerHost({}, { FILO_PROXY_DATACENTER: 'http://u:p@env.provider.io:8080' }), 'env.provider.io');
  assert.equal(P.providerHost({ proxy: { datacenter: 'gate.nudo.com:9000' } }, {}), 'gate.nudo.com');
  assert.equal(P.providerHost({}, {}), '');
  assert.equal(P.providerHost({ proxy: { residential: 'socks5://r.x:1' } }, {}), '');
});

// #905.4: gli elenchi dei fornitori danno «host:porta:utente:password». Coi socks Chromium non manda le credenziali:
// senza schema un proxy con utente e password si usa in http.
test('endpointFor: la forma degli elenchi «host:porta:utente:password» si collega, in http', () => {
  const ep = P.endpointFor('gate.esempio.com:8080:mario-{country}:password:con:duepunti', 'de');
  assert.equal(ep.proxyRules, 'http://gate.esempio.com:8080');
  assert.deepEqual(ep.auth, { username: 'mario-de', password: 'password:con:duepunti' });
  assert.equal(P.resolve('us', { settings: { proxy: { datacenter: 'gate.esempio.com:8080:mario:passwordsegreta' } }, env: {} }).proxyRules,
    'http://gate.esempio.com:8080');
  assert.equal(P.endpointFor('socks5://gate.esempio.com:1080:mario:pw', 'it').proxyRules, 'socks5://gate.esempio.com:1080', 'lo schema scritto vince');
  assert.equal(P.endpointFor('mario:pw@gate.esempio.com:8080', 'it').proxyRules, 'http://gate.esempio.com:8080');
  assert.equal(P.endpointFor('gate.esempio.com:1080', 'it').proxyRules, 'socks5://gate.esempio.com:1080', 'senza credenziali resta socks5');
  assert.equal(P.providerHost({ proxy: { datacenter: 'gate.esempio.com:8080:mario:pw' } }, {}), 'gate.esempio.com');
  assert.equal(P.endpointFor('gate.esempio.com:99999:mario:pw', 'it'), null, 'una porta che non esiste non si legge');
  assert.doesNotThrow(() => P.endpointFor('http://mario:pa%zz@gate.esempio.com:8080', 'it'), 'una % sbagliata nella password');
});

// #2646.1: l'utente degli elenchi può essere un indirizzo email, l'host un IPv6 fra quadre.
test('endpointFor: un elenco con l\'utente email o l\'host IPv6 si collega con utente e password interi', () => {
  const email = P.endpointFor('gate.esempio.com:8080:mario-{country}@posta.esempio.it:passwordsegreta', 'de');
  assert.equal(email.proxyRules, 'http://gate.esempio.com:8080');
  assert.deepEqual(email.auth, { username: 'mario-de@posta.esempio.it', password: 'passwordsegreta' });
  const v6 = P.endpointFor('[2001:db8::1]:8080:mario:passwordsegreta', 'it');
  assert.equal(v6.proxyRules, 'http://[2001:db8::1]:8080');
  assert.deepEqual(v6.auth, { username: 'mario', password: 'passwordsegreta' });
  assert.equal(P.endpointFor('socks5://[2001:db8::1]:1080:mario:pw', 'it').proxyRules, 'socks5://[2001:db8::1]:1080');
  const url = P.endpointFor('mario:1234@gate.esempio.com:8080', 'it');
  assert.equal(url.proxyRules, 'http://gate.esempio.com:8080', 'una password di sole cifre non lo fa leggere come elenco');
  assert.deepEqual(url.auth, { username: 'mario', password: '1234' });
  assert.equal(P.providerHost({ proxy: { datacenter: 'gate.esempio.com:8080:mario@posta.esempio.it:pw' } }, {}), 'gate.esempio.com');
});

// #2646.1: senza schema lo schema è un'ipotesi; il fornitore lo dice alla prima domanda e la scheda e i programmi lo usano.
async function fornitore(risposta) {
  const { createServer } = await import('node:net');
  const visti = [];
  const server = createServer((s) => {
    s.on('error', () => {});
    s.once('data', (b) => {
      visti.push(b);
      const saluto = b[0] === 0x05;
      if (risposta === 'socks5') { if (saluto) s.end(Buffer.from([0x05, 0x00])); else s.destroy(); }
      // Chi tace davanti a quello che non capisce, senza chiudere.
      else if (risposta === 'socks5-muto') { if (saluto) s.end(Buffer.from([0x05, 0xff])); }
      // http e socks5 sulla stessa porta, con la password (gli elenchi di Webshare).
      else if (risposta === 'misto') s.end(saluto ? Buffer.from([0x05, 0xff]) : 'HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      else if (risposta === 'http' && b.includes(Buffer.from('\r\n\r\n'))) s.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, visti, close: () => new Promise((r) => { server.close(r); }) };
}

test('resolveSentito: un fornitore solo socks5 scritto senza schema si usa in socks5, con le credenziali per i programmi', async () => {
  const f = await fornitore('socks5');
  try {
    const settings = { proxy: { datacenter: `utente-{country}:pw-socks@127.0.0.1:${f.port}` } };
    assert.equal(P.resolve('us', { settings, env: {} }).proxyRules, `http://127.0.0.1:${f.port}`, 'prima di chiedere vale l\'ipotesi');
    const r = await P.resolveSentito('us', { settings, env: {} });
    assert.equal(r.proxyRules, `socks5://127.0.0.1:${f.port}`);
    assert.deepEqual(r.auth, { username: 'utente-us', password: 'pw-socks' });
    assert.equal(f.visti.at(-1)[0], 0x05, 'dopo l\'http non risposto, un saluto socks5');
    const u = await P.uscitaPerProgramma({ paese: { country: 'fr' }, impostazioni: async () => settings });
    assert.equal(u.proxy, `socks5h://utente-fr:pw-socks@127.0.0.1:${f.port}`, 'il download del video esce dal socks con la password');
    const domande = f.visti.length;
    await P.resolveSentito('gb', { settings, env: {} });
    assert.equal(f.visti.length, domande, 'la risposta resta: non si richiede a ogni scheda');
  } finally { await f.close(); }
});

test('resolveSentito: un elenco con la password su una porta http e socks5 apre le schede in http, senza password resta socks5', async () => {
  const f = await fornitore('misto');
  try {
    const conPassword = { proxy: { datacenter: `127.0.0.1:${f.port}:mario-{country}:passwordsegreta` } };
    const r = await P.resolveSentito('de', { settings: conPassword, env: {} });
    assert.equal(r.proxyRules, `http://127.0.0.1:${f.port}`, 'in socks5 Chromium non manda la password');
    assert.deepEqual(r.auth, { username: 'mario-de', password: 'passwordsegreta' });
    const senza = await P.resolveSentito('de', { settings: { proxy: { datacenter: `127.0.0.1:${f.port}` } }, env: {} });
    assert.equal(senza.proxyRules, `socks5://127.0.0.1:${f.port}`, 'la risposta con la password non vale per la riga senza');
  } finally { await f.close(); }
});

test('resolveSentito: un socks5 che tace davanti all\'http si riconosce lo stesso, entro il tempo della domanda', async () => {
  const f = await fornitore('socks5-muto');
  try {
    const t0 = Date.now();
    const r = await P.resolveSentito('us', { settings: { proxy: { datacenter: `u:p@127.0.0.1:${f.port}` } }, env: {} },
      { sonda: (ind, o) => P.sondaSchema(ind, { ...o, ms: 600 }) });
    assert.equal(r.proxyRules, `socks5://127.0.0.1:${f.port}`);
    assert.ok(Date.now() - t0 < 1500);
  } finally { await f.close(); }
});

test('resolveSentito: un proxy http senza credenziali né schema si usa in http', async () => {
  const f = await fornitore('http');
  try {
    const r = await P.resolveSentito('us', { settings: { proxy: { datacenter: `127.0.0.1:${f.port}` } }, env: {} });
    assert.equal(r.proxyRules, `http://127.0.0.1:${f.port}`);
  } finally { await f.close(); }
});

test('resolveSentito: senza risposta resta l\'ipotesi, e lo schema scritto non si chiede', async () => {
  const f = await fornitore('muto');
  try {
    const t0 = Date.now();
    const r = await P.resolveSentito('us', { settings: { proxy: { datacenter: `u:p@127.0.0.1:${f.port}` } }, env: {} },
      { sonda: (ind) => P.sondaSchema(ind, { ms: 300 }) });
    assert.equal(r.proxyRules, `http://127.0.0.1:${f.port}`);
    assert.ok(Date.now() - t0 < 2000);
    let chiesto = false;
    const s = await P.resolveSentito('us', { settings: { proxy: { datacenter: `socks5://127.0.0.1:${f.port}` } }, env: {} },
      { sonda: async () => { chiesto = true; return 'http'; } });
    assert.equal(s.proxyRules, `socks5://127.0.0.1:${f.port}`);
    assert.equal(chiesto, false);
  } finally { await f.close(); }
  assert.equal(await P.sondaSchema('127.0.0.1:1', { ms: 500 }), null, 'un fornitore spento non decide niente');
});

// #2134.2: chi si collega e chi custodisce i segreti leggono il proxy con la stessa funzione: una password usata per
// collegarsi è sempre custodita, in ogni forma in cui la si può scrivere.
test('ogni password con cui il proxy si collega è fra i suoi segreti', () => {
  require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));
  const C = globalThis.SN_CONST;
  const forme = [
    'http://mario:S3gr%40ta@gate.esempio.com:8080', 'socks5://mario:pw-socks@gate.esempio.com:1080',
    'mario:pass word@gate.esempio.com:8080', 'mario:pass\tword-tab@gate.esempio.com:8080', 'mario:pa@ss@gate.esempio.com:8080',
    'gate.esempio.com:8080:mario:passwordsegreta', 'http://gate.esempio.com:8080:mario:pass word', 'mario:pa%zz@gate.esempio.com:8080',
    'HTTP://Mario:Pw-Maiuscole@Gate.Esempio.com:8080',
  ];
  for (const forma of forme) {
    const ep = P.endpointFor(forma, 'it');
    assert.ok(ep && ep.auth && ep.auth.password, `${JSON.stringify(forma)}: il proxy deve collegarsi con la password`);
    const segreti = C.segretiDelProxy(forma).map((x) => x.valore);
    assert.ok(segreti.includes(ep.auth.password), `${JSON.stringify(forma)}: «${ep.auth.password}» non è custodita (${JSON.stringify(segreti)})`);
    assert.ok(C.credenzialiProxy(forma), `${JSON.stringify(forma)}: l'esportazione non la toglierebbe`);
  }
  const testo = require('node:fs').readFileSync(join(__dirname, '..', '..', 'src', 'main', 'services', 'proxyTab.js'), 'utf8');
  assert.equal(/decodeURIComponent\(u\.(username|password)/.test(testo), false, 'la scheda non tiene una sua lettura delle credenziali');
});
