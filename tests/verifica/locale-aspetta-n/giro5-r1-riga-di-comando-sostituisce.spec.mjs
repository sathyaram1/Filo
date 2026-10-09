// Verifica locale di «aspetta #N», giro 5: da riga di comando un'attesa nuova non fa sparire in silenzio quelle che c'erano.
// Niente Electron: lo strumento dell'owner con la rete finta (un feedback che aspetta già #663).
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

test('r1 a una pratica che aspetta #663 si aggiunge #676: #663 resta, o la risposta dice che si perde', async () => {
  const scritture = [];
  const prima = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes(':runQuery')) {
      const seq = String(init.body).match(/"integerValue":"(\d+)"/)[1];
      return json([{ document: { name: `projects/x/databases/(default)/documents/feedback/id-${seq}`, fields: { seq: { integerValue: seq }, subSeq: { integerValue: '0' } } } }]);
    }
    if (init.method === 'PATCH') { scritture.push(String(init.body)); return json({ name: 'x', fields: {} }); }
    if (u.includes('/feedback/id-903')) {
      return json({ name: 'projects/x/databases/(default)/documents/feedback/id-903', fields: {
        seq: { integerValue: '903' }, subSeq: { integerValue: '0' },
        waitsFor: { arrayValue: { values: [{ mapValue: { fields: { id: { stringValue: 'id-663' }, num: { stringValue: '663' } } } }] } },
      } });
    }
    return json({ name: 'x', fields: {} });
  };
  try {
    const { segnaAttese } = await import(pathToFileURL(resolve('scripts/owner-feedback.mjs')).href);
    const r = await segnaAttese('id-903', '676', { bearer: 'finto' });
    expect(r.ok).toBe(true);
    expect(scritture).toHaveLength(1);
    const tenuta = scritture[0].includes('id-663');
    const detta = JSON.stringify(r).includes('663');
    expect(tenuta || detta, 'l\'attesa su #663 sparisce e la risposta nomina solo #676').toBe(true);
  } finally {
    globalThis.fetch = prima;
  }
});
