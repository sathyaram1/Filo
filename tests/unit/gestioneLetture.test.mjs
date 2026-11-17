// #2470: le domande leggere che sostituiscono le letture intere (il conto, l'ultimo cambiato, il registro dei worker
// senza il resto del documento, l'indice delle schede dei soli aperti). Rete finta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

async function conRete(risposta, fn) {
  const vera = globalThis.fetch;
  const chiamate = [];
  globalThis.fetch = async (url, init = {}) => {
    const corpo = init.body ? JSON.parse(init.body) : null;
    chiamate.push({ url: String(url), corpo, auth: init.headers && init.headers.Authorization });
    return { ok: true, status: 200, json: async () => risposta(String(url), corpo) };
  };
  try { return await fn(chiamate); } finally { globalThis.fetch = vera; }
}

test('countAll: una domanda di conto, col token; la risposta senza numero vale «non lo so»', async () => {
  await conRete(() => [{ result: { aggregateFields: { n: { integerValue: '2304' } } }, readTime: 'x' }], async (chiamate) => {
    assert.equal(await FB.countAll({ idToken: 'tok' }), 2304);
    assert.match(chiamate[0].url, /:runAggregationQuery\?/);
    assert.deepEqual(chiamate[0].corpo.structuredAggregationQuery.aggregations, [{ alias: 'n', count: {} }]);
    assert.deepEqual(chiamate[0].corpo.structuredAggregationQuery.structuredQuery.from, [{ collectionId: 'feedback' }]);
    assert.equal(chiamate[0].auth, 'Bearer tok');
    await FB.countAll({ idToken: 'tok', fra: { campo: 'statusPublic', valori: ['open', 'closed'] } });
    assert.deepEqual(chiamate[1].corpo.structuredAggregationQuery.structuredQuery.where.fieldFilter.op, 'IN');
  });
  await conRete(() => [{ readTime: 'x' }], async () => assert.equal(await FB.countAll({ idToken: 'tok' }), null));
});

test('controlloLeggero: il conto e l\'ultimo firmato con la sua ora di Firestore, un documento solo', async () => {
  await conRete((url) => (url.includes('runAggregationQuery')
    ? [{ result: { aggregateFields: { n: { integerValue: '7' } } } }]
    : [{ document: { name: 'projects/filo-8b9cb/databases/(default)/documents/feedback/abc', updateTime: '2026-11-14T10:00:00.123456Z', fields: { updatedAt: { timestampValue: '2026-11-14T10:00:00Z' } } }, readTime: 'r' }]), async (chiamate) => {
    const c = await FB.controlloLeggero({ idToken: 'tok' });
    assert.deepEqual(c, { count: 7, ultimo: { _id: 'abc', _updateTime: '2026-11-14T10:00:00.123456Z' } });
    const q = chiamate.find((x) => x.url.includes(':runQuery')).corpo.structuredQuery;
    assert.equal(q.limit, 1);
    assert.deepEqual(q.orderBy, [{ field: { fieldPath: 'updatedAt' }, direction: 'DESCENDING' }]);
  });
});

test('il registro dei worker si chiede senza il resto della configurazione', async () => {
  const Defaults = require(join(ROOT, 'src', 'main', 'services', 'defaultsStore.js'));
  await conRete(() => ({ fields: { workerLog: { arrayValue: { values: [{ mapValue: { fields: { role: { stringValue: 'verifier' }, startedAt: { stringValue: '2026-11-14T10:00:00Z' }, num: { stringValue: '5' } } } }] } } } }), async (chiamate) => {
    const voci = await Defaults.getWorkerLog('tok', { severo: true });
    assert.deepEqual(voci, [{ role: 'verifier', startedAt: '2026-11-14T10:00:00Z', num: '5' }]);
    assert.match(chiamate[0].url, /config\/automation\?key=[^&]+&mask\.fieldPaths=workerLog$/);
  });
});

// Il triage forzava il giro intero della bacheca a ogni azione (~2.300 letture): la scheda toccata la scrive
// syncOneCard, e il giro intero non forzato parte al più ogni mezz'ora.
test('il triage dell\'owner non forza il giro intero della bacheca', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'), 'utf8');
  const da = src.indexOf('on(MSG.FEEDBACK_UPDATE');
  const a = src.indexOf('\n  }));', da);
  assert.ok(da > 0 && a > da, 'gestore del triage non trovato');
  const gestore = src.slice(da, a);
  assert.match(gestore, /await syncOneCard\(id, idToken\)/);
  assert.doesNotMatch(gestore, /scheduleViewSync\([^)]*force:\s*true/);
  assert.match(src, /const SYNC_MIN_GAP_MS = 30 \* 60 \* 1000;/);
  assert.doesNotMatch(src, /cardsCache = \{ at: 0/, 'una scrittura aggiorna la scheda in mano, non butta via tutte');
});

test('l\'indice delle schede legge i soli aperti quando ogni feedback dice se lo è; altrimenti tutti', async () => {
  const { righeDaIndicizzare } = await import('../../scripts/schede.mjs');
  const chieste = [];
  const finto = (tutti, conStato) => ({
    countAll: async ({ fra }) => (fra ? conStato : tutti),
    listAllPaged: async (o) => { chieste.push(o); return { rows: [], complete: true }; },
  });
  await righeDaIndicizzare({ FB: finto(2300, 2300), idToken: 't', fields: ['seq'] });
  assert.deepEqual(chieste[0].uguale, { campo: 'statusPublic', valore: 'open' });
  await righeDaIndicizzare({ FB: finto(2300, 2299), idToken: 't', fields: ['seq'] });
  assert.equal(chieste[1].uguale, undefined, 'uno senza stato in chiaro: si legge tutto');
  await righeDaIndicizzare({ FB: { ...finto(1, 1), countAll: async () => { throw new Error('rete'); } }, idToken: 't', fields: ['seq'] });
  assert.equal(chieste[2].uguale, undefined);
});
