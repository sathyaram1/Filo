// «Tieni sempre aperto X» (#823): forma delle voci, quali schede coprono, cosa toglie «non tenerla più aperta»,
// e il giro in memoria (salvate, viste nelle Preferenze, dimenticate dalla × o a voce).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const backing = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(key) { return backing.has(key) ? { [key]: structuredClone(backing.get(key)) } : {}; },
      async set(obj) { for (const [k, v] of Object.entries(obj)) backing.set(k, structuredClone(v)); },
    },
  },
};

require(join(root, 'src', 'shared', 'constants.js'));
require(join(root, 'src', 'shared', 'filoMemory.js'));
require(join(root, 'src', 'shared', 'tabTriage.js'));
const SempreAperte = require(join(root, 'src', 'main', 'services', 'sempreAperte.js'));

const T = globalThis.SN_TAB_TRIAGE;
const FM = globalThis.SN_FILO_MEMORY;

test('la voce è l\'host, da un dominio detto o da un indirizzo', () => {
  assert.equal(T.hostTenuto('web.whatsapp.com'), 'web.whatsapp.com');
  assert.equal(T.hostTenuto('https://web.whatsapp.com/chat?x=1#y'), 'web.whatsapp.com');
  assert.equal(T.hostTenuto('  WWW.Example.ORG  '), 'example.org');
  assert.equal(T.hostTenuto('http://example.org:8080/a'), 'example.org');
  assert.equal(T.hostTenuto('example.org.'), 'example.org');
});

test('quello che non è un sito non diventa una voce', () => {
  for (const v of ['', '   ', null, undefined, 'whatsapp', 'filo://newtab/', 'file:///C:/x.txt', 'javascript:alert(1)',
    '<b>x</b>.com', 'ciao mondo.com', '🙂']) {
    assert.equal(T.hostTenuto(v), '', `«${v}» non è un sito`);
  }
});

test('una voce tiene aperte le schede del suo host e dei sottodomini, non i vicini', () => {
  const voci = ['whatsapp.com', 'docs.google.com'];
  assert.equal(T.voceTenuta('https://web.whatsapp.com/', voci), 'whatsapp.com');
  assert.equal(T.voceTenuta('https://whatsapp.com/download', voci), 'whatsapp.com');
  assert.equal(T.voceTenuta('https://docs.google.com/document/d/1', voci), 'docs.google.com');
  assert.equal(T.voceTenuta('https://www.google.com/search?q=docs', voci), null);
  assert.equal(T.voceTenuta('https://notwhatsapp.com/', voci), null);
  assert.equal(T.voceTenuta('https://whatsapp.com.evil.example/', voci), null);
  assert.equal(T.voceTenuta('filo://newtab/', voci), null);
  assert.equal(T.voceTenuta('https://web.whatsapp.com/', undefined), null);
});

test('«non tenerla più aperta» toglie la voce che copre il sito e quelle sotto il dominio detto', () => {
  const voci = ['web.whatsapp.com', 'example.org'];
  assert.deepEqual(T.vociDaTogliere('whatsapp.com', voci), ['web.whatsapp.com']);
  assert.deepEqual(T.vociDaTogliere('https://web.whatsapp.com/', voci), ['web.whatsapp.com']);
  assert.deepEqual(T.vociDaTogliere('https://www.example.org/pagina', voci), ['example.org']);
  assert.deepEqual(T.vociDaTogliere('google.com', voci), []);
  assert.deepEqual(T.vociDaTogliere('', voci), []);
});

