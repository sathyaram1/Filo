// Verifica locale «lavori locali», rilievo 3: lo strumento con cui una sessione cambia stato ai feedback
// non deve farle prendere in lavorazione né chiudere come fatto il feedback di un UTENTE.
// Firestore è finto (fetch sostituita): niente rete, niente token. Non apre Filo.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');

function docFinto(id, campi) {
  const fields = {};
  for (const [k, v] of Object.entries(campi)) fields[k] = { stringValue: String(v) };
  return { name: `projects/p/databases/(default)/documents/feedback/${id}`, fields };
}

// Il processo del test è condiviso con gli altri file: la rete vera torna al suo posto alla fine.
const fetchVera = globalThis.fetch;
test.afterAll(() => { globalThis.fetch = fetchVera; });

test.beforeAll(() => {
  const docs = new Map([
    ['utente-todo', docFinto('utente-todo', { clientId: 'anon-abc', status: 'todo', statusPublic: 'open' })],
    ['utente-working', docFinto('utente-working', { clientId: 'anon-abc', status: 'working', statusPublic: 'open' })],
    ['owner-todo', docFinto('owner-todo', { clientId: 'owner:xyz', senderProof: 'admin', status: 'todo', statusPublic: 'open' })],
  ]);
  globalThis.fetch = async (url, opts = {}) => {
    const m = /\/feedback\/([^?]+)/.exec(String(url));
    const d = m && docs.get(decodeURIComponent(m[1]));
    if ((opts.method || 'GET') === 'PATCH') return new Response('{}', { status: 200 });
    return d ? new Response(JSON.stringify(d), { status: 200 }) : new Response('no', { status: 404 });
  };
});

const strumenti = () => import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);

test('una sessione non prende in lavorazione il feedback di un utente', async () => {
  const of = await strumenti();
  for (const attore of ['owner', 'routine']) {
    const r = await of.scrivi('utente-todo', 'working', 'lo lavoro in locale', { bearer: 'finto', dryRun: true, attore });
    expect(r.ok, `todo → working (${attore}) su un feedback di un utente`).toBe(false);
  }
});

test('una sessione non chiude come fatto il feedback di un utente lavorato in locale', async () => {
  const of = await strumenti();
  const r = await of.scrivi('utente-working', 'done', 'fatto in locale', { bearer: 'finto', dryRun: true, attore: 'routine' });
  expect(r.ok, 'working → done (--come-routine) su un feedback di un utente').toBe(false);
});

test('sul feedback dell’owner lo stesso passaggio resta permesso', async () => {
  const of = await strumenti();
  const r = await of.scrivi('owner-todo', 'working', 'lo lavoro in locale', { bearer: 'finto', dryRun: true, attore: 'routine' });
  expect(r.ok, r.motivo).toBe(true);
});
