// Verifica locale, giro 1, rilievo 1: un feedback d'utente approvato come lavoro locale deve poter fare i passaggi
// di npm run feedback (presa in carico, revisione, chiusura) e la presa in carico di verify-local start --feedback.
// Firestore finto: risponde solo coi campi chiesti, come quello vero con la maschera.

import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const SEGNO = { mapValue: { fields: { by: { stringValue: 'owner@esempio' }, at: { integerValue: '1790000000000' } } } };
const DOCS = {
  inCoda: { clientId: { stringValue: 'utente-7' }, status: { stringValue: 'todo' }, statusPublic: { stringValue: 'open' }, localOnly: SEGNO, localApproval: SEGNO },
  inLavoro: { clientId: { stringValue: 'utente-7' }, status: { stringValue: 'working' }, statusPublic: { stringValue: 'open' }, localOnly: SEGNO, localApproval: SEGNO },
};

test('approvato dall’owner: npm run feedback e la presa in carico lo accettano', async () => {
  test.fail(true, 'rilievo 1 aperto: il passaggio rilegge la pratica senza il sì dell’owner e la rifiuta come feedback di un utente');
  const scritture = [];
  const fetchVero = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const id = decodeURIComponent(u.pathname.split('/').pop());
    const doc = DOCS[id];
    if (!doc) return new Response('', { status: 404 });
    if ((init.method || 'GET') !== 'GET') { scritture.push(id); return new Response('{}', { status: 200 }); }
    const maschera = u.searchParams.getAll('mask.fieldPaths');
    const fields = maschera.length ? Object.fromEntries(Object.entries(doc).filter(([k]) => maschera.includes(k))) : doc;
    return new Response(JSON.stringify({ name: `x/feedback/${id}`, fields }), { status: 200 });
  };
  try {
    const OF = await import(pathToFileURL(resolve('scripts/owner-feedback.mjs')).href);
    const o = { bearer: 'finto', dryRun: true };
    expect((await OF.praticaPerLaSessione('inCoda', o)).ok).toBe(true);
    for (const [id, to, attore] of [['inCoda', 'working', 'routine'], ['inLavoro', 'revision_capability', 'routine'], ['inLavoro', 'done', 'routine']]) {
      const r = await OF.scrivi(id, to, '', { ...o, attore });
      expect(r, `${id} → ${to}`).toMatchObject({ ok: true, to });
    }
    const presa = await OF.annotaPratica('inCoda', '', o);
    expect(presa).toMatchObject({ ok: true, from: 'todo', to: 'working' });
  } finally {
    globalThis.fetch = fetchVero;
  }
});
