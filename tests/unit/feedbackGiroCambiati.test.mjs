// Unit test del giro al minuto della dashboard di gestione (#676): la domanda
// «chi è cambiato da allora?» invece della rilettura di tutta la collezione.
// Due pezzi, tutti e due senza rete: la costruzione della query
// (src/shared/feedback.js → listChangedSince) e la decisione del giro
// (src/shared/feedbackLive.js → makeWatcher).

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
      ...(createdAt ? { createdAt: { timestampValue: createdAt } } : {}),
    },
    updateTime: updatedAt,
  };
}

/** Sostituisce fetch e raccoglie i corpi delle richieste. */
async function conFetch(rispostaPer, fn) {
  const vere = globalThis.fetch;
  const chiamate = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse((opts && opts.body) || '{}');
    chiamate.push({ url: String(url), body });
    const out = rispostaPer(chiamate.length, body);
    return { ok: true, status: 200, json: async () => out, text: async () => '' };
  };
  try { return await fn(chiamate); } finally { globalThis.fetch = vere; }
}

test('listChangedSince: filtro, ordinamento e tetto della query', async () => {
  await conFetch(() => [], async (chiamate) => {
    await FB.listChangedSince({ since: '2026-09-20T10:00:00.000Z', pageSize: 500 });
    assert.equal(chiamate.length, 1, 'un giro a vuoto è UNA richiesta');
    const q = chiamate[0].body.structuredQuery;
    assert.deepEqual(q.from, [{ collectionId: 'feedback' }]);
    assert.deepEqual(q.where, {
      fieldFilter: {
        field: { fieldPath: 'updatedAt' },
        op: 'GREATER_THAN',
        value: { timestampValue: '2026-09-20T10:00:00.000Z' },
      },
    });
    // Il nome fa da spareggio: due scritture nello stesso istante non si
    // saltano a vicenda quando si pagina.
    assert.deepEqual(q.orderBy, [
      { field: { fieldPath: 'updatedAt' }, direction: 'ASCENDING' },
      { field: { fieldPath: '__name__' }, direction: 'ASCENDING' },
    ]);
    assert.equal(q.limit, 500);
    assert.equal(q.startAt, undefined, 'senza cursore si parte dall\'inizio');
  });
});

test('listChangedSince: oltre il tetto pagina, e il cursore avanza', async () => {
  // Due pagine piene e una corta: il freno NON deve scattare, e nessuna riga
  // va persa per strada.
  const pagine = [
    [fsDoc('a', '2026-09-20T10:01:00Z'), fsDoc('b', '2026-09-20T10:02:00Z')],
    [fsDoc('c', '2026-09-20T10:03:00Z'), fsDoc('d', '2026-09-20T10:04:00Z')],
    [fsDoc('e', '2026-09-20T10:05:00Z')],
  ];
  await conFetch((n) => (pagine[n - 1] || []).map((document) => ({ document })), async (chiamate) => {
    const out = await FB.listChangedSince({ since: '2026-09-20T10:00:00.000Z', pageSize: 2 });
    assert.equal(chiamate.length, 3);
    assert.deepEqual(out.rows.map((r) => r._id), ['a', 'b', 'c', 'd', 'e']);
    assert.equal(out.complete, true);
    // Il cursore della seconda richiesta è l'ULTIMA riga della prima pagina.
    const startAt = chiamate[1].body.structuredQuery.startAt;
    assert.equal(startAt.before, false);
    assert.equal(startAt.values[0].timestampValue, '2026-09-20T10:02:00Z');
    assert.match(startAt.values[1].referenceValue, /\/feedback\/b$/);
    // E quello restituito è l'ultima riga di tutte: da lì si riprende.
    assert.match(out.cursor.name, /\/feedback\/e$/);
  });
});

test('listChangedSince: il freno sulle pagine lo DICE, non taglia in silenzio', async () => {
  // Una sorgente che non finisce mai: dopo `maxPages` si smette, e la risposta
  // dichiara di non essere completa (mai un taglio muto).
  let i = 0;
  await conFetch(() => {
    i += 1;
    return [{ document: fsDoc(`x${i}`, `2026-09-20T10:0${i}:00Z`) },
      { document: fsDoc(`y${i}`, `2026-09-20T10:0${i}:30Z`) }];
  }, async (chiamate) => {
    const out = await FB.listChangedSince({ since: '2026-09-20T10:00:00.000Z', pageSize: 2, maxPages: 3 });
    assert.equal(chiamate.length, 3);
    assert.equal(out.complete, false, 'chi chiama deve poter sapere che manca roba');
    assert.equal(out.rows.length, 6);
  });
});

test('updateStatus firma sempre l\'ora: senza, il cambiamento sparisce dal giro', async () => {
  await conFetch(() => ({}), async (chiamate) => {
    await FB.updateStatus('doc-1', { starred: true }, { idToken: 'x' });
    const mask = new URLSearchParams(chiamate[0].url.split('?')[1] || '').getAll('updateMask.fieldPaths');
    assert.ok(mask.includes('updatedAt'), 'updatedAt deve stare nella maschera');
    const v = chiamate[0].body.fields.updatedAt.timestampValue;
    assert.ok(Number.isFinite(new Date(v).getTime()), 'updatedAt deve essere una data vera');
  });
});

// ── la decisione del giro ───────────────────────────────────────────────────

