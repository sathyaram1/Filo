// Unit test del "filo" di rete della vista pubblica e del contatore dei numeri
// (#583), in src/shared/feedback.js. La rete è finta (fetch sostituita): si
// verifica COSA viene chiesto e come si legge la risposta.
//
// Tre cose che senza il fix non esistono o si fanno diversamente:
//   - il numero progressivo viene da `counters/feedbackSeq` con un
//     avanzamento a controllo di versione, non più da una query sulla
//     collezione feedback (che ora non si legge senza credenziali);
//   - la scheda pubblica si scrive con una maschera sui soli campi pubblici:
//     né il testo, né i voti degli utenti;
//   - una lettura con credenziali le allega davvero (Authorization Bearer).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
require(join(ROOT, 'src', 'shared', 'feedbackPublicView.js'));
require(join(ROOT, 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;
const V = globalThis.SN_FEEDBACK_PUBLIC_VIEW;

function withFetch(handler, fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const call = {
      url: String(url),
      method: (opts && opts.method) || 'GET',
      headers: (opts && opts.headers) || {},
      body: opts && opts.body ? JSON.parse(opts.body) : null,
    };
    calls.push(call);
    return handler(call, calls.length);
  };
  return fn(calls).finally(() => { globalThis.fetch = prev; });
}

const okJson = (payload) => ({ ok: true, status: 200, json: async () => payload, text: async () => '' });

test('il numero viene dal contatore, che avanza con la precondizione sulla versione', async () => {
  await withFetch((call) => {
    if (call.method === 'GET') {
      return okJson({ fields: { value: { integerValue: '582' } }, updateTime: '2026-09-01T10:00:00Z' });
    }
    return okJson({});
  }, async (calls) => {
    const n = await FB.nextSeq();
    assert.equal(n, 583, 'il numero è il contatore più uno');
    assert.equal(calls.length, 2, 'una lettura e un avanzamento');
    assert.match(calls[0].url, /\/counters\/feedbackSeq/);
    assert.equal(calls[1].method, 'PATCH');
    assert.match(calls[1].url, /currentDocument\.updateTime=2026-09-01T10%3A00%3A00Z/,
      'senza precondizione due invii insieme si darebbero lo stesso numero');
    assert.equal(calls[1].body.fields.value.integerValue, '583');
  });
});

test('se qualcun altro arriva prima, si rilegge e si riprova (niente numero doppio)', async () => {
  let valore = 10;
  await withFetch((call, n) => {
    if (call.method === 'GET') {
      return okJson({ fields: { value: { integerValue: String(valore) } }, updateTime: `t${valore}` });
    }
    // Il primo avanzamento trova il contatore già mosso: precondizione fallita.
    if (n === 2) { valore = 11; return { ok: false, status: 412, text: async () => 'FAILED_PRECONDITION' }; }
    return okJson({});
  }, async (calls) => {
    const numero = await FB.nextSeq();
    assert.equal(numero, 12, 'si riparte dal valore vero, non da quello letto prima');
    assert.equal(calls.length, 4, 'lettura, tentativo fallito, rilettura, scrittura');
  });
});

test('contatore assente → nessun numero, ma l’invio non si ferma', async () => {
  await withFetch(() => ({ ok: false, status: 404, text: async () => 'NOT_FOUND' }), async () => {
    assert.equal(await FB.nextSeq(), null,
      'senza contatore il feedback parte senza numero: meglio che rifiutare la segnalazione');
  });
});

test('la scheda pubblica si scrive con la maschera dei soli campi pubblici', async () => {
  const card = V.cardFor({
    _id: 'x', status: 'done', name: 'Un fix', seq: 7, resolvedInVersion: '0.2.70',
    text: 'SEGRETO', url: 'https://segreta.invalid', userNote: 'ora va',
  });
  await withFetch(() => okJson({}), async (calls) => {
    await FB.publishPublicCard('fb-1', card, { idToken: 'token-owner' });
    const [call] = calls;
    assert.equal(call.method, 'PATCH');
    assert.match(call.url, /\/feedback-public\/fb-1\?/);
    assert.equal(call.headers.Authorization, 'Bearer token-owner');
    // La maschera: i campi della scheda, mai i voti (li scrivono gli utenti:
    // elencarli qui li cancellerebbe a ogni ripubblicazione).
    const mask = [...call.url.matchAll(/updateMask\.fieldPaths=([^&]+)/g)].map((m) => decodeURIComponent(m[1]));
    for (const f of V.USER_FIELDS) assert.ok(!mask.includes(f), `la maschera non deve toccare "${f}"`);
    assert.ok(mask.includes('name') && mask.includes('status') && mask.includes('publishedAt'));
    // E nel corpo non c'è traccia del testo del feedback.
    const scritto = JSON.stringify(call.body);
    assert.ok(!scritto.includes('SEGRETO') && !scritto.includes('segreta.invalid'));
  });
});

test('togliere la scheda è una cancellazione; una scheda già assente non è un errore', async () => {
  await withFetch(() => ({ ok: false, status: 404, text: async () => 'NOT_FOUND' }), async (calls) => {
    assert.equal(await FB.unpublishPublicCard('fb-1', { idToken: 't' }), true);
    assert.equal(calls[0].method, 'DELETE');
    assert.match(calls[0].url, /\/feedback-public\/fb-1/);
  });
});

test('la lettura con credenziali le allega; la vista pubblica no (non ne ha)', async () => {
  await withFetch(() => okJson([]), async (calls) => {
    await FB.list({ pageSize: 10, idToken: 'token-owner' });
    await FB.listPublic({ pageSize: 10 });
    assert.equal(calls[0].headers.Authorization, 'Bearer token-owner');
    assert.equal(calls[0].body.structuredQuery.from[0].collectionId, 'feedback');
    assert.equal(calls[1].headers.Authorization, undefined);
    assert.equal(calls[1].body.structuredQuery.from[0].collectionId, 'feedback-public');
  });
});
