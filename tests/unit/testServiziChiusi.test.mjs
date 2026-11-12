// Sentinella #735.1: nelle prove il servizio vero delle schede non si raggiunge da nessuna porta
// (pagine di ogni sessione, fetch del main), così GitHub e i contenitori senza rete partono uguali.
// Regola in src/main/test-servizi-chiusi.js; la chiedono NODE_ENV=test o FILO_SERVIZI_CHIUSI=1 su ogni lancio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const S = require(join(ROOT, 'src', 'main', 'test-servizi-chiusi.js'));
const Cookies = require(join(ROOT, 'src', 'main', 'services', 'cookies.js'));

const SCHEDE = 'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents:runQuery?key=k';

test('il servizio delle schede è chiuso, i suoi sosia no', () => {
  for (const u of [SCHEDE, 'https://FIRESTORE.googleapis.com/v1/x', 'https://firestore.googleapis.com./v1/x', 'https://firestore.googleapis.com:443/v1/x']) {
    assert.equal(S.hostChiuso(u), true, u);
  }
  for (const u of ['https://firestore.googleapis.com.esempio.test/v1', 'https://googleapis.com/', 'https://esempio.test/?u=https://firestore.googleapis.com/', 'non un url', '', null, undefined]) {
    assert.equal(S.hostChiuso(u), false, String(u));
  }
});

test('il fetch del main verso le schede fallisce come senza rete, il resto passa', async () => {
  const chiamate = [];
  const target = { fetch: async (input) => { chiamate.push(String(input.url || input)); return 'ok'; } };
  const righe = [];
  assert.equal(S.chiudiFetch(target, (r) => righe.push(r)), true);
  assert.equal(S.chiudiFetch(target, (r) => righe.push(r)), false, 'avvolgere due volte non serve');
  await assert.rejects(() => target.fetch(SCHEDE), (e) => e instanceof TypeError && e.message === 'fetch failed');
  await assert.rejects(() => target.fetch({ url: SCHEDE }), TypeError);
  assert.equal(await target.fetch('https://esempio.test/'), 'ok');
  assert.deepEqual(chiamate, ['https://esempio.test/'], 'la richiesta al servizio chiuso non deve partire');
  assert.deepEqual(righe, ['[test] servizio chiuso: firestore.googleapis.com'], 'avvisa una volta per host');
});

function sessioneFinta() {
  const ses = { listener: null, registrazioni: 0 };
  ses.webRequest = { onBeforeRequest: (fn) => { ses.registrazioni += 1; ses.listener = fn; }, onCompleted: () => {}, onErrorOccurred: () => {} };
  ses.chiedi = (url) => new Promise((r) => ses.listener({ url }, r));
  return ses;
}

test('ogni sessione delle pagine annulla le richieste alle schede, anche coi filtri accesi dopo', async () => {
  Cookies.chiudiHost(S.hostChiuso);
  try {
    const ses = sessioneFinta();
    Cookies.ensureRequestHook(ses);
    assert.deepEqual(await ses.chiedi(SCHEDE), { cancel: true });
    assert.deepEqual(await ses.chiedi('https://www.google-analytics.com/collect'), { cancel: false },
      'senza filtri accesi i tracker restano com\'erano: la modalità test non cambia il resto');
    Cookies.applyTrackerBlocking(ses, true);
    assert.equal(ses.registrazioni, 1, 'Electron tiene UN listener per sessione: un secondo sostituirebbe il primo');
    assert.deepEqual(await ses.chiedi(SCHEDE), { cancel: true });
    assert.deepEqual(await ses.chiedi('https://www.google-analytics.com/collect'), { cancel: true });
    assert.deepEqual(await ses.chiedi('https://esempio.test/'), { cancel: false });
  } finally {
    Cookies.chiudiHost(null);
  }
  const fuori = sessioneFinta();
  Cookies.applyTrackerBlocking(fuori, false);
  assert.deepEqual(await fuori.chiedi(SCHEDE), { cancel: false }, 'fuori dai test il servizio resta raggiungibile');
});

test('in modalità test si chiudono tutte le porte, fuori no', () => {
  const eventi = {};
  const app = { on: (e, fn) => { eventi[e] = fn; }, whenReady: () => new Promise(() => {}) };
  const agganciate = [];
  let filtro = null;
  const cookies = { chiudiHost: (fn) => { filtro = fn; }, ensureRequestHook: (s) => agganciate.push(s) };
  assert.equal(S.chiudiServiziNeiTest({ inTest: false, app, cookies }), false);
  assert.equal(filtro, null);
  assert.deepEqual(eventi, {});

  const prima = globalThis.fetch;
  try {
    assert.equal(S.chiudiServiziNeiTest({ inTest: true, app, cookies, avvisa: () => {} }), true);
    assert.equal(filtro, S.hostChiuso);
    const nuova = {};
    eventi['session-created'](nuova);
    assert.deepEqual(agganciate, [nuova], 'una sessione nata dopo (incognito, privacy) va chiusa anche lei');
    assert.equal(globalThis.fetch.__filoServiziChiusi, true, 'anche il fetch del main');
  } finally {
    globalThis.fetch = prima;
  }
});

test('il main chiude i servizi fuori da ogni condizione: decide il modulo, anche per il pilota', () => {
  const src = readFileSync(join(ROOT, 'src', 'main', 'main.js'), 'utf8');
  const riga = src.split('\n').find((r) => /test-servizi-chiusi'\)\.chiudiServiziNeiTest\(\)/.test(r));
  assert.ok(riga, 'chiamata a chiudiServiziNeiTest non trovata in main.js');
  assert.match(riga, /^try \{/, 'la chiamata sta al primo livello, non dentro il blocco NODE_ENV=test');
});

test('le prove chiudono i servizi in modalità test o su richiesta del pilota, il resto no', () => {
  assert.equal(S.serviziChiusiRichiesti({ NODE_ENV: 'test' }), true);
  assert.equal(S.serviziChiusiRichiesti({ FILO_SERVIZI_CHIUSI: '1' }), true);
  for (const env of [{}, { NODE_ENV: 'production' }, { FILO_SERVIZI_CHIUSI: '0' }, { FILO_SERVIZI_CHIUSI: '' }, null]) {
    assert.equal(S.serviziChiusiRichiesti(env), false, JSON.stringify(env));
  }
});

// Senza NODE_ENV=test (o FILO_SERVIZI_CHIUSI=1) la chiusura non scatta: ogni file delle prove che apre
// Filo da sé deve chiederla, spec o aiutante che sia (il pilota degli agenti apre la cattura composita).
test('ogni file delle prove che apre Filo lo fa coi servizi chiusi', () => {
  const senza = [];
  const giro = (dir) => {
    for (const nome of readdirSync(dir)) {
      if (nome.startsWith('.') || nome === 'node_modules') continue;
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) giro(p);
      else if (/\.m?js$/.test(nome)) {
        const codice = readFileSync(p, 'utf8').split('\n').filter((r) => !/^\s*(\/\/|\*|\/\*)/.test(r)).join('\n');
        if (/electron\.launch\s*\(/.test(codice) && !/NODE_ENV:\s*['"]test['"]|FILO_SERVIZI_CHIUSI:\s*['"]1['"]/.test(codice)) senza.push(relative(ROOT, p));
      }
    }
  };
  giro(join(ROOT, 'tests'));
  assert.deepEqual(senza, [], 'questi file aprono Filo senza NODE_ENV: \'test\' né FILO_SERVIZI_CHIUSI: \'1\' e parlerebbero col servizio vero');
});
