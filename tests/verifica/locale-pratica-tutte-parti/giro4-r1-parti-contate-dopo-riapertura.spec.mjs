// Verifica locale pratica-tutte-parti, giro 4, rilievo 1: una parte fusa resta contata su main anche quando il lavoro
// riparte (pratica riaperta, o seguito dell'app su una pratica chiusa dall'app), e la parte che arriva dopo non la usa.
import { test, expect } from './../../fixtures/electron.mjs';
import { repoApp, firestoreFinto, pratica, chiusaDallApp, stato, moduli, serverFondi } from './banco-parti.mjs';

let fetchVero;
test.beforeEach(() => { fetchVero = globalThis.fetch; });
test.afterEach(() => { globalThis.fetch = fetchVero; });

test('riaperta dopo che app e server erano su main: server:fondi del seguito la lascia aperta per il seguito dell’app', async () => {
  const { of, sf } = await moduli();
  const { docs, fetchFinto } = firestoreFinto();
  globalThis.fetch = fetchFinto;
  const app = repoApp();
  pratica(docs, 'r1a');
  app.ramo('claude/d', 'r1a');
  expect((await serverFondi(sf, app, 'claude/d', 'r1a')).k).toBe(0);
  app.fondi('claude/d');
  chiusaDallApp(docs, 'r1a', 'claude/d');
  // L'owner riapre: manca ancora qualcosa, in tutte e due le parti.
  expect((await of.scrivi('r1a', 'todo', 'Riaperta: non va ancora.', { bearer: 'finto', attore: 'owner' })).ok).toBe(true);
  const r = await serverFondi(sf, app, 'claude/d', 'r1a');
  expect(stato(docs, 'r1a'), `dopo la riapertura il seguito del server l'ha richiusa come ultima parte:\n${r.testo}`).not.toBe('done');
});

test('riaperta e richiusa dal seguito dell’app: il seguito del server la usa come ultima parte', async () => {
  const { of, sf } = await moduli();
  const { docs, fetchFinto } = firestoreFinto();
  globalThis.fetch = fetchFinto;
  const app = repoApp();
  pratica(docs, 'r1b');
  const wt = app.ramo('claude/f', 'r1b');
  await serverFondi(sf, app, 'claude/f', 'r1b');
  app.fondi('claude/f');
  chiusaDallApp(docs, 'r1b', 'claude/f');
  expect((await of.scrivi('r1b', 'todo', 'Riaperta: non va ancora.', { bearer: 'finto', attore: 'owner' })).ok).toBe(true);
  app.commit(wt, 'claude/f');
  app.fondi('claude/f');
  chiusaDallApp(docs, 'r1b', 'claude/f');
  const r = await serverFondi(sf, app, 'claude/f', 'r1b');
  expect(r.k, r.testo).toBe(0);
});

test('chiusa dall’app, poi un seguito dell’app fuori da main: la parte del server tardiva non la lascia chiusa come se fosse l’ultima', async () => {
  const { sf } = await moduli();
  const { docs, fetchFinto } = firestoreFinto();
  globalThis.fetch = fetchFinto;
  const app = repoApp();
  pratica(docs, 'r1c');
  const wt = app.ramo('claude/h', 'r1c');
  app.fondi('claude/h');
  chiusaDallApp(docs, 'r1c', 'claude/h');
  app.commit(wt, 'claude/h');
  const r = await serverFondi(sf, app, 'claude/h', 'r1c');
  expect(stato(docs, 'r1c'), `il seguito dell'app è fuori da main ma la pratica resta chiusa:\n${r.testo}`).not.toBe('done');
});
