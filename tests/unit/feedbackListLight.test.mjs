// Unit test per le letture "leggere" di src/shared/feedback.js usate
// dall'aggiornamento continuo della dashboard:
//   - list({ fields }) chiede a Firestore una proiezione (solo quei campi);
//   - listVersions() torna id + ultima scrittura, senza campi;
//   - getMany(ids) legge i documenti indicati in UNA richiesta (batchGet);
//   - ogni documento letto porta `_updateTime`.
// La rete è finta (fetch sostituita): si verifica COSA viene chiesto e come si
// legge la risposta. Gira via `npm run test:unit`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

const DOC_PREFIX = `${FB.rest.FIRESTORE_BASE}/feedback/`;

function fsDoc(id, fields, updateTime) {
  return {
    name: DOC_PREFIX + id,
    createTime: '2026-09-01T00:00:00Z',
    updateTime,
    fields,
  };
}

// fetch finta: registra le chiamate e risponde con quanto passato.
function withFetch(respond, fn) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
    const payload = respond(String(url), calls[calls.length - 1].body);
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  return fn(calls).finally(() => { globalThis.fetch = orig; });
}

test('list({ fields }) chiede una proiezione; senza fields no', async () => {
  await withFetch(() => [], async (calls) => {
    await FB.list({ pageSize: 10, fields: ['__name__'] });
    await FB.list({ pageSize: 10 });
    assert.deepEqual(calls[0].body.structuredQuery.select, { fields: [{ fieldPath: '__name__' }] });
    assert.equal(calls[1].body.structuredQuery.select, undefined);
  });
});

test('ogni documento letto porta _updateTime', async () => {
  const rows = [{ document: fsDoc('a', { name: { stringValue: 'A' } }, '2026-09-04T09:00:00Z') }];
  await withFetch(() => rows, async () => {
    const [a] = await FB.list({ pageSize: 10 });
    assert.equal(a._id, 'a');
    assert.equal(a.name, 'A');
    assert.equal(a._updateTime, '2026-09-04T09:00:00Z');
  });
});

test('listVersions: solo id e ultima scrittura, nell\'ordine della pagina', async () => {
  const rows = [
    { document: fsDoc('b', {}, 't2') },
    { document: fsDoc('a', {}, 't1') },
    { readTime: 'x' }, // riga senza documento: ignorata
  ];
  await withFetch((url, body) => {
    assert.ok(url.includes(':runQuery'));
    assert.deepEqual(body.structuredQuery.select, { fields: [{ fieldPath: '__name__' }] });
    return rows;
  }, async () => {
    const v = await FB.listVersions({ pageSize: 10 });
    assert.deepEqual(v, [{ _id: 'b', _updateTime: 't2' }, { _id: 'a', _updateTime: 't1' }]);
  });
});

test('getMany: una sola richiesta batchGet, torna solo i trovati', async () => {
  const reply = [
    { found: fsDoc('a', { name: { stringValue: 'A' } }, 't1'), readTime: 'x' },
    { missing: DOC_PREFIX + 'zz', readTime: 'x' },
  ];
  await withFetch(() => reply, async (calls) => {
    const out = await FB.getMany(['a', 'zz']);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes(':batchGet'));
    assert.deepEqual(calls[0].body.documents, [DOC_PREFIX + 'a', DOC_PREFIX + 'zz']);
    assert.equal(out.length, 1);
    assert.equal(out[0]._id, 'a');
    assert.equal(out[0].name, 'A');
    assert.equal(out[0]._updateTime, 't1');
  });
});

test('getMany: senza id non tocca la rete', async () => {
  await withFetch(() => { throw new Error('non doveva chiamare'); }, async (calls) => {
    assert.deepEqual(await FB.getMany([]), []);
    assert.deepEqual(await FB.getMany(null), []);
    assert.equal(calls.length, 0);
  });
});
