// Verifica locale «lavori locali», giro 7, rilievo 2: un feedback aperto da una routine (non un utente) che l'owner
// vuole lavorato in locale. Il segno o il legame passano, oppure il rifiuto dice la strada; e chiuderlo dopo il
// lavoro in locale non si rifiuta. Rete finta: nessuna lettura né scrittura su Firestore vero.
import { test, expect } from './../../fixtures/electron.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

const doc = (id, status) => ({
  name: `projects/x/databases/(default)/documents/feedback/${id}`,
  fields: {
    clientId: { stringValue: 'routine:residuo' }, senderProof: { stringValue: 'server' },
    status: { stringValue: status }, statusPublic: { stringValue: 'open' }, notes: { stringValue: '' },
  },
});

async function conRete(docs, fn) {
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (init.method && init.method !== 'GET') return new Response('{}', { status: 200 });
    const id = decodeURIComponent(String(url).split('/feedback/')[1].split('?')[0]);
    return docs[id] ? new Response(JSON.stringify(docs[id]), { status: 200 }) : new Response('{}', { status: 404 });
  };
  try { return await fn(); } finally { globalThis.fetch = vero; }
}

test('un feedback di una routine si può portare in locale, o il rifiuto dice come; chiuderlo dopo il lavoro passa', async () => {
  const of = await imp('scripts/owner-feedback.mjs');
  await conRete({ r: doc('r', 'todo') }, async () => {
    const segno = await of.segnaLocale('r', true, { bearer: 'finto', dryRun: true });
    if (!segno.ok) {
      const righe = of.rifiutoPratica('r', segno).split('\n');
      expect(righe.length, righe.join('\n')).toBeGreaterThan(1);
    }
    const chiusura = await of.scrivi('r', 'done', 'risolto in locale sul ramo claude/prova', { bearer: 'finto', attore: 'routine', dryRun: true });
    expect(chiusura.ok, JSON.stringify(chiusura)).toBe(true);
  });
});
