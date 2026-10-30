// Unit test: idempotenza dell'invio feedback (src/shared/feedback.js → submit).
//
// PERCHÉ (#370): un invio poteva andare in timeout lato UI ma riuscire sul
// server; l'utente, vedendo un (falso) errore, ripremeva "Invia" e ogni
// ripetizione creava un DOCUMENTO DUPLICATO (osservato: lo stesso feedback #360,
// #361, #362 + uno senza numero, a 30-40s l'uno dall'altro). Il fix dà a ogni
// composizione un `submissionId` stabile usato come id del documento: un
// secondo create con lo stesso id torna 409 ALREADY_EXISTS e viene trattato come
// successo idempotente, non come un nuovo feedback. Dal #1517 la create è un
// `:commit` con `exists: false` (le date le mette Firestore), e senza id d'invio
// il documento ne prende uno casuale.
//
// Pre-condizione che renderebbe rosso il test senza il fix: senza l'id stabile il
// secondo create scriverebbe un secondo documento (o, col 409 simulato, `submit`
// lancerebbe invece di dedurre).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
// #602 - la cifratura si carica come la carica l'app (loader.js). Da quando
// non esiste piu un ripiego in chiaro, `submit` si rifiuta di partire se non
// puo cifrare: un test senza questi due file proverebbe l'unico caso che non
// deve esistere.
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackPublicKey.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackCrypto.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

// Stub di fetch che registra ogni create e risponde in modo controllato.
// - counters/feedbackSeq (nextSeq, #583) → valore 5, l'avanzamento va a buon
//   fine → il numero assegnato è 6
// - create (`:commit` con `exists: false`, #1517) → status pilotato da
//   `createStatuses` (coda); si registra l'id del documento scritto.
function installFetch({ createStatuses }) {
  const createUrls = [];
  const scritture = [];
  let ci = 0;
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/counters/')) {
      if (opts && opts.method === 'PATCH') return { ok: true, status: 200, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ fields: { value: { integerValue: '5' } }, updateTime: '2026-09-01T00:00:00Z' }),
      };
    }
    createUrls.push(u);
    const w = JSON.parse(opts.body).writes[0];
    scritture.push(w);
    const status = createStatuses[ci++] ?? 200;
    if (status === 200) return { ok: true, status, json: async () => ({ writeResults: [{}], commitTime: '2026-10-23T00:00:00Z' }) };
    return { ok: false, status, text: async () => `simulated ${status}` };
  };
  const idScritto = (i = 0) => scritture[i].update.name.split('/').pop();
  return { createUrls, scritture, idScritto, restore() { globalThis.fetch = prev; } };
}

const ID_INVIO = 'abc-123-4567-89ab-cdef';

test('submit con submissionId crea il doc con quell\'id', async () => {
  const f = installFetch({ createStatuses: [200] });
  try {
    const r = await FB.submit({ text: 'ciao', submissionId: ID_INVIO });
    assert.equal(r.id, ID_INVIO, 'l\'id restituito è quello scritto');
    assert.ok(!r.deduped, 'primo invio: non deduplicato');
    assert.equal(f.createUrls.length, 1);
    assert.match(f.createUrls[0], /:commit\?/, 'la create passa dal commit');
    assert.equal(f.idScritto(), ID_INVIO, 'la create deve usare l\'id stabile');
    assert.deepEqual(f.scritture[0].currentDocument, { exists: false }, 'è una create: un id già scritto non si sovrascrive');
  } finally { f.restore(); }
});

test('re-invio con lo stesso submissionId → 409 trattato come successo idempotente (nessun duplicato, niente throw)', async () => {
  const f = installFetch({ createStatuses: [409] });
  try {
    const r = await FB.submit({ text: 'ciao', submissionId: ID_INVIO });
    assert.equal(r.deduped, true, 'il 409 deve risultare in un successo deduplicato');
    assert.equal(r.id, ID_INVIO, 'id = submissionId sul percorso idempotente');
    assert.equal(f.createUrls.length, 1, 'un solo tentativo di create');
  } finally { f.restore(); }
});

test('senza submissionId: un id casuale nuovo a ogni invio, e il 409 NON è idempotente (lancia)', async () => {
  const ok = installFetch({ createStatuses: [200, 200] });
  try {
    const r = await FB.submit({ text: 'ciao' });
    await FB.submit({ text: 'ciao' });
    assert.equal(ok.createUrls.length, 2);
    assert.match(ok.idScritto(0), /^[A-Za-z0-9]{24}$/, 'un id della forma di quelli automatici di Firestore');
    assert.notEqual(ok.idScritto(0), ok.idScritto(1), 'due invii, due id');
    assert.equal(r.id, ok.idScritto(0));
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
    assert.match(f.idScritto(), /^[A-Za-z0-9_-]{20,128}$/, 'id ripulito ai soli caratteri e alla lunghezza che le regole ammettono');
  } finally { f.restore(); }
});

// #1517: le regole della create anonima vogliono 20-128 caratteri. Un id corto non passerebbe: meglio uno casuale
// (l'invio parte) che uno rifiutato; uno lungo si accorcia sempre allo stesso modo, e l'idempotenza resta.
test('submissionId corto → id casuale; lungo → accorciato a 128, uguale a ogni tentativo', async () => {
  const f = installFetch({ createStatuses: [200, 200, 200] });
  try {
    await FB.submit({ text: 'ciao', submissionId: 'abc-123' });
    assert.match(f.idScritto(0), /^[A-Za-z0-9]{24}$/);
    const lungo = 'x'.repeat(300);
    await FB.submit({ text: 'ciao', submissionId: lungo });
    await FB.submit({ text: 'ciao', submissionId: lungo });
    assert.equal(f.idScritto(1), 'x'.repeat(128));
    assert.equal(f.idScritto(2), f.idScritto(1));
  } finally { f.restore(); }
});

// #1517: le due date le mette Firestore all'ora della richiesta. Un client che le scrivesse da sé verrebbe
// rifiutato dalle regole della create anonima, e potrebbe scegliere dove cade nelle liste per data.
test('le date non le scrive il client: createdAt e updatedAt sono REQUEST_TIME', async () => {
  const f = installFetch({ createStatuses: [200] });
  try {
    await FB.submit({ text: 'ciao', submissionId: ID_INVIO });
    const w = f.scritture[0];
    assert.ok(!('createdAt' in w.update.fields) && !('updatedAt' in w.update.fields), 'nessuna data scritta dal client');
    assert.deepEqual(w.updateTransforms, [
      { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
      { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
    ]);
  } finally { f.restore(); }
});
