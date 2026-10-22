// L'llms.txt del sito finisce nel prompt dell'Aiuto, che poi scrive e clicca in quella pagina (#1082): un redirect
// verso la rete di casa o verso un altro sito non si segue, l'llms.txt servito dal sito stesso si legge, e lo chiede
// la scheda dell'Aiuto (#1272). Rete finta: DNS e il singolo passo della richiesta per conto della scheda sostituiti.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DNS = {
  'sito.example': ['93.184.216.34'],
  'www.sito.example': ['93.184.216.34'],
  'docs.sito.example': ['93.184.216.35'],
  'altro.example': ['203.0.113.7'],
  'interno.sito.example': ['192.168.1.20'],
  'nas.casa.example': ['192.168.1.30'],
};
require('node:dns').promises.lookup = async (host) => {
  const ip = DNS[String(host).toLowerCase()];
  if (!ip) { const e = new Error('ENOTFOUND ' + host); e.code = 'ENOTFOUND'; throw e; }
  return ip.map((address) => ({ address, family: 4 }));
};

let rotte = {};
let chiesti = [];
const SEGRETO = '{"router":"stato","password":"admin"}';

function rispondi(url) {
  const r = rotte[url];
  if (!r) return new Response('non trovato', { status: 404, headers: { 'content-type': 'text/plain' } });
  if (r.redirect) return new Response(null, { status: 302, headers: { location: r.redirect } });
  if (r.corpo instanceof ReadableStream) return new Response(r.corpo, { status: 200, headers: { 'content-type': r.tipo || 'text/plain' } });
  return new Response(r.corpo, { status: 200, headers: { 'content-type': r.tipo || 'text/plain' } });
}

const PerConto = require('../../src/main/services/perContoDellaScheda.js');
let sessioni = [];
PerConto._dip.richiesta = async (ses, url) => {
  sessioni.push(ses);
  chiesti.push(String(url));
  const res = rispondi(String(url));
  const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
  return loc ? { rimando: loc } : { risposta: res };
};
// La scheda da cui si apre l'Aiuto: la sua sessione esce diretta.
const SESSIONE = { resolveProxy: async () => 'DIRECT' };
const SCHEDA = { wc: { id: 1, session: SESSIONE, getUserAgent: () => 'Mozilla/5.0', isDestroyed: () => false }, url: 'https://sito.example/' };
const leggi = (dominio) => Llms.get(dominio, { sender: SCHEDA });

const store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => ({ [k]: store[k] }),
      set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
    },
  },
};

require('../../src/main/services/llmsTxt.js');
const Llms = globalThis.SN_LLMS_TXT;

beforeEach(() => {
  rotte = {};
  chiesti = [];
  sessioni = [];
  for (const k of Object.keys(store)) delete store[k];
});

const toccati = (frammento) => chiesti.filter((u) => u.includes(frammento));

test('un llms.txt servito dal sito stesso si legge, anche in JSON o testo semplice', async () => {
  rotte['https://sito.example/llms.txt'] = { corpo: '# Sito\nIl carrello sta in alto a destra.' };
  const r = await leggi('sito.example');
  assert.equal(r.present, true);
  assert.equal(r.text, '# Sito\nIl carrello sta in alto a destra.');
});

test('un redirect verso 127.0.0.1 o la rete di casa non si segue', async () => {
  for (const verso of ['http://127.0.0.1:8080/status', 'https://192.168.1.1/api/stato', 'http://localhost/', 'https://interno.sito.example/llms.txt', 'http://[::1]/']) {
    rotte = {
      'https://sito.example/llms.txt': { redirect: verso },
      [verso]: { corpo: SEGRETO, tipo: 'application/json' },
    };
    chiesti = [];
    for (const k of Object.keys(store)) delete store[k];
    const r = await leggi('sito.example');
    assert.equal(r.present, false, `redirect verso ${verso} seguito`);
    assert.equal(r.text, '');
    assert.deepEqual(chiesti, ['https://sito.example/llms.txt'], `la rete di casa è stata chiamata per ${verso}`);
  }
});

test('un redirect verso un altro sito non si segue, uno dentro lo stesso sito sì', async () => {
  rotte = {
    'https://sito.example/llms.txt': { redirect: 'https://altro.example/llms.txt' },
    'https://altro.example/llms.txt': { corpo: 'Istruzioni di un altro sito' },
  };
  assert.equal((await leggi('sito.example')).present, false);
  assert.equal(toccati('altro.example').length, 0);

  for (const k of Object.keys(store)) delete store[k];
  rotte = {
    'https://sito.example/llms.txt': { redirect: 'https://www.sito.example/llms.txt' },
    'https://www.sito.example/llms.txt': { redirect: '/docs/llms.txt' },
    'https://www.sito.example/docs/llms.txt': { corpo: 'Guida del sito' },
  };
  const r = await leggi('sito.example');
  assert.equal(r.present, true);
  assert.equal(r.text, 'Guida del sito');
});

