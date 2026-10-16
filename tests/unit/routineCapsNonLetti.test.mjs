// Le impostazioni del giro (bilanci, istruzioni per chi corregge) non lette dal
// server non si fingono lette: «non impostato» deve essere una parola del server.

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

test('senza rete la lettura fallisce dichiarandolo, non risponde coi bilanci vuoti', async () => {
  await conFetch(async () => { throw new Error('offline'); }, async () => {
    await assert.rejects(() => Defaults.getRoutineCaps('tok'), /non raggiungibili/);
  });
  await conFetch(async () => ({ ok: false, status: 503, async json() { return {}; }, async text() { return ''; } }), async () => {
    await assert.rejects(() => Defaults.getRoutineCaps('tok'), /non raggiungibili/);
  });
});

// Il giro stretto è stato tolto (#1203), ma il suo campo può restare nel documento del server.
test('un bilancio che manca resta vuoto, e un campo tolto rimasto nel documento non torna nella risposta', async () => {
  await conFetch(async () => risposta({ cap2: { integerValue: '3' }, giroStretto: { booleanValue: true } }), async () => {
    assert.deepEqual(await Defaults.getRoutineCaps('tok'), { fixInstructions: '', cap3: null, cap2: 3, cap1: null, cap0: null });
  });
});

test('scritto ma non riletto: il salvataggio riuscito torna col valore scritto, non come un guasto', async () => {
  const scritture = [];
  await conFetch(async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'PATCH') { scritture.push(String(url)); return risposta({}); }
    throw new Error('offline');
  }, async () => {
    const i = await Defaults.setRoutineCaps({ fixInstructions: 'Correggi la causa.' }, 'tok');
    assert.equal(i.fixInstructions, 'Correggi la causa.');
    const c = await Defaults.setRoutineCaps({ cap2: 4, giroStretto: true }, 'tok');
    assert.equal(c.cap2, 4);
    assert.ok(!('giroStretto' in c));
  });
  assert.equal(scritture.length, 2);
  assert.match(scritture[0], /fixInstructions/);
  assert.doesNotMatch(scritture[1], /giroStretto/, 'un campo tolto non si scrive più');
});
