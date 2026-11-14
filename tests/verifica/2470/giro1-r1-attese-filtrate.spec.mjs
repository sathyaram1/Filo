// Verifica #2470 giro 1: aprendo un pacchetto, la ricerca di chi aspetta le segnalazioni unite chiede al database
// solo i feedback che aspettano qualcosa, non tutti (punto 7 della richiesta). Firestore finto sul fetch.
import { test, expect } from '@playwright/test';

const N = 300;
const CON_ATTESE = new Set(['f7', 'f42']);

function documento(i) {
  const id = `f${i}`;
  const fields = { seq: { integerValue: String(100 + i) }, subSeq: { integerValue: '0' } };
  if (CON_ATTESE.has(id)) fields.waitsFor = { arrayValue: { values: [{ mapValue: { fields: { id: { stringValue: 'unita1' }, num: { stringValue: '#5' } } } }] } };
  return { document: { name: `projects/filo-8b9cb/databases/(default)/documents/feedback/${id}`, updateTime: '2026-11-14T10:00:00Z', fields }, readTime: '2026-11-14T10:00:01Z' };
}

test('r1 chi aspetta le unite si trova leggendo solo i feedback con delle attese', async () => {
  const { pacchetto } = await import('../../../scripts/claude-feedback.mjs');
  const vera = globalThis.fetch;
  let lettiDocumenti = 0;
  globalThis.fetch = async (url, init = {}) => {
    const corpo = init.body ? JSON.parse(init.body) : {};
    const q = corpo.structuredQuery || {};
    let righe = [];
    if (String(url).includes(':runQuery') && !q.startAt) {
      const filtra = JSON.stringify(q.where || q.orderBy || '').includes('waitsFor');
      righe = Array.from({ length: N }, (_, i) => documento(i)).filter((d) => !filtra || d.document.fields.waitsFor);
    }
    lettiDocumenti += righe.length;
    const risposta = righe.length ? righe : [{ readTime: '2026-11-14T10:00:01Z' }];
    return { ok: true, status: 200, json: async () => risposta, text: async () => JSON.stringify(risposta) };
  };
  try {
    const aspettanti = await pacchetto.attesiDa([{ id: 'unita1', num: '5' }], 'token-finto');
    expect(aspettanti.map((a) => a.id).sort()).toEqual(['f42', 'f7']);
    expect(lettiDocumenti, 'documenti letti per trovare due feedback in attesa').toBeLessThanOrEqual(CON_ATTESE.size);
  } finally {
    globalThis.fetch = vera;
  }
});
