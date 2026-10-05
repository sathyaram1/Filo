// Verifica #776, giro 1, rilievo 1: dall'iter l'owner da riga di comando può solo archiviare.
// Con le righe nuove la catena «→ archiviato → in coda» passa in una scrittura sola su un lavoro in corso.

import { test, expect } from '@playwright/test';
import { pathToFileURL, fileURLToPath } from 'node:url';

const MOD = pathToFileURL(fileURLToPath(new URL('../../../scripts/owner-feedback.mjs', import.meta.url))).href;

/** fetch finto: le GET rendono `doc`, le PATCH si contano. */
async function conRete(doc, fn) {
  const patch = [];
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'PATCH') {
      patch.push(String(url));
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => doc, text: async () => '' };
  };
  try { return await fn(patch); } finally { globalThis.fetch = vero; }
}

for (const status of ['working', 'revision_capability', 'revision_security']) {
  test(`un lavoro in ${status} non torna in coda con un comando dell'owner`, async () => {
    const mod = await import(MOD);
    expect(mod.transizioneAmmessa(status, 'todo').ok, `${status} → todo per l'owner`).toBe(false);
    const doc = {
      name: 'projects/p/databases/(default)/documents/feedback/d1',
      fields: { clientId: { stringValue: 'c-utente' }, status: { stringValue: status }, statusPublic: { stringValue: 'open' }, notes: { stringValue: '' } },
    };
    await conRete(doc, async (patch) => {
      const r = await mod.scrivi('d1', 'todo', 'rimetto in coda', { bearer: 'tok-finto' });
      expect(r.ok, 'il comando rifiuta').toBe(false);
      expect(patch.length, 'nessuna scrittura').toBe(0);
    });
  });
}
