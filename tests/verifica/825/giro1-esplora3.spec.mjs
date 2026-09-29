import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

test('flusso vero: chiudo una scheda, la cancello dalla Cronologia, dove resta il suo indirizzo', async ({ app, shell, openTab, testServer }) => {
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
  const url = testServer.html('<!doctype html><title>Pagina riservata</title><body>contenuto riservato molto privato</body>', { pubblico: true });
  const marca = new URL(url).pathname;
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 }).catch(() => {});
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
  await new Promise((r) => setTimeout(r, 1500));
  await app.evaluate(async () => { await globalThis.__filoStorage.whenSettled(); });
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  const dove = tuttiIFile(userData).filter((p) => { try { return readFileSync(p).includes(marca); } catch (_) { return false; } });
  console.log('FILE CON L’INDIRIZZO:', JSON.stringify(dove.map((p) => p.slice(userData.length)), null, 1));
  const chiavi = await app.evaluate(async (_e, m) => {
    const all = await globalThis.chrome.storage.local.get(null);
    return Object.keys(all).filter((k) => JSON.stringify(all[k]).includes(m));
  }, marca);
  console.log('CHIAVI DI storage.json CON L’INDIRIZZO:', JSON.stringify(chiavi));
});
