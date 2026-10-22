// La diagnosi delle passkey (#1608) registra la forma della richiesta senza gli id, completa i trasporti con
// «hybrid» solo a interruttore e senza toccare l'oggetto della pagina, e lascia passare esito ed errore.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildSource } = require('../../src/preload/passkey-diagnosi.js');

function pagina({ hybrid, esito }) {
  const logs = [];
  const ricevute = [];
  const ctx = {
    location: { origin: 'https://accounts.google.com' },
    console: { log: (s) => logs.push(String(s)) },
    navigator: {
      credentials: {
        get(opts) { ricevute.push(opts); return esito(); },
        create(opts) { ricevute.push(opts); return esito(); },
      },
    },
    Object, Array, JSON, Promise, Error, Uint8Array,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(buildSource({ hybrid }), ctx);
  return { ctx, logs, ricevute };
}

const richiesta = () => ({
  mediation: 'optional',
  publicKey: {
    rpId: 'google.com',
    challenge: new Uint8Array(32),
    userVerification: 'required',
    allowCredentials: [
      { type: 'public-key', id: new Uint8Array(16), transports: ['internal'] },
      { type: 'public-key', id: new Uint8Array(20), transports: ['internal', 'hybrid'] },
      { type: 'public-key', id: new Uint8Array(12) },
    ],
  },
});

test('registra la forma della richiesta e l\'errore, senza gli id', async () => {
  const errore = Object.assign(new Error('no'), { name: 'NotAllowedError' });
  const { ctx, logs, ricevute } = pagina({ hybrid: false, esito: () => Promise.reject(errore) });
  const opts = richiesta();
  await assert.rejects(ctx.navigator.credentials.get(opts), errore);
  const riga = logs.find((l) => l.includes('richiesta '));
  const r = JSON.parse(riga.slice(riga.indexOf('{')));
  assert.equal(r.rpId, 'google.com');
  assert.equal(r.mediation, 'optional');
  assert.deepEqual(r.credenziali.map((c) => c.idLen), [16, 20, 12]);
  assert.deepEqual(r.credenziali[0].transports, ['internal']);
  assert.equal(r.credenziali[2].transports, null);
  assert.ok(!riga.includes('challenge'), 'la sfida non si registra');
  assert.equal(r.hybridAggiunto, undefined, 'spento, non completa');
  assert.ok(logs.some((l) => l.includes('esito get errore NotAllowedError')));
  assert.equal(ricevute[0], opts, 'spento, passa l\'oggetto della pagina com\'è');
});

test('a interruttore aggiunge hybrid in una copia, solo dove manca', async () => {
  const { ctx, logs, ricevute } = pagina({ hybrid: true, esito: () => Promise.resolve({ type: 'public-key', authenticatorAttachment: 'cross-platform' }) });
  const opts = richiesta();
  await ctx.navigator.credentials.get(opts);
  const inviata = ricevute[0];
  assert.notEqual(inviata, opts);
  assert.deepEqual(inviata.publicKey.allowCredentials.map((c) => c.transports), [['internal', 'hybrid'], ['internal', 'hybrid'], undefined]);
  assert.deepEqual(opts.publicKey.allowCredentials[0].transports, ['internal'], 'l\'oggetto della pagina resta intatto');
  assert.equal(inviata.publicKey.challenge, opts.publicKey.challenge);
  const riga = logs.find((l) => l.includes('richiesta '));
  assert.equal(JSON.parse(riga.slice(riga.indexOf('{'))).hybridAggiunto, 1);
  assert.ok(logs.some((l) => l.includes('esito get ok tipo=public-key attacco=cross-platform')));
});

test('la funzione avvolta si presenta come l\'originale', () => {
  const { ctx } = pagina({ hybrid: true, esito: () => Promise.resolve(null) });
  const get = ctx.navigator.credentials.get;
  assert.equal(get.name, 'get');
  assert.equal(get.length, 1, 'stessa arità della finta originale');
  assert.ok(String(get).includes('ricevute.push'), 'toString mostra il testo dell\'originale');
  assert.ok(!String(get).includes('riassunto'));
  assert.ok(!String(ctx.Function.prototype.toString).includes('originali'), 'anche toString si maschera');
});

test('senza publicKey (password, federated) non registra e non tocca', async () => {
  const { ctx, logs, ricevute } = pagina({ hybrid: true, esito: () => Promise.resolve(null) });
  const opts = { password: true };
  await ctx.navigator.credentials.get(opts);
  assert.equal(ricevute[0], opts);
  assert.ok(!logs.some((l) => l.includes('richiesta ')));
});
