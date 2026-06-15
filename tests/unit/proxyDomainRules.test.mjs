// Unit test per lo store delle regole proxy persistenti per dominio (#152)
// in src/shared/filoMemory.js: "questo sito sempre da <paese>". È logica pura
// sopra chrome.storage.local — qui mockato in-memory — quindi sta al livello
// base della piramide (niente Electron). Verifica il COMPORTAMENTO: la regola
// si salva, si rilegge per dominio, si rimuove, e sopravvive a una "rilettura"
// (= riavvio: i dati restano nello store, che in produzione è storage.json).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Store in-memory che imita chrome.storage.local (get/set per chiave). È la
// stessa superficie che filoMemory usa; in produzione la fornisce lo shim
// (→ storage.json), quindi questo test esercita la STESSA logica.
const backing = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(key) { return backing.has(key) ? { [key]: backing.get(key) } : {}; },
      async set(obj) { for (const [k, v] of Object.entries(obj)) backing.set(k, v); },
    },
  },
};

require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'filoMemory.js'));

const FM = globalThis.SN_FILO_MEMORY;

test('lista vuota di default', async () => {
  backing.clear();
  assert.deepEqual(await FM.listProxyRules(), {});
  assert.equal(await FM.getProxyRule('netflix.com'), null);
});

test('setProxyRule salva la regola e getProxyRule la rilegge per dominio', async () => {
  backing.clear();
  const saved = await FM.setProxyRule('netflix.com', { country: 'us' });
  assert.equal(saved.country, 'us');
  assert.ok(saved.ts, 'la regola ha un timestamp');
  const got = await FM.getProxyRule('netflix.com');
  assert.equal(got.country, 'us');
});

test('il dominio è normalizzato (case + www.) così il match in navigazione combacia', async () => {
  backing.clear();
  await FM.setProxyRule('WWW.Netflix.COM', { country: 'fr' });
  // Qualunque variante di case/www. ritrova la stessa regola.
  assert.equal((await FM.getProxyRule('netflix.com')).country, 'fr');
  assert.equal((await FM.getProxyRule('www.netflix.com')).country, 'fr');
  // Salvata sotto la chiave canonica, non duplicata.
  assert.deepEqual(Object.keys(await FM.listProxyRules()), ['netflix.com']);
});

test('un paese non valido NON salva nulla (mai una regola monca)', async () => {
  backing.clear();
  assert.equal(await FM.setProxyRule('netflix.com', { country: 'italia' }), null);
  assert.equal(await FM.setProxyRule('netflix.com', { country: '' }), null);
  assert.equal(await FM.setProxyRule('', { country: 'us' }), null);
  assert.deepEqual(await FM.listProxyRules(), {});
});

test('removeProxyRule toglie SOLO il dominio indicato', async () => {
  backing.clear();
  await FM.setProxyRule('netflix.com', { country: 'us' });
  await FM.setProxyRule('rai.it', { country: 'it' });
  await FM.removeProxyRule('www.netflix.com'); // normalizzato → netflix.com
  assert.equal(await FM.getProxyRule('netflix.com'), null);
  assert.equal((await FM.getProxyRule('rai.it')).country, 'it');
});

test('le regole sopravvivono a un "riavvio" (i dati restano nello store)', async () => {
  backing.clear();
  await FM.setProxyRule('netflix.com', { country: 'us', tier: 'residential' });
  // Simula il riavvio: ricarichiamo il modulo da zero su un NUOVO globalThis
  // namespace, ma lo store di backing (= storage.json su disco) è lo stesso.
  delete globalThis.SN_FILO_MEMORY;
  delete require.cache[require.resolve(join(__dirname, '..', '..', 'src', 'shared', 'filoMemory.js'))];
  require(join(__dirname, '..', '..', 'src', 'shared', 'filoMemory.js'));
  const FM2 = globalThis.SN_FILO_MEMORY;
  const got = await FM2.getProxyRule('netflix.com');
  assert.equal(got.country, 'us');
  assert.equal(got.tier, 'residential');
});
