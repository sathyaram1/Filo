// #724.1 — la chat aspetta i cambi prima di ogni turno: con il servizio dei
// cambi giù, ogni messaggio ripagava l'attesa della rete. Dopo un guasto i
// cambi di riserva arrivano subito, senza un nuovo tentativo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const archivio = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => ({ [k]: archivio[k] }),
      set: async (o) => { Object.assign(archivio, o); },
    },
  },
};
let chiamate = 0;
globalThis.fetch = async () => { chiamate += 1; throw new Error('rete giù'); };

require(join(ROOT, 'src', 'main', 'services', 'fxRates.js'));
const Fx = globalThis.SN_FX;

test('col servizio dei cambi giù, il turno dopo non riprova la rete e ha già le stime', async () => {
  const primo = await Fx.get();
  assert.equal(chiamate, 1);
  assert.ok(primo.stale && primo.rates.INR, 'al primo guasto arrivano i cambi di riserva');
  const secondo = await Fx.get();
  assert.equal(chiamate, 1, 'il secondo turno ha riprovato la rete dopo un guasto appena visto');
  assert.ok(secondo.rates.INR);
});
