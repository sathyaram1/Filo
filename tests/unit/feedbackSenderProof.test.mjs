// #595 — la prova del mittente in SN_FEEDBACK.submit. Col token admin la create
// parte autenticata e porta `senderProof: 'admin'`; senza, la richiesta resta
// quella anonima di sempre. Le regole che la rendono una prova:
// tests/unit/firestoreRulesSenderProof.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'feedbackPublicKey.js'));
require(join(ROOT, 'src', 'shared', 'feedbackCrypto.js'));
require(join(ROOT, 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

// Registra OGNI richiesta; la create risponde con gli stati in coda.
function installFetch(createStatuses = [200]) {
  const richieste = [];
  const create = [];
  let ci = 0;
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const r = { url: u, method: opts.method || 'GET', headers: { ...(opts.headers || {}) }, body: opts.body ? JSON.parse(opts.body) : null };
    richieste.push(r);
    if (u.includes('/counters/')) {
      if (r.method === 'PATCH') return { ok: true, status: 200, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ fields: { value: { integerValue: '5' } }, updateTime: 't' }) };
    }
    create.push(r);
    const status = createStatuses[ci++] ?? 200;
    if (status === 200) return { ok: true, status, json: async () => ({ name: 'projects/p/databases/(default)/documents/feedback/DOC' }) };
    return { ok: false, status, text: async () => `simulated ${status}` };
  };
  return { richieste, create, restore() { globalThis.fetch = prev; } };
}

test('anonimo: nessuna intestazione Authorization e nessun senderProof', async () => {
  const f = installFetch();
  try {
    const r = await FB.submit({ text: 'ciao', clientId: 'owner:finto' });
    assert.equal(f.create.length, 1);
    assert.equal(f.create[0].headers.Authorization, undefined);
    assert.deepEqual(Object.keys(f.create[0].headers), ['Content-Type']);
    assert.ok(!('senderProof' in f.create[0].body.fields));
    assert.ok(!('senderProof' in r), 'il risultato anonimo non cambia forma');
  } finally { f.restore(); }
});

test('col token admin: create autenticata con senderProof admin, token solo sulla create', async () => {
  const f = installFetch();
  try {
    const r = await FB.submit({ text: 'ciao', clientId: 'local:claude' }, { idToken: 'tok-admin' });
    assert.equal(f.create.length, 1);
    assert.equal(f.create[0].method, 'POST');
    assert.equal(f.create[0].headers.Authorization, 'Bearer tok-admin');
    assert.deepEqual(f.create[0].body.fields.senderProof, { stringValue: 'admin' });
    assert.equal(r.senderProof, 'admin');
    const altrove = f.richieste.filter((q) => q !== f.create[0] && JSON.stringify(q).includes('tok-admin'));
    assert.deepEqual(altrove, [], 'il token non viaggia verso il contatore o altro');
  } finally { f.restore(); }
});

test('token rifiutato: si riparte anonimi, senza prova, e il risultato lo dice', async () => {
  for (const rifiuto of [401, 403]) {
    const f = installFetch([rifiuto, 200]);
    try {
      const r = await FB.submit({ text: 'ciao', clientId: 'owner:abc' }, { idToken: 'tok-scaduto' });
      assert.equal(f.create.length, 2);
      assert.equal(f.create[1].headers.Authorization, undefined);
      assert.ok(!('senderProof' in f.create[1].body.fields), 'la seconda create è quella anonima');
      assert.equal(r.senderProof, '');
      assert.equal(r.authRefused, rifiuto);
      assert.equal(r.id, 'DOC');
    } finally { f.restore(); }
  }
});
