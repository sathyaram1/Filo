// Le domande mirate alla bacheca (#678): una pagina, solo ciò che è cambiato,
// solo le proprie schede.
//
// Quello che conta qui è COSA si chiede al server: l'ordine lo fa la query (o
// la prima schermata non è la più recente), il cursore porta anche il nome del
// documento (o al confine fra due pagine una scheda salta), e chi chiede le
// proprie schede chiede QUELLE — non tutte, per cercarsi dentro.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/feedback.js');
const FB = globalThis.SN_FEEDBACK;

function doc(id, campi = {}) {
  const fields = {};
  for (const [k, v] of Object.entries(campi)) {
    fields[k] = typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };
  }
  return {
    name: `projects/p/databases/(default)/documents/feedback-public/${id}`,
    fields,
    updateTime: '2026-09-01T10:00:00Z',
  };
}

// Registra le richieste e risponde con i documenti dati.
function reteFinta(documenti) {
  const viste = [];
  const vera = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const corpo = JSON.parse((opts && opts.body) || '{}');
    viste.push({ url: String(url), corpo });
    const arr = documenti.map((d) => (String(url).includes(':batchGet') ? { found: d } : { document: d }));
    return { ok: true, status: 200, json: async () => arr };
  };
  return { viste, ripristina() { globalThis.fetch = vera; } };
}

test('una pagina della bacheca: ordine dal server, tetto, solo i campi chiesti', async () => {
  const rete = reteFinta([doc('b', { name: 'Due', createdAt: '2026-02-01T00:00:00Z' })]);
  try {
    const r = await FB.listPublicPage({ pageSize: 50, fields: ['name', 'createdAt'] });
    const q = rete.viste[0].corpo.structuredQuery;
    assert.equal(q.from[0].collectionId, 'feedback-public');
    assert.deepEqual(q.orderBy.map((o) => [o.field.fieldPath, o.direction]), [
      ['createdAt', 'DESCENDING'],
      ['__name__', 'DESCENDING'],
    ]);
    assert.equal(q.limit, 50);
    // `__name__` entra da sé: senza, le righe tornerebbero senza identificativo
    // e il cursore della pagina dopo non si potrebbe nemmeno scrivere.
    assert.deepEqual(q.select.fields.map((f) => f.fieldPath), ['name', 'createdAt', '__name__']);
    assert.equal(r.rows.length, 1);
    assert.equal(r.complete, true); // meno di una pagina piena: non c'è altro
    assert.equal(r.after.createdAt, '2026-02-01T00:00:00Z');
    assert.ok(r.after.name.endsWith('/feedback-public/b'));
  } finally { rete.ripristina(); }
});

test('il cursore riparte dopo l\'ultima riga, con data E nome del documento', async () => {
  const rete = reteFinta([doc('c', { createdAt: '2026-01-01T00:00:00Z' })]);
  try {
    await FB.listPublicPage({
      pageSize: 1,
      after: { createdAt: '2026-02-01T00:00:00Z', name: 'progetti/x/documents/feedback-public/b' },
    });
    const q = rete.viste[0].corpo.structuredQuery;
    assert.equal(q.startAt.before, false);
    assert.deepEqual(q.startAt.values, [
      { stringValue: '2026-02-01T00:00:00Z' },
      { referenceValue: 'progetti/x/documents/feedback-public/b' },
    ]);
  } finally { rete.ripristina(); }
});

test('una pagina piena NON si dichiara finita: c\'è dell\'altro da chiedere', async () => {
  const rete = reteFinta([
    doc('a', { createdAt: '2026-03-01T00:00:00Z' }),
    doc('b', { createdAt: '2026-02-01T00:00:00Z' }),
  ]);
  try {
    const r = await FB.listPublicPage({ pageSize: 2 });
    assert.equal(r.complete, false);
  } finally { rete.ripristina(); }
});

test('cosa è cambiato: si chiede per timbro di pubblicazione, non si rilegge tutto', async () => {
  const rete = reteFinta([doc('a', { publishedAt: '2026-09-02T00:00:00Z' })]);
  try {
    const r = await FB.listPublicChangedSince({
      since: '2026-09-01T00:00:00Z', pageSize: 50, fields: ['name'],
    });
    const q = rete.viste[0].corpo.structuredQuery;
    assert.equal(q.where.fieldFilter.field.fieldPath, 'publishedAt');
    assert.equal(q.where.fieldFilter.op, 'GREATER_THAN');
    assert.equal(q.where.fieldFilter.value.stringValue, '2026-09-01T00:00:00Z');
    assert.deepEqual(q.orderBy.map((o) => o.direction), ['ASCENDING']);
    // `publishedAt` viaggia sempre: senza, il segnalibro non si sposterebbe e
    // le stesse schede si richiederebbero per sempre.
    assert.ok(q.select.fields.some((f) => f.fieldPath === 'publishedAt'));
    assert.equal(r.rows[0].publishedAt, '2026-09-02T00:00:00Z');
  } finally { rete.ripristina(); }
});

test('senza segnalibro non si filtra: è la prima volta, si guarda tutto', async () => {
  const rete = reteFinta([]);
  try {
    await FB.listPublicChangedSince({ since: '' });
    assert.equal(rete.viste[0].corpo.structuredQuery.where, undefined);
  } finally { rete.ripristina(); }
});

test('le proprie schede si chiedono per identificativo, e solo quelle', async () => {
  const rete = reteFinta([doc('mia-1', { name: 'Mia' })]);
  try {
    const rows = await FB.getManyPublic(['mia-1', 'mia-2']);
    const { corpo, url } = rete.viste[0];
    assert.ok(url.includes(':batchGet'));
    assert.equal(corpo.documents.length, 2);
    assert.ok(corpo.documents.every((d) => d.includes('/feedback-public/')));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]._id, 'mia-1');
  } finally { rete.ripristina(); }
});

test('nessun identificativo, nessuna richiesta: zero letture', async () => {
  const rete = reteFinta([]);
  try {
    assert.deepEqual(await FB.getManyPublic([]), []);
    assert.equal(rete.viste.length, 0);
  } finally { rete.ripristina(); }
});
