// Verifica locale pratica-tutte-parti, giro 4, rilievo 2: un ramo dell'app legato alla pratica e poi cancellato conta
// per sempre come parte che manca, e anche --solo-server si rifiuta: la pratica di un lavoro tutto sul server non si chiude.
import { test, expect } from './../../fixtures/electron.mjs';
import { repoApp, firestoreFinto, pratica, stato, moduli, serverFondi, sh } from './banco-parti.mjs';

test('un ramo dell’app legato e poi cancellato non tiene aperta per sempre la pratica di un lavoro sul server', async () => {
  const { sf } = await moduli();
  const { docs, fetchFinto } = firestoreFinto();
  const fetchVero = globalThis.fetch;
  globalThis.fetch = fetchFinto;
  try {
    const app = repoApp();
    pratica(docs, 'r2');
    const wt = app.ramo('claude/vecchio', 'r2');
    sh(wt, 'switch', '-q', '-c', 'claude/altro');
    sh(app.wc, 'branch', '-q', '-D', 'claude/vecchio');
    const r = await serverFondi(sf, app, 'claude/g', 'r2', ['--solo-server']);
    expect(stato(docs, 'r2'), r.testo).toBe('done');
  } finally {
    globalThis.fetch = fetchVero;
  }
});
