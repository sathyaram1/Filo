// Giro 1, rilievo 1: «fondi senza chiedermelo» fa saltare L5 a una pratica come il sì del lavoro locale, e una
// sessione non deve poterlo mettere su un feedback di un utente dalla riga di comando: solo l'owner, in Gestione.

import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const mod = await import(pathToFileURL(join(process.cwd(), 'scripts', 'owner-feedback.mjs')).href);

const UTENTE = {
  name: 'projects/p/databases/(default)/documents/feedback/fid-utente',
  fields: { clientId: { stringValue: 'u-3f9a1c' }, status: { stringValue: 'todo' }, statusPublic: { stringValue: 'open' } },
};

async function conRete(doc, fn) {
  const scritte = [];
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if ((opts.method || 'GET') !== 'GET') {
      scritte.push(JSON.parse(opts.body || '{}'));
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => doc, text: async () => '' };
  };
  try { return await fn(scritte); } finally { globalThis.fetch = vero; }
}

const segni = (scritte) => scritte.filter((b) => b.fields && 'mergePreapproved' in b.fields);

test('--preapprova su un feedback di un utente: rifiutato, niente scritto', async () => {
  await conRete(UTENTE, async (scritte) => {
    const r = await mod.segnaPreapprovazione('fid-utente', true, { bearer: 'tok-finto' });
    expect(r.ok, 'il segno che salta L5 non si dà da riga di comando a un feedback non tuo').toBe(false);
    expect(segni(scritte)).toEqual([]);
  });
});

test('<N> todo --preapprova su un feedback di un utente: il segno non viene scritto', async () => {
  await conRete(UTENTE, async (scritte) => {
    await mod.scrivi('fid-utente', 'todo', 'nota', { bearer: 'tok-finto', preapprova: true }).catch(() => null);
    expect(segni(scritte)).toEqual([]);
  });
});