function watcher(over = {}) {
  const log = { versioni: 0, cambiati: 0, avvisi: [] };
  let t = 1_000_000;
  const w = LIVE.makeWatcher({
    now: () => t,
    pageSize: 3,
    broadcast: (m) => log.avvisi.push(m),
    listVersions: async () => { log.versioni += 1; return over.versions || []; },
    listChangedSince: async (o) => {
      log.cambiati += 1;
      log.ultimoSince = o.since;
      return over.changed ? over.changed(log.cambiati) : { rows: [], complete: true };
    },
    ...over.deps,
  });
  return { w, log, avanza: (ms) => { t += ms; }, ora: () => t };
}

test('il primo giro è un riallineamento completo, i successivi no', async () => {
  const { w, log, avanza } = watcher({ versions: [{ _id: 'a', _updateTime: 't1', createdAt: '2026-09-01T00:00:00Z' }] });
  await w.tick({ force: true });
  assert.equal(log.versioni, 1);
  assert.equal(log.cambiati, 0);
  assert.equal(log.avvisi[0].kind, 'reconcile');

  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  assert.equal(log.versioni, 1, 'il riallineamento è raro: non si ripete al giro dopo');
  assert.equal(log.cambiati, 1);
});

test('niente di cambiato: nessun avviso alle pagine, quindi nessuna rilettura', async () => {
  const { w, log, avanza } = watcher({ versions: [] });
  await w.tick({ force: true });          // riallineamento d'apertura
  const dopoApertura = log.avvisi.length;
  for (let i = 0; i < 3; i += 1) { avanza(LIVE.POLL_MS); await w.tick({ force: true }); }
  assert.equal(log.cambiati, 3, 'tre giri, tre domande');
  assert.equal(log.avvisi.length, dopoApertura, 'tre giri a vuoto non toccano nessuna pagina');
});

test('dopo RECONCILE_MS si torna a riallineare (le cancellazioni non hanno data)', async () => {
  const { w, log, avanza } = watcher({ versions: [] });
  await w.tick({ force: true });
  avanza(LIVE.RECONCILE_MS + 1);
  await w.tick({ force: true });
  assert.equal(log.versioni, 2);
});

test('il giro chiede da PRIMA dell\'ultimo giro: lo scarto fra orologi non mangia una scrittura', async () => {
  const { w, log, avanza, ora } = watcher({ versions: [] });
  await w.tick({ force: true });
  const inizio = ora();
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  const chiesto = new Date(log.ultimoSince).getTime();
  assert.equal(chiesto, inizio - LIVE.OVERLAP_MS);
});

test('un feedback fuori dalla finestra non entra in lista dal giro', async () => {
  // La pagina è piena (tetto 3) e il più vecchio è del 2 settembre: un
  // feedback del 1° cambia, ma la lista non lo mostrerebbe comunque —
  // aggiungerlo vorrebbe dire farlo comparire e poi sparire.
  const versions = [
    { _id: 'a', _updateTime: 't1', createdAt: '2026-09-04T00:00:00Z' },
    { _id: 'b', _updateTime: 't1', createdAt: '2026-09-03T00:00:00Z' },
    { _id: 'c', _updateTime: 't1', createdAt: '2026-09-02T00:00:00Z' },
  ];
  const { w, log, avanza } = watcher({
    versions,
    changed: () => ({
      rows: [
        { _id: 'vecchio', createdAt: '2026-09-01T00:00:00Z' },
        { _id: 'a', createdAt: '2026-09-04T00:00:00Z' },
      ],
      complete: true,
    }),
  });
  await w.tick({ force: true });
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  const avviso = log.avvisi[log.avvisi.length - 1];
  assert.equal(avviso.kind, 'changed');
  assert.deepEqual(avviso.rows.map((r) => r._id), ['a']);
});

test('il freno sulle pagine fa riallineare al giro dopo invece di lasciare buchi', async () => {
  const { w, log, avanza } = watcher({
    versions: [],
    changed: () => ({ rows: [{ _id: 'z' }], complete: false }),
  });
  await w.tick({ force: true });
  assert.equal(log.versioni, 1);
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });   // incrementale, tronco
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });   // → riallineamento
  assert.equal(log.versioni, 2);
});

test('due giri chiesti insieme sono un giro solo', async () => {
  const { w, log } = watcher({ versions: [] });
  await Promise.all([w.tick({ force: true }), w.tick({ force: true })]);
  assert.equal(log.versioni, 1);
});

test('windowFloor: nessun bordo finché la pagina non è piena', () => {
  const due = [
    { _id: 'a', createdAt: '2026-09-02T00:00:00Z' },
    { _id: 'b', createdAt: '2026-09-01T00:00:00Z' },
  ];
  assert.equal(LIVE.windowFloor(due, 3), null);
  assert.equal(LIVE.windowFloor(due, 2), Date.parse('2026-09-01T00:00:00Z'));
  // Senza data d'invio non si butta via niente: un campo assente non è una
  // ragione per far sparire un feedback.
  assert.equal(LIVE.inWindow({ _id: 'x' }, Date.parse('2026-09-01T00:00:00Z')), true);
});

test('applyChanges non sostituisce una riga con una più vecchia', () => {
  // Il giro vive nel main e avvisa tutte le pagine: una pagina appena caricata
  // può ricevere un annuncio più vecchio di quello che ha già letto.
  const lista = [{ _id: 'a', _updateTime: 't5', name: 'nuovo' }];
  const out = LIVE.applyChanges(lista, { fresh: [{ _id: 'a', _updateTime: 't2', name: 'vecchio' }] });
  assert.equal(out[0].name, 'nuovo');
  const avanti = LIVE.applyChanges(lista, { fresh: [{ _id: 'a', _updateTime: 't9', name: 'più nuovo' }] });
  assert.equal(avanti[0].name, 'più nuovo');
});