test('un redirect che scende da https a http non si segue, nemmeno nello stesso sito', async () => {
  rotte = {
    'https://sito.example/llms.txt': { redirect: 'http://www.sito.example/llms.txt' },
    'http://www.sito.example/llms.txt': { corpo: 'in chiaro' },
  };
  assert.equal((await leggi('sito.example')).present, false);
  assert.equal(toccati('http://').length, 0);
});

test('Aiuto su una pagina della rete di casa: il suo llms.txt si legge, un redirect fuori dal suo host no', async () => {
  rotte['https://192.168.1.10/llms.txt'] = { corpo: 'Pannello del NAS' };
  const ip = await leggi('192.168.1.10');
  assert.equal(ip.present, true);
  assert.equal(ip.text, 'Pannello del NAS');

  rotte['https://nas.casa.example/llms.txt'] = { redirect: '/aiuto/llms.txt' };
  rotte['https://nas.casa.example/aiuto/llms.txt'] = { corpo: 'Aiuto del NAS' };
  assert.equal((await leggi('nas.casa.example')).text, 'Aiuto del NAS');

  for (const verso of ['https://192.168.1.1/api/stato', 'http://192.168.1.10/llms.txt', 'https://192.168.1.10:8443/llms.txt', 'http://127.0.0.1/']) {
    for (const k of Object.keys(store)) delete store[k];
    chiesti = [];
    rotte = { 'https://192.168.1.10/llms.txt': { redirect: verso }, [verso]: { corpo: SEGRETO } };
    const r = await leggi('192.168.1.10');
    assert.equal(r.present, false, `dalla rete di casa seguito verso ${verso}`);
    assert.deepEqual(chiesti, ['https://192.168.1.10/llms.txt']);
  }
});

test('un file enorme si legge fino al tetto e la connessione si chiude', async () => {
  let mandati = 0;
  let chiuso = false;
  const blocco = new TextEncoder().encode('a'.repeat(4096));
  rotte['https://sito.example/llms.txt'] = {
    corpo: new ReadableStream({
      pull(c) { mandati++; c.enqueue(blocco); },
      cancel() { chiuso = true; },
    }),
  };
  const r = await leggi('sito.example');
  assert.equal(r.present, true);
  assert.ok(r.text.endsWith('…[troncato]'));
  assert.equal(r.text.length, Llms._internal.MAX_BYTES + '\n…[troncato]'.length);
  assert.ok(mandati < 20, `letti ${mandati} blocchi da 4 KB`);
  await new Promise((ok) => setTimeout(ok, 10));
  assert.equal(chiuso, true);
});

test('una voce in cache scritta prima della correzione si rilegge', async () => {
  store.sn_llmstxt_cache = { 'sito.example': { text: SEGRETO, present: true, cachedAt: Date.now() } };
  rotte['https://sito.example/llms.txt'] = { redirect: 'http://127.0.0.1/status' };
  const r = await leggi('sito.example');
  assert.equal(r.present, false);
  assert.equal(r.text, '');
  assert.equal(store.sn_llmstxt_cache['sito.example'].present, false);
});

test('lo chiede la sessione della scheda dell\'Aiuto, e senza una scheda viva non parte niente', async () => {
  rotte['https://sito.example/llms.txt'] = { corpo: 'Guida' };
  assert.equal((await leggi('sito.example')).text, 'Guida');
  assert.ok(sessioni.length > 0 && sessioni.every((s) => s === SESSIONE), 'la richiesta non è partita dalla sessione della scheda');

  for (const k of Object.keys(store)) delete store[k];
  chiesti = [];
  for (const sender of [undefined, null, {}, { wc: { ...SCHEDA.wc, isDestroyed: () => true } }]) {
    const r = await Llms.get('sito.example', { sender });
    assert.equal(r.present, false);
  }
  assert.deepEqual(chiesti, []);
  assert.equal(store.sn_llmstxt_cache, undefined, 'una lettura mai fatta non si scrive in cache');
});

test('da una scheda col proxy il nome lo risolve il proxy: niente DNS di casa, la richiesta parte', async () => {
  const dns = require('node:dns').promises;
  const vero = dns.lookup;
  let chiestiAlDns = 0;
  dns.lookup = async (...a) => { chiestiAlDns++; return vero(...a); };
  const proxata = { ...SCHEDA, wc: { ...SCHEDA.wc, session: { resolveProxy: async () => 'SOCKS5 127.0.0.1:1080' } } };
  try {
    rotte['https://solo-dal-proxy.example/llms.txt'] = { corpo: 'Visto dal proxy' };
    const r = await Llms.get('solo-dal-proxy.example', { sender: proxata });
    assert.equal(r.text, 'Visto dal proxy');
    assert.equal(chiestiAlDns, 0);
  } finally {
    dns.lookup = vero;
  }
});
