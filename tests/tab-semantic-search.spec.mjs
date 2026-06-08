// Ricerca semantica dell'archivio (spec §3.2) + indicizzazione alla chiusura.
//
// L'embedding reale richiede la chiave Google: nei test STUBBIAMO il provider di
// embedding (globalThis.SN_PROVIDER_GEMINI.embed) e impostiamo una chiave finta,
// così verifichiamo il PLUMBING: indicizzazione alla chiusura (embedding+snippet),
// ranking per similarità coseno, e che gli embedding NON vengano spediti al
// renderer nelle liste.

import { test, expect } from './fixtures/electron.mjs';

test('chiudendo una scheda (con chiave + embedding) viene indicizzata: embedding + snippet', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { gemini: 'test-key' } });
    // Stub deterministico: un vettore non vuoto per ogni testo.
    globalThis.SN_PROVIDER_GEMINI.embed = async ({ texts }) => texts.map(() => [0.5, 0.2, 0.9, 0.1]);
  });

  const page = await testServer.openReady(openTab,
    '<!doctype html><html><head><title>Gatti</title></head><body style="margin:0">gatti felini animali domestici coccole</body></html>');
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);

  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), id);

  // L'entry archiviata riceve embedding + snippet (best-effort, async).
  await expect.poll(async () => app.evaluate(async () => {
    const l = await globalThis.SN_ARCHIVED_TABS.list();
    const e = l.find((x) => /Gatti/.test(x.title || ''));
    return !!(e && Array.isArray(e.embedding) && e.embedding.length && e.snippet);
  }), { timeout: 8_000 }).toBe(true);
});

test('la ricerca semantica ordina per pertinenza e non espone gli embedding', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { gemini: 'test-key' } });
    const A = globalThis.SN_ARCHIVED_TABS;
    const a = await A.archive({ url: 'https://a.test/', title: 'DocA' });
    const b = await A.archive({ url: 'https://b.test/', title: 'DocB' });
    // DocA ≈ direzione [1,0]; DocB ≈ [0,1].
    await A.update(a.id, { embedding: [127, 0], snippet: 'documento A' });
    await A.update(b.id, { embedding: [0, 127], snippet: 'documento B' });
    // La query embeddizza vicino a DocA.
    globalThis.SN_PROVIDER_GEMINI.embed = async ({ texts }) => texts.map(() => [1, 0]);
  });

  const page = await openTab('filo://newtab/');
  const r = await page.evaluate(async () =>
    await chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'qualcosa' }));

  expect(r && Array.isArray(r.results)).toBe(true);
  expect(r.results.length).toBeGreaterThanOrEqual(2);
  // DocA è il più pertinente.
  expect(r.results[0].title).toBe('DocA');
  // Gli embedding non vengono spediti al renderer.
  expect(r.results.every((x) => x.embedding === undefined)).toBe(true);

  // Anche la lista normale (GET_ARCHIVED_TABS) non porta gli embedding.
  const list = await page.evaluate(async () =>
    await chrome.runtime.sendMessage({ type: 'get_archived_tabs' }));
  expect(list.tabs.every((x) => x.embedding === undefined)).toBe(true);
});
