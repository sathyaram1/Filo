// Verifica locale «lavori locali», giro 6: la porta del giro 5 riprovata. Una pratica dell'owner senza il segno
// «solo locale» non si lega a un lavoro locale e non si prende in lavorazione: sennò torna alle routine mentre la
// sessione la lavora. Col segno sì. Rete finta: nessuna lettura né scrittura su Firestore vero.
import { test, expect } from './../../fixtures/electron.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

function doc(id, { status, localOnly }) {
  const fields = {
    clientId: { stringValue: 'owner:me' }, senderProof: { stringValue: 'admin' },
    status: { stringValue: status }, statusPublic: { stringValue: 'open' }, notes: { stringValue: '' },
  };
  if (localOnly) fields.localOnly = { mapValue: { fields: { by: { stringValue: 'owner@esempio' }, at: { integerValue: '1' } } } };
  return { name: `projects/x/databases/(default)/documents/feedback/${id}`, fields };
}

async function conRete(docs, fn) {
  const vero = globalThis.fetch;
  const scritture = [];
  globalThis.fetch = async (url, init = {}) => {
    if (init.method && init.method !== 'GET') { scritture.push(String(url)); return new Response('{}', { status: 200 }); }
    const id = decodeURIComponent(String(url).split('/feedback/')[1].split('?')[0]);
    return docs[id] ? new Response(JSON.stringify(docs[id]), { status: 200 }) : new Response('{}', { status: 404 });
  };
  try { return await fn(scritture); } finally { globalThis.fetch = vero; }
}

test('pratica dell’owner In coda senza segno: né legame né presa in carico; col segno passa', async () => {
  const of = await imp('scripts/owner-feedback.mjs');
  const docs = { senza: doc('senza', { status: 'todo' }), col: doc('col', { status: 'todo', localOnly: true }) };
  await conRete(docs, async (scritture) => {
    const legame = await of.praticaPerLaSessione('senza', { bearer: 'finto' });
    expect(legame.ok, JSON.stringify(legame)).toBe(false);
    expect(of.rifiutoPratica('senza', legame)).toMatch(/--solo-locale/);
    const presa = await of.scrivi('senza', 'working', 'presa', { bearer: 'finto', attore: 'routine', dryRun: true });
    expect(presa.ok, JSON.stringify(presa)).toBe(false);
    const annota = await of.annotaPratica('senza', 'giro 1', { bearer: 'finto', dryRun: true });
    expect(annota.ok, JSON.stringify(annota)).toBe(false);
    expect(scritture).toEqual([]);

    const ok = await of.praticaPerLaSessione('col', { bearer: 'finto' });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
  });
});
