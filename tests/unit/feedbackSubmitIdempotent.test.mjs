// Unit test: idempotenza dell'invio feedback (src/shared/feedback.js → submit).
//
// PERCHÉ (#370): un invio poteva andare in timeout lato UI ma riuscire sul
// server; l'utente, vedendo un (falso) errore, ripremeva "Invia" e ogni
// ripetizione creava un DOCUMENTO DUPLICATO (osservato: lo stesso feedback #360,
// #361, #362 + uno senza numero, a 30-40s l'uno dall'altro). Il fix dà a ogni
// composizione un `submissionId` stabile usato come documentId Firestore: un
// secondo create con lo stesso id torna 409 ALREADY_EXISTS e viene trattato come
// successo idempotente, non come un nuovo feedback.
//
// Pre-condizione che renderebbe rosso il test senza il fix: senza documentId il
// secondo create colpirebbe l'endpoint auto-id e creerebbe un secondo documento
// (o, col 409 simulato, `submit` lancerebbe invece di dedurre).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

// Stub di fetch che registra ogni URL create e risponde in modo controllato.
// - runQuery (nextSeq) → un solo doc con seq=5 → nextSeq=6
// - create sul collection → status pilotato da `createStatuses` (coda), body
//   con `name` così submit ricava l'id dal path.
function installFetch({ createStatuses }) {
  const createUrls = [];
  let ci = 0;
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes(':runQuery')) {
      return { ok: true, status: 200, json: async () => ([{ document: { fields: { seq: { integerValue: '5' } } } }]) };
    }
    // create endpoint (POST sul collection, non runQuery)
    createUrls.push(u);
    const status = createStatuses[ci++] ?? 200;
    if (status === 200) {
      return { ok: true, status, json: async () => ({ name: 'projects/p/databases/(default)/documents/feedback/DOC_' + ci }) };
    }
    return { ok: false, status, text: async () => `simulated ${status}` };
  };
  return { createUrls, restore() { globalThis.fetch = prev; } };
}

test('submit con submissionId crea il doc con quel documentId', async () => {
  const f = installFetch({ createStatuses: [200] });
  try {
    const r = await FB.submit({ text: 'ciao', submissionId: 'abc-123' });
    assert.equal(r.id, 'DOC_1', 'id atteso dal path della risposta');
    assert.ok(!r.deduped, 'primo invio: non deduplicato');
    assert.equal(f.createUrls.length, 1);
    assert.match(f.createUrls[0], /documentId=abc-123/, 'la create deve usare il documentId stabile');
  } finally { f.restore(); }
});

test('re-invio con lo stesso submissionId → 409 trattato come successo idempotente (nessun duplicato, niente throw)', async () => {
  const f = installFetch({ createStatuses: [409] });
  try {
    const r = await FB.submit({ text: 'ciao', submissionId: 'abc-123' });
    assert.equal(r.deduped, true, 'il 409 deve risultare in un successo deduplicato');
    assert.equal(r.id, 'abc-123', 'id = submissionId sul percorso idempotente');
    assert.equal(f.createUrls.length, 1, 'un solo tentativo di create');
  } finally { f.restore(); }
});

test('senza submissionId: nessun documentId nell\'endpoint e il 409 NON è idempotente (lancia)', async () => {
  // Endpoint auto-id: nessun param documentId.
  const ok = installFetch({ createStatuses: [200] });
  try {
    const r = await FB.submit({ text: 'ciao' });
    assert.equal(ok.createUrls.length, 1);
    assert.ok(!/documentId=/.test(ok.createUrls[0]), 'senza submissionId niente documentId');
    assert.ok(!r.deduped);
  } finally { ok.restore(); }

  const boom = installFetch({ createStatuses: [409] });
  try {
    await assert.rejects(
      () => FB.submit({ text: 'ciao' }),
      /firestore create fallito \(409\)/,
      'senza submissionId un 409 resta un errore (non c\'è idempotenza)',
    );
  } finally { boom.restore(); }
});

test('submissionId con caratteri illegali → id ripulito o ignorato, mai passato grezzo a Firestore', async () => {
  const f = installFetch({ createStatuses: [200] });
  try {
    await FB.submit({ text: 'ciao', submissionId: 'a/b/../__x__ !' });
    const url = f.createUrls[0];
    // Niente slash/spazi/punti grezzi nel documentId; se resta un id, è solo [A-Za-z0-9_-].
    const m = url.match(/documentId=([^&]*)/);
    if (m) {
      const decoded = decodeURIComponent(m[1]);
      assert.match(decoded, /^[A-Za-z0-9_-]+$/, 'documentId ripulito ai soli caratteri ammessi');
    }
  } finally { f.restore(); }
});
