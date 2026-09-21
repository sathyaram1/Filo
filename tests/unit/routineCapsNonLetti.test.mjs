// Le impostazioni del giro (bilanci, giro stretto) non lette dal server non si
// fingono lette: «spento» e «non impostato» devono essere parole del server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const Defaults = require(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'main', 'services', 'defaultsStore.js'));

const risposta = (fields) => ({ ok: true, status: 200, async json() { return { fields }; }, async text() { return ''; } });

async function conFetch(finto, fn) {
  const vero = global.fetch;
  global.fetch = finto;
  try { return await fn(); } finally { global.fetch = vero; }
}

test('senza rete la lettura fallisce dichiarandolo, non risponde «giro stretto spento»', async () => {
  await conFetch(async () => { throw new Error('offline'); }, async () => {
    await assert.rejects(() => Defaults.getRoutineCaps('tok'), /non raggiungibili/);
  });
  await conFetch(async () => ({ ok: false, status: 503, async json() { return {}; }, async text() { return ''; } }), async () => {
    await assert.rejects(() => Defaults.getRoutineCaps('tok'), /non raggiungibili/);
  });
});

test('un documento che c’è ma senza il campo vale spento, e un true esplicito vale acceso', async () => {
  await conFetch(async () => risposta({ cap2: { integerValue: '3' } }), async () => {
    const r = await Defaults.getRoutineCaps('tok');
    assert.equal(r.giroStretto, false);
    assert.equal(r.cap2, 3);
  });
  await conFetch(async () => risposta({ giroStretto: { booleanValue: true } }), async () => {
    assert.equal((await Defaults.getRoutineCaps('tok')).giroStretto, true);
  });
});

test('scritto ma non riletto: il salvataggio riuscito torna col valore scritto, non come un guasto', async () => {
  const scritture = [];
  await conFetch(async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'PATCH') { scritture.push(String(url)); return risposta({}); }
    throw new Error('offline');
  }, async () => {
    const r = await Defaults.setRoutineCaps({ giroStretto: true }, 'tok');
    assert.equal(r.giroStretto, true);
    const c = await Defaults.setRoutineCaps({ cap2: 4 }, 'tok');
    assert.equal(c.cap2, 4);
  });
  assert.equal(scritture.length, 2);
  assert.match(scritture[0], /giroStretto/);
});
