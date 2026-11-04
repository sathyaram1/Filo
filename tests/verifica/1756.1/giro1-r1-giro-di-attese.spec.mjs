// #1756.1 giro 1 — due agenti che scrivono insieme due attese opposte (#10 aspetta #20, #20 aspetta #10) non devono
// lasciare scritto un giro: ognuno controlla il giro sulle attese dell'altro lette prima che l'altro scrivesse.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/feedbackTransitions.js');
require('../../../src/shared/feedbackStatus.js');
require('../../../src/shared/feedbackAttese.js');
require('../../../src/shared/manageReview.js');
const owner = await import('../../../scripts/owner-feedback.mjs');

// Firestore finto: ogni risposta arriva dopo qualche millisecondo, la PATCH rispetta `currentDocument.updateTime`.
function reteFinta(docs) {
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    await new Promise((r) => setTimeout(r, 5));
    const u = String(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.includes(':runQuery')) {
      const seq = JSON.parse(opts.body).structuredQuery.where.fieldFilter.value.integerValue;
      return ok(Object.entries(docs).filter(([, d]) => String(d.seq) === seq).map(([id]) => ({
        document: { name: `x/feedback/${id}`, fields: { subSeq: { integerValue: '0' } } },
      })));
    }
    const id = decodeURIComponent(u.split('/feedback/')[1].split('?')[0]);
    if ((opts.method || 'GET') === 'PATCH') {
      const body = JSON.parse(opts.body);
      const condizione = new URL(u).searchParams.get('currentDocument.updateTime');
      if (condizione && condizione !== `v${docs[id].v || 1}`) {
        const e = { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'the stored version does not match the required base version' } };
        return { ok: false, status: 400, json: async () => e, text: async () => JSON.stringify(e) };
      }
      docs[id].waitsFor = (body.fields.waitsFor?.arrayValue?.values || [])
        .map((v) => ({ id: v.mapValue.fields.id.stringValue, num: v.mapValue.fields.num.stringValue }));
      docs[id].v = (docs[id].v || 1) + 1;
      return ok({});
    }
    const d = docs[id];
    if (!d) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    const fields = { seq: { integerValue: String(d.seq) }, subSeq: { integerValue: '0' }, status: { stringValue: 'todo' } };
    if (d.waitsFor) {
      fields.waitsFor = { arrayValue: { values: d.waitsFor.map((w) => ({ mapValue: { fields: { id: { stringValue: w.id }, num: { stringValue: w.num } } } })) } };
    }
    return ok({ name: `x/feedback/${id}`, fields, updateTime: `v${d.v || 1}` });
  };
  return () => { globalThis.fetch = vero; };
}

test('r1 due attese opposte scritte insieme: non resta scritto un giro di attese', async () => {
  const docs = { id10: { seq: 10 }, id20: { seq: 20 } };
  const ripristina = reteFinta(docs);
  try {
    const [a, b] = await Promise.all([
      owner.segnaAttese('id10', '20', { bearer: 'tok', aggiungi: true }),
      owner.segnaAttese('id20', '10', { bearer: 'tok', aggiungi: true }),
    ]);
    const dieciAspettaVenti = (docs.id10.waitsFor || []).some((w) => w.id === 'id20');
    const ventiAspettaDieci = (docs.id20.waitsFor || []).some((w) => w.id === 'id10');
    expect(dieciAspettaVenti && ventiAspettaDieci, 'giro scritto: #10 aspetta #20 e #20 aspetta #10, nessuno dei due entrerà mai in coda').toBe(false);
    expect([a.ok, b.ok].filter(Boolean).length, 'una delle due passa, l\'altra si rifiuta col giro').toBe(1);
  } finally { ripristina(); }
});
