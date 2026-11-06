// La soglia di compattazione che l'owner salva nei Modelli predefiniti (#1563): il salvataggio la scrive nel documento
// condiviso, la rilettura la conserva, e per chi non l'ha cambiata la chat compatta a quel valore.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'filoContesto.js'));
require(join(ROOT, 'src', 'main', 'services', 'providers', 'openrouter.js'));
require(join(ROOT, 'src', 'main', 'services', 'providers', 'index.js'));
require(join(ROOT, 'src', 'main', 'services', 'modelGate.js'));
const auth = require(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
const Defaults = require(join(ROOT, 'src', 'main', 'services', 'defaultsStore.js'));
const FC = globalThis.SN_FILO_CONTESTO;

test('la soglia di serie dell\'owner si salva, si rilegge e vale per la chat di chi non l\'ha cambiata', async () => {
  const origToken = auth.getIdToken;
  const origAdmin = auth.isAdmin;
  const origFetch = global.fetch;
  let salvato = null;
  auth.getIdToken = async () => null;
  auth.isAdmin = () => false;
  global.fetch = async (url, init = {}) => {
    if (init.method === 'PATCH') {
      if (String(url).includes('config/models')) salvato = JSON.parse(init.body).fields;
      return { ok: true, status: 200, async json() { return {}; }, async text() { return ''; } };
    }
    const fields = String(url).includes('config/models') && salvato ? salvato : {};
    return { ok: true, status: 200, async json() { return { fields }; }, async text() { return ''; } };
  };
  try {
    await Defaults.update({ contestoFilo: { soglia: '50000' } }, 'token-admin');
    assert.ok(salvato && salvato.contestoFilo, 'la soglia va nel documento condiviso');
    assert.equal(Defaults.get().contestoFilo.soglia, 50000, 'subito, prima della rilettura');
    await Defaults.refresh();
    assert.equal(Defaults.get().contestoFilo.soglia, 50000, 'riletta dal documento');
    const tetti = FC.tetti({}, Defaults.get().contestoFilo);
    assert.equal(tetti.soglia, 50000);
    assert.equal(tetti.da.soglia, 'owner');
    assert.equal(FC.tetti({ soglia: 40000 }, Defaults.get().contestoFilo).soglia, 40000, 'chi l\'ha cambiata tiene la sua');
  } finally {
    auth.getIdToken = origToken;
    auth.isAdmin = origAdmin;
    global.fetch = origFetch;
  }
});
