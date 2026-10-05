// Verifica locale letture-delta, giro 5, rilievo 1: con le regole di produzione che non ammettono ancora l'ora
// dell'ultima modifica, una scrittura dell'owner da script deve passare come quella dell'app, non fallire con 403.

import { test, expect } from '@playwright/test';

const ID = 'fbProvaRegoleVecchie';

test('togliere la pre-approvazione da script passa anche con le regole che non conoscono updatedAt', async () => {
  const realFetch = globalThis.fetch;
  const patch = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.includes(`/feedback/${ID}`)) return realFetch(url, init);
    if ((init.method || 'GET') === 'GET') {
      return new Response(JSON.stringify({ name: `x/feedback/${ID}`, fields: { statusPublic: { stringValue: 'open' } } }), { status: 200 });
    }
    patch.push(u);
    // Regole di produzione di oggi: chi scrive updatedAt viene respinto.
    if (u.includes('updatedAt')) return new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED' } }), { status: 403 });
    return new Response('{}', { status: 200 });
  };
  try {
    const of = await import('../../../scripts/owner-feedback.mjs');
    const r = await of.segnaPreapprovazione(ID, false, { bearer: 'finto' });
    expect(r.ok, `esito: ${JSON.stringify(r)}`).toBe(true);
    expect(patch.length).toBeGreaterThan(0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
