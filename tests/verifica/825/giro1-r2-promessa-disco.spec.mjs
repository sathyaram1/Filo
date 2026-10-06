// Verifica #825 giro 1, rilievo 2: novità e descrizione della Cronologia promettono che una scheda cancellata «sparisce anche
// dal disco». Se la promessa c'è, dopo il flusso vero (apro la pagina, chiudo, cancello dalla Cronologia) nessun file della
// cartella dati deve contenere il suo indirizzo. Oggi resta nella cache di navigazione.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PROMESSA = /sparisce anche dal disco/i;

function tuttiIFile(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    let s;
    try { s = statSync(p); } catch (_) { continue; }
    if (s.isDirectory()) out.push(...tuttiIFile(p));
    else out.push(p);
  }
  return out;
}

test('la promessa «sparisce anche dal disco» è vera nel flusso vero di chiusura e cancellazione', async ({ app, shell, openTab, testServer }) => {
  const testi = ['src/shared/patchNotes.js', 'src/shared/capabilities.js']
    .map((f) => readFileSync(join(APP_ROOT, f), 'utf8'));
  if (!testi.some((t) => PROMESSA.test(t))) return;

  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [0.5, 0.2, 0.9, 0.1]) });
    globalThis.SN_PROVIDERS.completeWithFallback = async () => ({ text: 'Riassunto finto della pagina.', provider: 'openrouter', model: 'stub', usage: {} });
  });
  const url = testServer.html('<!doctype html><title>Pagina riservata</title><body>contenuto riservato</body>', { pubblico: true });
  const marca = new URL(url).pathname;
  await openTab(url);
  await testServer.openReady(openTab, '<!doctype html><title>Altra</title><body>altra</body>', { pubblico: true });
  const snap = await shell.evaluate(async () => window.filoShell.tabs.snapshot());
  const t = snap.tabs.find((x) => (x.url || '').endsWith(marca));
  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), t.id);
  await expect.poll(async () => app.evaluate(async (_e, m) => {
    const e = (await globalThis.SN_ARCHIVED_TABS.list()).find((x) => x.url.endsWith(m));
    return !!(e && e.embedding);
  }, marca), { timeout: 10_000 }).toBe(true);
  const id = await app.evaluate(async (_e, m) => (await globalThis.SN_ARCHIVED_TABS.list()).find((x) => x.url.endsWith(m)).id, marca);

  const arc = await openTab('filo://archive/archive.html');
  await arc.waitForLoadState('domcontentloaded');
  await arc.evaluate(async (i) => chrome.runtime.sendMessage({ type: 'remove_archived_tab', id: i }), id);
  await app.evaluate(async () => { await globalThis.__filoStorage.whenSettled(); });

  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  await expect.poll(() => tuttiIFile(userData)
    .filter((p) => { try { return readFileSync(p).includes(marca); } catch (_) { return false; } })
    .map((p) => p.slice(userData.length)), { timeout: 5_000 }).toEqual([]);
});
