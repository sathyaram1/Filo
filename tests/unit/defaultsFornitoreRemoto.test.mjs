// Il fornitore scritto nel documento condiviso config/models vale solo se Filo sa usarlo e la politica
// sui modelli lo ammette. Il documento diceva ancora 'gemini' dopo che l'API di Google era uscita da Filo:
// ogni controllo `apiKeys[provider]` restava vuoto per tutti, e home, benvenuto e lezioni non partivano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'main', 'services', 'providers', 'openrouter.js'));
require(join(ROOT, 'src', 'main', 'services', 'providers', 'index.js'));
require(join(ROOT, 'src', 'main', 'services', 'modelGate.js'));
const auth = require(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
const Defaults = require(join(ROOT, 'src', 'main', 'services', 'defaultsStore.js'));

async function conDocumento(provider, fn) {
  const origToken = auth.getIdToken;
  const origAdmin = auth.isAdmin;
  const origFetch = global.fetch;
  auth.getIdToken = async () => null;
  auth.isAdmin = () => false;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return { fields: { provider: { stringValue: provider } } }; },
    async text() { return ''; },
  });
  try {
    await Defaults.refresh();
    return await fn();
  } finally {
    auth.getIdToken = origToken;
    auth.isAdmin = origAdmin;
    global.fetch = origFetch;
  }
}

test('il documento che dice ancora «gemini» non toglie il fornitore di Filo', async () => {
  await conDocumento('gemini', () => {
    assert.equal(Defaults.get().provider, 'openrouter',
      'un fornitore che Filo non ha più non può diventare quello in uso: nessuna chiave lo trova');
  });
});

test('un fornitore che Filo sa usare, scelto dall’owner, resta quello in uso', async () => {
  globalThis.SN_PROVIDER_LOCALE = { complete() {}, streamComplete() {}, listModels() {} };
  try {
    await conDocumento('locale', () => {
      assert.equal(Defaults.get().provider, 'locale');
    });
  } finally {
    delete globalThis.SN_PROVIDER_LOCALE;
  }
});

test('l’API diretta di un produttore resta fuori anche quando Filo saprebbe chiamarla', async () => {
  const diretti = globalThis.SN_CONST.PRODUCER_DIRECT_PROVIDERS;
  globalThis.SN_PROVIDER_PRODUTTORE = { complete() {}, streamComplete() {}, listModels() {} };
  diretti.push('produttore');
  try {
    await conDocumento('produttore', () => {
      assert.equal(Defaults.get().provider, 'openrouter');
    });
  } finally {
    diretti.splice(diretti.indexOf('produttore'), 1);
    delete globalThis.SN_PROVIDER_PRODUTTORE;
  }
});