test('una macchina senza punto si tiene aperta se è detta come indirizzo (#823 giro 1)', () => {
  assert.equal(T.hostTenuto('localhost'), 'localhost');
  assert.equal(T.hostTenuto('localhost:3000'), 'localhost');
  assert.equal(T.hostTenuto('http://localhost:5173/app'), 'localhost');
  assert.equal(T.hostTenuto('http://nas:5000/'), 'nas');
  assert.equal(T.hostTenuto('intranet:8080'), 'intranet');
  assert.equal(T.hostTenuto('http://intranet/'), 'intranet');
  assert.equal(T.hostTenuto('http://[::1]:3000/'), '[::1]');
  assert.equal(T.hostTenuto('whatsapp'), '');
  assert.equal(SempreAperte.voceDa('http://localhost:3000/'), 'localhost');
  assert.equal(SempreAperte.voceDa('http://nas:5000/'), 'nas');
  assert.equal(SempreAperte.voceDa('http://[::1]:3000/'), '[::1]');
  assert.equal(SempreAperte.voceDa('127.0.0.1:8080'), '127.0.0.1');
  assert.equal(T.voceTenuta('http://localhost:3000/x', ['localhost']), 'localhost');
  assert.equal(T.voceTenuta('http://nas:5000/', ['nas']), 'nas');
  assert.equal(T.voceTenuta('https://nas.example.org/', ['nas']), null);
  assert.deepEqual(T.vociDaTogliere('http://localhost:3000/', ['localhost', 'example.org']), ['localhost']);
});

test('un suffisso pubblico non si salva: terrebbe aperto mezzo web', () => {
  assert.equal(SempreAperte.voceDa('example.org'), 'example.org');
  assert.equal(SempreAperte.voceDa('https://web.whatsapp.com/'), 'web.whatsapp.com');
  assert.equal(SempreAperte.voceDa('co.uk'), '');
  assert.equal(SempreAperte.voceDa('github.io'), '');
  assert.equal(SempreAperte.voceDa('alice.github.io'), 'alice.github.io');
});

test('salvata, la voce si vede nella memoria e la × la toglie', async () => {
  backing.clear();
  assert.equal(await FM.addKeepOpen('web.whatsapp.com'), 'web.whatsapp.com');
  await FM.addKeepOpen('example.org');
  await FM.addKeepOpen('example.org');
  const vista = await FM.viewForUser();
  assert.deepEqual(vista.sempreAperte, ['example.org', 'web.whatsapp.com']);
  assert.equal(await FM.forgetLine({ sempreAperta: 'example.org' }), true);
  assert.equal(await FM.forgetLine({ sempreAperta: 'example.org' }), false, 'la seconda volta non c\'è più');
  assert.deepEqual((await FM.viewForUser()).sempreAperte, ['web.whatsapp.com']);
});

test('«dimentica che tengo aperto WhatsApp» la trova fra le righe della memoria', async () => {
  backing.clear();
  await FM.addKeepOpen('web.whatsapp.com');
  const righe = await FM.findLines('whatsapp');
  assert.equal(righe.length, 1);
  assert.deepEqual(righe[0].via, { sempreAperta: 'web.whatsapp.com' });
  assert.equal(await FM.forgetLine(righe[0].via), true);
  assert.deepEqual(await FM.listKeepOpen(), {});
});

test('due voci salvate insieme restano tutte e due, anche con la scrittura lenta', async () => {
  backing.clear();
  const set = globalThis.chrome.storage.local.set;
  globalThis.chrome.storage.local.set = async (obj) => { await new Promise((r) => setTimeout(r, 20)); return set(obj); };
  try {
    await Promise.all([FM.addKeepOpen('web.whatsapp.com'), FM.addKeepOpen('mail.google.com'), FM.addKeepOpen('example.org')]);
    await Promise.all([FM.removeKeepOpen(['example.org']), FM.addKeepOpen('docs.google.com')]);
  } finally {
    globalThis.chrome.storage.local.set = set;
  }
  assert.deepEqual(Object.keys(await FM.listKeepOpen()).sort(), ['docs.google.com', 'mail.google.com', 'web.whatsapp.com']);
});

test('a ogni cambio delle voci le Preferenze aperte vengono avvisate', async () => {
  backing.clear();
  let avvisi = 0;
  FM.setOnMemoryChange(() => { avvisi += 1; });
  try {
    await FM.addKeepOpen('example.org');
    await FM.removeKeepOpen(['example.org']);
    await FM.removeKeepOpen(['example.org']);
  } finally {
    FM.setOnMemoryChange(null);
  }
  assert.equal(avvisi, 2, 'togliere una voce che non c\'è non scrive niente');
});
