// Lo script dell'owner nelle mani di una sessione locale (#908): il segno «solo in
// locale» solo su pratiche dell'owner o di una sessione con la prova, mai su un
// utente (che torna nei Ricevuti), e nessuna partenza dai Ricevuti. Rete finta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);

const campo = (v) => (typeof v === 'string' ? { stringValue: v } : v);
function documento(id, f) {
  const fields = {};
  for (const [k, v] of Object.entries(f)) if (v !== undefined) fields[k] = campo(v);
  return { name: `projects/p/databases/(default)/documents/feedback/${id}`, fields };
}

/** fetch finto: le GET rendono `doc`, le PATCH si registrano e rispondono ok. */
async function conRete(doc, fn) {
  const patch = [];
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'PATCH') {
      patch.push({ url: String(url), body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => doc, text: async () => '' };
  };
  try { return await fn(patch); } finally { globalThis.fetch = vero; }
}

const OPTS = { bearer: 'tok-finto' };

test('--solo-locale su una pratica di una sessione con la prova: scrive { by, at } in millisecondi', async () => {
  const doc = documento('abc', { clientId: 'local:claude', senderProof: 'admin', status: 'todo', statusPublic: 'open' });
  await conRete(doc, async (patch) => {
    const r = await mod.segnaLocale('abc', true, OPTS);
    assert.equal(r.ok, true, r.motivo);
    assert.equal(patch.length, 1);
    assert.match(patch[0].url, /updateMask\.fieldPaths=localOnly/);
    const lo = patch[0].body.fields.localOnly.mapValue.fields;
    assert.ok(lo.by.stringValue);
    assert.match(lo.at.integerValue, /^\d{13}$/);
  });
});

test('--solo-locale su un utente: rifiutato senza scrivere, e la risposta dice che è un utente', async () => {
  const doc = documento('u1', { clientId: 'c-sconosciuto', status: 'todo', statusPublic: 'open' });
  await conRete(doc, async (patch) => {
    const r = await mod.segnaLocale('u1', true, OPTS);
    assert.equal(r.ok, false);
    assert.equal(r.utente, true);
    assert.equal(patch.length, 0);
  });
});

test('--solo-locale su un falso local: (senza prova) vale come un utente', async () => {
  const doc = documento('f1', { clientId: 'local:claude', status: 'todo', statusPublic: 'open' });
  await conRete(doc, async (patch) => {
    const r = await mod.segnaLocale('f1', true, OPTS);
    assert.deepEqual([r.ok, r.utente], [false, true]);
    assert.equal(patch.length, 0);
  });
});

test('--non-locale toglie il segno: maschera sul campo, nessun valore', async () => {
  const doc = documento('abc', {
    clientId: 'owner:me', senderProof: 'admin', status: 'working', statusPublic: 'open',
    localOnly: { mapValue: { fields: { by: { stringValue: 'o@x' }, at: { integerValue: '1790000000000' } } } },
  });
  await conRete(doc, async (patch) => {
    const r = await mod.segnaLocale('abc', false, OPTS);
    assert.equal(r.ok, true, r.motivo);
    assert.equal(patch.length, 1);
    assert.deepEqual(patch[0].body.fields, {});
  });
});

test('nessuna partenza dai Ricevuti né dalle conferme: rifiuto prima di scrivere', async () => {
  for (const from of ['unlabeled', 'suspicious_file', 'attack', 'spam', 'design', 'aligned', 'attack_confirmed']) {
    assert.ok(mod.partenzaVietata(from), from);
    const doc = documento('r1', { status: from, notes: '' });
    await conRete(doc, async (patch) => {
      const r = await mod.scrivi('r1', 'todo', 'nota', OPTS);
      assert.equal(r.ok, false, from);
      assert.match(r.motivo, /Ricevuti|conferma/);
      assert.equal(patch.length, 0, from);
    });
  }
  for (const from of ['todo', 'working', 'done', 'archived']) assert.equal(mod.partenzaVietata(from), '', from);
});

test('--serve-locale: il feedback di un utente torna nei Ricevuti, design, motivo locale', async () => {
  const doc = documento('u2', { clientId: 'c-utente', status: 'todo', statusPublic: 'open', notes: '' });
  await conRete(doc, async (patch) => {
    const r = await mod.serveLocale('u2', 'tocca le chiavi', { ...OPTS, dryRun: true });
    assert.equal(r.ok, true, r.motivo);
    assert.deepEqual([r.from, r.to], ['todo', 'design']);
    assert.ok(r.campi.includes('statusReason'));
    assert.equal(patch.length, 0, 'prova a vuoto');
  });
  // Sul serio: la nota lo dice, il motivo è `locale`.
  await conRete(doc, async (patch) => {
    const r = await mod.serveLocale('u2', 'tocca le chiavi', OPTS);
    assert.equal(r.ok, true, r.motivo);
    assert.equal(patch.length, 1);
    assert.equal(patch[0].body.fields.statusReason.stringValue, 'locale');
    assert.equal(patch[0].body.fields.statusPublic.stringValue, 'open');
  });
});

test('--serve-locale non serve sulle pratiche proprie, né su quelle già nei Ricevuti', async () => {
  await conRete(documento('o1', { clientId: 'owner:me', senderProof: 'admin', status: 'todo' }), async (patch) => {
    const r = await mod.serveLocale('o1', '', OPTS);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /--solo-locale/);
    assert.equal(patch.length, 0);
  });
  await conRete(documento('u3', { clientId: 'c', status: 'design' }), async (patch) => {
    const r = await mod.serveLocale('u3', '', OPTS);
    assert.equal(r.ok, false);
    assert.equal(patch.length, 0);
  });
});
