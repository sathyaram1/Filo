// L'età di un sito (rdap.org, crt.sh) si chiede solo con un indizio, una volta per sito, e anche «non si sa» si ricorda
// (#894). Fornitori finti che contano le chiamate; il tempo si sposta riscrivendo Date.now.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SB = require('../../src/main/services/safebrowse/index.js');

const HOUR = 3600 * 1000;
const realNow = Date.now;
let shift = 0;
let conta;

beforeEach(() => {
  shift = 0;
  Date.now = () => realNow() + shift;
  for (const c of Object.values(SB._caches)) c.m.clear();
  conta = { gsb: [], rdap: [], ct: [], llm: [], sandbox: [] };
  SB.setProviders({
    gsb: async (u) => { conta.gsb.push(u); return { listed: false }; },
    rdap: async (r) => { conta.rdap.push(r); return null; },
    ct: async (r) => { conta.ct.push(r); return null; },
    llm: null,
    sandbox: null,
  });
});
afterEach(() => { Date.now = realNow; });

const analizza = (url, ctx = {}) => new Promise((ok) => {
  SB.analyze(url, ctx, ok);
  setTimeout(ok, 30);
});

test('una pagina pulita non manda il nome del sito ai registri; con una password sì, una volta', async () => {
  await analizza('https://forno-di-marco.com/', {});
  await analizza('https://forno-di-marco.com/chi-siamo', {});
  assert.deepEqual(conta.rdap, []);
  assert.deepEqual(conta.ct, []);
  assert.equal(conta.gsb.length, 1, 'la lista nera resta consultata (e ricordata per il sito)');

  await analizza('https://forno-di-marco.com/accedi', { hasPassword: true });
  await analizza('https://forno-di-marco.com/accedi', { hasPassword: true });
  assert.deepEqual(conta.rdap, ['forno-di-marco.com']);
  assert.deepEqual(conta.ct, ['forno-di-marco.com']);
});

test('un dominio di ieri col nome di un marchio resta pericoloso e dice che è registrato da poco', async () => {
  SB.setProviders({ rdap: async (r) => { conta.rdap.push(r); return 1.2; } });
  const url = 'https://paypal-verifica-conto.com/';
  assert.equal(SB.checkSync(url).level, 'sospetto');
  const v = await analizza(url, {});
  assert.equal(v.level, 'pericoloso');
  assert.match(v.message.body, /registrato ieri/);
  assert.ok(v.reasons.includes('young_domain'));
  assert.deepEqual(conta.ct, [], 'con l\'età da RDAP crt.sh non si interroga');
});

test('dieci pagine dello stesso sito con un indizio, anche tutte insieme, fanno una domanda sola per registro', async () => {
  const pagine = Array.from({ length: 10 }, (_, i) => analizza(`https://negozio-esempio.it/p${i}`, { hasPayment: true }));
  await Promise.all(pagine);
  for (let i = 0; i < 10; i++) await analizza(`https://www.negozio-esempio.it/q${i}`, { hasPassword: true });
  assert.equal(conta.rdap.length, 1);
  assert.equal(conta.ct.length, 1);
});

test('whitelist, pagine ospitate sotto un dominio in whitelist, siti utente sulle piattaforme e IP: niente età', async () => {
  for (const u of ['https://accounts.google.com/signin', 'https://sites.google.com/view/paypal-login', 'https://docs.google.com/forms/d/e/1FAIpQL/viewform',
    'https://mario.github.io/login', 'https://negozio.netlify.app/checkout', 'https://203.0.113.9/login']) {
    await analizza(u, { hasPassword: true });
  }
  assert.deepEqual(conta.rdap, []);
  assert.deepEqual(conta.ct, []);
  assert.equal(conta.gsb.length, 6, 'la lista nera resta consultata');
});

test('con RDAP che dà l\'età crt.sh non viene chiamato', async () => {
  SB.setProviders({ rdap: async (r) => { conta.rdap.push(r); return 900; } });
  await analizza('https://banca-esempio.com/login', { hasPassword: true });
  assert.equal(conta.rdap.length, 1);
  assert.deepEqual(conta.ct, []);
  assert.equal(SB._caches.ageCache.get('banca-esempio.com'), 900);
});

