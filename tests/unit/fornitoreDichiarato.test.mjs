// Unit test — il fornitore dichiarato nella configurazione condivisa non resta
// su un fornitore che Filo non chiama più (#663): l'editor «Modelli predefiniti»
// non mostra quel campo, quindi è il salvataggio a riscriverlo e a togliere i
// campi del fornitore ritirato; e finché nessuno salva, la lettura non lo eredita.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'tests', 'fixtures', 'testModels.js'));
const Defaults = require(join(ROOT, 'src', 'main', 'services', 'defaultsStore.js'));
const auth = require(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));

// Firestore finto con la semantica vera della PATCH: un campo nella maschera e
// assente dal corpo viene cancellato.
async function conFirestore(docIniziale, fn) {
  const fetchVero = global.fetch;
  const tokenVero = auth.getIdToken;
  auth.getIdToken = async () => 'token-admin-finto';
  const doc = { fields: { ...docIniziale } };
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/config/models')) {
      if (opts.method === 'PATCH') {
        const corpo = JSON.parse(opts.body).fields || {};
        for (const campo of u.searchParams.getAll('updateMask.fieldPaths')) {
          if (campo in corpo) doc.fields[campo] = corpo[campo];
          else delete doc.fields[campo];
        }
      }
      return { ok: true, status: 200, json: async () => doc, text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => ({ fields: {} }), text: async () => '' };
  };
  try { return await fn(doc); } finally { global.fetch = fetchVero; auth.getIdToken = tokenVero; }
}

const RITIRATO = { provider: { stringValue: 'gemini' }, geminiDirect: { booleanValue: true } };

test('finché nessuno salva, la configurazione letta non dichiara il fornitore ritirato', async () => {
  await conFirestore(RITIRATO, async () => {
    const eff = await Defaults.refresh();
    assert.equal(eff.provider, 'openrouter');
  });
});

test('salvare «Modelli predefiniti» riscrive il fornitore e toglie i campi di quello ritirato', async () => {
  await conFirestore(RITIRATO, async (doc) => {
    // Quello che l'editor manda: modelli e registro, nessun fornitore.
    await Defaults.update({ models: {}, modelRegistry: {} }, 'token-admin-finto');
    assert.equal(doc.fields.provider?.stringValue, 'openrouter');
    assert.equal('geminiDirect' in doc.fields, false);
  });
});

test('un fornitore ritirato chiesto per nome non si scrive', async () => {
  await conFirestore({}, async (doc) => {
    await Defaults.update({ provider: 'gemini' }, 'token-admin-finto');
    assert.equal(doc.fields.provider?.stringValue, 'openrouter');
  });
});

test('salvare solo le chiavi non tocca il doc dei modelli', async () => {
  await conFirestore(RITIRATO, async (doc) => {
    await Defaults.update({ apiKeys: { tavily: 'k' } }, 'token-admin-finto');
    assert.equal(doc.fields.provider?.stringValue, 'gemini');
  });
});
