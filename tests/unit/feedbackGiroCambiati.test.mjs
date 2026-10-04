// Il giro della Gestione (#676): la query «chi è cambiato da allora?»
// (src/shared/feedback.js) e la decisione del giro (feedbackLive.js → makeWatcher).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'src', 'shared');
require(join(SRC, 'feedbackLive.js'));
require(join(SRC, 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;
const LIVE = globalThis.SN_FEEDBACK_LIVE;

// ── la query ────────────────────────────────────────────────────────────────

function fsDoc(id, updatedAt, createdAt) {
  return {
    name: `projects/p/databases/(default)/documents/feedback/${id}`,
    fields: {
      updatedAt: { timestampValue: updatedAt },
      ...(createdAt ? { createdAt: createdAt.startsWith('S:') ? { stringValue: createdAt.slice(2) } : { timestampValue: createdAt } } : {}),
    },
    updateTime: updatedAt,
  };
}

async function conFetch(rispostaPer, fn, { status = 200 } = {}) {
  const vere = globalThis.fetch;
  const chiamate = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse((opts && opts.body) || '{}');
    chiamate.push({ url: String(url), body });
    const out = rispostaPer(chiamate.length, body, String(url));
    const st = typeof status === 'function' ? status(chiamate.length) : status;
    return { ok: st < 300, status: st, json: async () => out, text: async () => '' };
  };
  try { return await fn(chiamate); } finally { globalThis.fetch = vere; }
}

test('listChangedSince: filtro, ordinamento, proiezione con updatedAt', async () => {
  await conFetch(() => [], async (chiamate) => {
    await FB.listChangedSince({ since: '2026-09-20T10:00:00.000Z', pageSize: 500, fields: ['name', 'status'] });
    assert.equal(chiamate.length, 1, 'un giro a vuoto è UNA richiesta');
    const q = chiamate[0].body.structuredQuery;
    assert.deepEqual(q.from, [{ collectionId: 'feedback' }]);
    assert.deepEqual(q.where.fieldFilter, {
      field: { fieldPath: 'updatedAt' }, op: 'GREATER_THAN', value: { timestampValue: '2026-09-20T10:00:00.000Z' },
    });
    assert.deepEqual(q.orderBy, [
      { field: { fieldPath: 'updatedAt' }, direction: 'ASCENDING' },
      { field: { fieldPath: '__name__' }, direction: 'ASCENDING' },
    ]);
    assert.equal(q.limit, 500);
    const campi = q.select.fields.map((f) => f.fieldPath);
    assert.ok(campi.includes('updatedAt'), 'senza updatedAt il cursore della pagina dopo non si scrive');
    assert.ok(campi.includes('name') && !campi.includes('notes'));
  });
});

test('listChangedSince: oltre il tetto pagina e il cursore avanza; le righe proiettate sono marcate', async () => {
  const pagine = [
    [fsDoc('a', '2026-09-20T10:01:00Z'), fsDoc('b', '2026-09-20T10:02:00Z')],
    [fsDoc('c', '2026-09-20T10:03:00Z'), fsDoc('d', '2026-09-20T10:04:00Z')],
    [fsDoc('e', '2026-09-20T10:05:00Z')],
  ];
  await conFetch((n) => (pagine[n - 1] || []).map((document) => ({ document })), async (chiamate) => {
    const out = await FB.listChangedSince({ since: '2026-09-20T10:00:00.000Z', pageSize: 2, fields: ['name'] });
    assert.equal(chiamate.length, 3);
    assert.deepEqual(out.rows.map((r) => r._id), ['a', 'b', 'c', 'd', 'e']);
    assert.equal(out.complete, true);
    assert.ok(out.rows.every((r) => r._proiezione));
    const startAt = chiamate[1].body.structuredQuery.startAt;
    assert.equal(startAt.values[0].timestampValue, '2026-09-20T10:02:00Z');
    assert.match(startAt.values[1].referenceValue, /\/feedback\/b$/);
  });
});

test('listChangedSince: il freno sulle pagine lo DICE, non taglia in silenzio', async () => {
  let i = 0;
  await conFetch(() => {
    i += 1;
    return [{ document: fsDoc(`x${i}`, `2026-09-20T10:0${i}:00Z`) }, { document: fsDoc(`y${i}`, `2026-09-20T10:0${i}:30Z`) }];
  }, async (chiamate) => {
    const out = await FB.listChangedSince({ since: '2026-09-20T10:00:00.000Z', pageSize: 2, maxPages: 3 });
    assert.equal(chiamate.length, 3);
    assert.equal(out.complete, false);
    assert.equal(out.rows.length, 6);
  });
});

test('updateStatus firma l\'ora come data; con regole vecchie la scrittura passa senza', async () => {
  await conFetch(() => ({}), async (chiamate) => {
    await FB.updateStatus('doc-1', { starred: true }, { idToken: 'x' });
    const mask = new URLSearchParams(chiamate[0].url.split('?')[1] || '').getAll('updateMask.fieldPaths');
    assert.ok(mask.includes('updatedAt'));
    assert.ok(Number.isFinite(new Date(chiamate[0].body.fields.updatedAt.timestampValue).getTime()));
  });
  await conFetch(() => ({}), async (chiamate) => {
    await FB.updateStatus('doc-1', { starred: true }, { idToken: 'x' });
    assert.equal(chiamate.length, 2, 'un 403 riprova una volta');
    const mask = new URLSearchParams(chiamate[1].url.split('?')[1] || '').getAll('updateMask.fieldPaths');
    assert.ok(!mask.includes('updatedAt') && mask.includes('starred'));
  }, { status: (n) => (n === 1 ? 403 : 200) });
});

test('submit firma createdAt e updatedAt come date', async () => {
  await conFetch((n, body, url) => (url.includes('counters') ? { fields: { value: { integerValue: '5' } } } : { name: 'x/feedback/nuovo' }), async (chiamate) => {
    await FB.submit({ text: 'ciao', clientId: 'c' }).catch(() => {});
    const crea = chiamate.find((c) => c.body && c.body.fields && c.body.fields.text);
    assert.ok(crea, 'la creazione è partita');
    assert.ok(crea.body.fields.createdAt.timestampValue);
    assert.equal(crea.body.fields.updatedAt.timestampValue, crea.body.fields.createdAt.timestampValue);
  });
});

test('CAMPI_LISTA porta updatedAt: il cursore del giro e il confronto lo leggono', () => {
  assert.ok(FB.CAMPI_LISTA.includes('updatedAt'));
});

test('createdAt testo o data: l\'ordine della lista vale per tutti e due', () => {
  const lista = LIVE.applyChanges([], {
    fresh: [
      { _id: 'figlio', createdAt: '2026-08-01T10:00:00.000Z' },     // testo ISO (server, vecchi sotto-feedback)
      { _id: 'nuovo', createdAt: '2026-09-30T10:00:00.123456Z' },   // timestamp letto via REST
      { _id: 'sdk', createdAt: { seconds: Date.parse('2026-09-01T00:00:00Z') / 1000 } },
    ],
  });
  assert.deepEqual(lista.map((f) => f._id), ['nuovo', 'sdk', 'figlio']);
});

test('applyChanges non sostituisce una riga con una più vecchia', () => {
  const out = LIVE.applyChanges([{ _id: 'a', name: 'nuovo', _updateTime: 't5' }], {
    fresh: [{ _id: 'a', name: 'vecchio', _updateTime: 't3' }],
  });
  assert.equal(out[0].name, 'nuovo');
});

// ── la decisione del giro ───────────────────────────────────────────────────

function watcher(over = {}) {
  const log = { versioni: 0, cambiati: 0 };
  let t = 1_000_000;
  const w = LIVE.makeWatcher({
    now: () => t,
    listVersions: async () => { log.versioni += 1; return { versions: over.versions || [], complete: over.complete !== false }; },
    listChangedSince: async (o) => {
      log.cambiati += 1;
      log.ultimoSince = o.since;
      return over.changed ? over.changed(log.cambiati) : { rows: [], complete: true };
    },
    ...over.deps,
  });
  return { w, log, avanza: (ms) => { t += ms; }, ora: () => t };
}

test('il primo giro è un riallineamento, i successivi chiedono i cambiati', async () => {
  const { w, log, avanza } = watcher({ versions: [{ _id: 'a', _updateTime: 't1' }] });
  const r1 = await w.tick({ force: true });
  assert.equal(r1.kind, 'reconcile');
  assert.equal(r1.complete, true);
  avanza(60_000);
  const r2 = await w.tick();
  assert.equal(r2.kind, 'changed');
  assert.deepEqual(r2.rows, []);
  assert.equal(log.versioni, 1);
  assert.equal(log.cambiati, 1);
});

test('una lettura completa della pagina vale come riallineamento: niente rilettura subito dopo', async () => {
  const { w, log } = watcher();
  w.allineato();
  const r = await w.tick({ force: true });
  assert.equal(r.kind, 'changed');
  assert.equal(log.versioni, 0);
});

test('il cursore non torna avanti se c\'era: chi era nascosto riceve quello che ha perso', async () => {
  const { w, log, avanza, ora } = watcher();
  w.allineato();
  const primo = ora();
  avanza(60 * 60_000);
  w.allineato(); // un'altra Gestione si apre un'ora dopo
  await w.tick({ force: true });
  assert.ok(Date.parse(log.ultimoSince) <= primo - LIVE.OVERLAP_MS);
});

test('dopo RECONCILE_MS si torna a riallineare (le cancellazioni non hanno data)', async () => {
  const { w, log, avanza } = watcher();
  await w.tick({ force: true });
  avanza(LIVE.RECONCILE_MS + 1);
  const r = await w.tick({ force: true });
  assert.equal(r.kind, 'reconcile');
  assert.equal(log.versioni, 2);
});

test('il giro chiede da PRIMA dell\'ultimo giro: lo scarto fra orologi non mangia una scrittura', async () => {
  const { w, log, avanza, ora } = watcher();
  await w.tick({ force: true });
  const inizio = ora();
  avanza(60_000);
  await w.tick();
  assert.equal(Date.parse(log.ultimoSince), inizio - LIVE.OVERLAP_MS);
});

test('il freno sulle pagine fa riallineare al giro dopo, e lo dice', async () => {
  const { w, avanza } = watcher({ changed: () => ({ rows: [{ _id: 'x' }], complete: false }) });
  await w.tick({ force: true });
  avanza(60_000);
  const r = await w.tick();
  assert.ok(r.avvisi && r.avvisi.some((m) => /pagine/.test(m)));
  avanza(60_000);
  assert.equal((await w.tick()).kind, 'reconcile');
});

test('un riallineamento interrotto lo dichiara', async () => {
  const { w } = watcher({ complete: false });
  const r = await w.tick({ force: true });
  assert.equal(r.complete, false);
  assert.ok(r.avvisi.length > 0);
});

test('un giro chiesto troppo presto è saltato, salvo forzarlo; due insieme sono uno', async () => {
  const { w, log, avanza } = watcher();
  await w.tick({ force: true });
  avanza(5_000);
  assert.equal((await w.tick()).kind, 'skipped');
  const [a, b] = await Promise.all([w.tick({ force: true }), w.tick({ force: true })]);
  assert.equal(a, b);
  assert.equal(log.cambiati, 1);
});