test('«non si sa» si ricorda un giorno; dopo un errore di rete si richiede solo passati pochi minuti', async () => {
  await analizza('https://sconosciuto-esempio.de/login', { hasPassword: true });
  shift = 23 * HOUR;
  await analizza('https://sconosciuto-esempio.de/login', { hasPassword: true });
  assert.equal(conta.rdap.length, 1, 'un registro che non la sa non si richiede per un giorno');
  shift = 25 * HOUR;
  await analizza('https://sconosciuto-esempio.de/login', { hasPassword: true });
  assert.equal(conta.rdap.length, 2);

  shift = 0;
  for (const c of Object.values(SB._caches)) c.m.clear();
  conta.rdap.length = 0;
  conta.ct.length = 0;
  SB.setProviders({
    rdap: async (r) => { conta.rdap.push(r); throw new Error('ECONNRESET'); },
    ct: async (r) => { conta.ct.push(r); return SB.net.TRANSIENT; },
  });
  await analizza('https://instabile-esempio.com/login', { hasPassword: true });
  shift = 2 * 60 * 1000;
  await analizza('https://instabile-esempio.com/login', { hasPassword: true });
  assert.equal(conta.rdap.length, 1, 'non a ogni pagina');
  shift = 6 * 60 * 1000;
  await analizza('https://instabile-esempio.com/login', { hasPassword: true });
  assert.equal(conta.rdap.length, 2, 'passato il tempo breve si riprova');
});

test('giudizio AI e finestra isolata: una sola chiamata in volo per pagina, anche con indizi diversi', async () => {
  let libera;
  const attesa = new Promise((ok) => { libera = ok; });
  SB.setProviders({
    llm: async (m) => { conta.llm.push(m.host); await attesa; return { suspicious: false, reason: null }; },
    sandbox: async (u) => { conta.sandbox.push(u); await attesa; return { verdict: 'clean', finalUrl: u, redirects: [] }; },
  });
  const url = 'http://accesso-esempio.com/login';
  SB.analyze(url, {}, () => {});
  SB.analyze(url, { hasPassword: true }, () => {});
  SB.analyze(url, { hasPassword: true, linkOrigin: 'email' }, () => {});
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(conta.llm.length, 1);
  assert.equal(conta.sandbox.length, 1);
  assert.equal(conta.gsb.length, 1);
  assert.equal(conta.rdap.length, 1);
  libera();
});

test('crt.sh: oltre il tetto di dimensione «non si sa», a tempo scaduto «non ha risposto»', async () => {
  const realFetch = globalThis.fetch;
  try {
    const riga = JSON.stringify({ not_before: '2020-01-01T00:00:00' }) + ',';
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(c) {
        const pezzo = new TextEncoder().encode(riga.repeat(2000));
        c.enqueue(new TextEncoder().encode('['));
        for (let s = 0; s <= SB.net.CT_MAX_BYTES; s += pezzo.byteLength) c.enqueue(pezzo);
        c.close();
      },
    }), { status: 200 });
    assert.equal(await SB.net.ctFirstSeenDays('grande-esempio.com'), null);

    globalThis.fetch = async () => new Response('[{"not_before":"2020-01-01T00:00:00"}]', { status: 200 });
    const r = await SB.net.ctFirstSeenDays('piccolo-esempio.com');
    assert.ok(r.firstSeenDays > 365);

    globalThis.fetch = async () => { throw new DOMException('aborted', 'AbortError'); };
    assert.equal((await SB.net.ctFirstSeenDays('lento-esempio.com')).transient, true);
    globalThis.fetch = async () => new Response('', { status: 503 });
    assert.equal((await SB.net.rdapAgeDays('lento-esempio.com')).transient, true);
    globalThis.fetch = async () => new Response('{}', { status: 404 });
    assert.equal(await SB.net.rdapAgeDays('sconosciuto-esempio.ws'), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});
