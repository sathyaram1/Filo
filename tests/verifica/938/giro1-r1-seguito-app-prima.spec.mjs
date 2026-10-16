// Verifica #938, giro 1, rilievo 1: pratica chiusa dalla fusione dell'app prima che il ramo del server esistesse; poi
// arrivano un seguito dell'app e il ramo del server, e il seguito dell'app arriva per primo (npm run finish). La pratica
// deve tornare in lavorazione col registro vuoto, come quando arriva per primo il server (caso 3 della segnalazione).
import { test, expect } from '@playwright/test';

const ORA = Date.parse('2026-10-03T10:00:00Z');
const ORE = 3600 * 1000;
const OPTS = { bearer: 'finto' };
const valore = (v) => (typeof v === 'string' ? { stringValue: v } : { integerValue: String(v) });

function pratica(FB, id, { status, parti }) {
  return {
    name: `projects/x/databases/(default)/documents/feedback/${id}`,
    fields: {
      seq: { integerValue: '938' }, clientId: { stringValue: 'local:claude' }, senderProof: { stringValue: 'admin' },
      fiducia: { stringValue: 'fidato' }, status: { stringValue: status }, statusPublic: { stringValue: FB.statusToPublic(status) },
      notes: { stringValue: '' },
      localOnly: { mapValue: { fields: { by: { stringValue: 'local:claude' }, at: { integerValue: '1' } } } },
      localMerges: { mapValue: { fields: Object.fromEntries(Object.entries(parti).map(([k, v]) => [k, valore(v)])) } },
    },
  };
}

function applica(fields, percorso, nuovi) {
  const [k, sub] = percorso.split('.');
  if (!sub) { if (k in nuovi) fields[k] = nuovi[k]; else delete fields[k]; return; }
  const mappa = { ...(fields[k]?.mapValue?.fields || {}) };
  const v = nuovi[k]?.mapValue?.fields?.[sub];
  if (v === undefined) delete mappa[sub]; else mappa[sub] = v;
  fields[k] = { mapValue: { fields: mappa } };
}

test('r1 il seguito dell’app che arriva prima del server riapre la pratica chiusa dalla sua prima fusione', async () => {
  const of = await import('../../../scripts/owner-feedback.mjs');
  const { riapriPerIlServer } = await import('../../../scripts/finish-local.mjs');
  const { partiDaCampi } = await import('../../../scripts/lib/parti-lavoro.mjs');
  const FB = globalThis.SN_FEEDBACK;
  const docs = { p: pratica(FB, 'p', { status: 'done', parti: { app: ORA - 3 * ORE, ramo: 'claude/x' } }) };
  const vero = globalThis.fetch;
  const cifra = globalThis.SN_FEEDBACK_ENC_ENABLED;
  globalThis.SN_FEEDBACK_ENC_ENABLED = false;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const d = docs[decodeURIComponent(u.pathname.split('/feedback/')[1] || '')];
    if (!d) return new Response('{}', { status: 404 });
    if ((init.method || 'GET') === 'PATCH') {
      const campi = JSON.parse(init.body).fields || {};
      for (const p of u.searchParams.getAll('updateMask.fieldPaths')) applica(d.fields, p, campi);
      return new Response('{}', { status: 200 });
    }
    return new Response(JSON.stringify(d), { status: 200 });
  };
  try {
    const conBearer = {
      partiDellaPratica: (id) => of.partiDellaPratica(id, OPTS),
      scrivi: (id, to, nota) => of.scrivi(id, to, nota, OPTS),
      annotaPratica: (id, nota) => of.annotaPratica(id, nota, OPTS),
    };
    // Il seguito dell'app sullo stesso ramo, e il ramo omonimo del server ancora fuori da main.
    const riga = await riapriPerIlServer({ id: 'p', ramo: 'claude/x', pendingParts: [{ part: 'server', branch: 'claude/x' }] }, { of: conBearer, ora: ORA });
    expect(riga, 'finish deve dire che riapre la pratica').toMatch(/riaperta/);
    expect(docs.p.fields.status.stringValue).toBe('working');
    expect(partiDaCampi(docs.p.fields)).toEqual({});
  } finally {
    globalThis.fetch = vero;
    globalThis.SN_FEEDBACK_ENC_ENABLED = cifra;
  }
});
