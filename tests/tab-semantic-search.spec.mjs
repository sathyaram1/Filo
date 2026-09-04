// Ricerca semantica + riassunto + re-rank + cancellazione retroattiva
// (spec §3.1 riassunto, §3.2 ricerca/embedding/re-rank, §5 pulizia retroattiva).
//
// LLM ed embedding reali richiedono la chiave Google: nei test STUBBIAMO sia il
// provider di embedding (SN_PROVIDER_OPENROUTER.embed) sia il completamento LLM
// (SN_PROVIDERS.completeWithFallback) e impostiamo una chiave finta, così
// verifichiamo il PLUMBING: indicizzazione (riassunto + embedding + snippet),
// ranking per coseno, re-rank LLM, e cancellazione multipla.

import { test, expect } from './fixtures/electron.mjs';

// Forza il registry/modelli LOCALI (useDefaultModels:false) così la risoluzione
// del modello non dipende dal registry remoto (Firestore), e stubba embedding +
// completamento LLM con una chiave finta.
async function setupStubs(app, { summary } = {}) {
  await app.evaluate(async ({}, args) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...C.DEFAULT_MODELS },
      modelRegistry: { ...C.DEFAULT_MODEL_REGISTRY },
    });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [0.5, 0.2, 0.9, 0.1]) });
    if (args.summary != null) {
      globalThis.SN_PROVIDERS.completeWithFallback = async () => ({
        text: args.summary, provider: 'openrouter', model: 'stub', usage: {},
      });
    }
  }, { summary: summary ?? null });
}

test('chiudere una scheda la indicizza: riassunto LLM + embedding + snippet', async ({ app, shell, openTab, testServer }) => {
  await setupStubs(app, { summary: 'Riassunto di prova: pagina sui gatti e i felini domestici.' });

  await testServer.openReady(openTab,
    '<!doctype html><html><head><title>Gatti</title></head><body style="margin:0">gatti felini animali domestici coccole</body></html>');
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), id);

  await expect.poll(async () => app.evaluate(async () => {
    const l = await globalThis.SN_ARCHIVED_TABS.list();
    const e = l.find((x) => /Gatti/.test(x.title || ''));
    return e
      ? { hasEmbed: Array.isArray(e.embedding) && e.embedding.length > 0, hasSnippet: !!e.snippet, summary: e.summary || '' }
      : null;
  }), { timeout: 8_000 }).toEqual(
    expect.objectContaining({ hasEmbed: true, hasSnippet: true, summary: expect.stringContaining('Riassunto di prova') }),
  );
});

test('la ricerca semantica ordina per pertinenza e non espone gli embedding', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...C.DEFAULT_MODELS },
      modelRegistry: { ...C.DEFAULT_MODEL_REGISTRY },
    });
    const A = globalThis.SN_ARCHIVED_TABS;
    const a = await A.archive({ url: 'https://a.test/', title: 'DocA' });
    const b = await A.archive({ url: 'https://b.test/', title: 'DocB' });
    const EM = C.DEFAULT_MODEL_REGISTRY['qwen-embed'].model;
    await A.update(a.id, { embedding: [127, 0], embedModel: EM, snippet: 'documento A' });
    await A.update(b.id, { embedding: [0, 127], embedModel: EM, snippet: 'documento B' });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [1, 0]) }); // ≈ DocA
    // Niente re-rank: il completamento torna vuoto → resta l'ordine per coseno.
    globalThis.SN_PROVIDERS.completeWithFallback = async () => ({ text: '', provider: 'openrouter', model: 'stub', usage: {} });
  });

  const page = await openTab('filo://newtab/');
  const r = await page.evaluate(async () =>
    await chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'qualcosa' }));

  expect(r && Array.isArray(r.results)).toBe(true);
  expect(r.results[0].title).toBe('DocA');
  expect(r.results.every((x) => x.embedding === undefined)).toBe(true);

  const list = await page.evaluate(async () =>
    await chrome.runtime.sendMessage({ type: 'get_archived_tabs' }));
  expect(list.tabs.every((x) => x.embedding === undefined)).toBe(true);
});

test('il re-rank LLM può riordinare i risultati rispetto al coseno', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...C.DEFAULT_MODELS },
      modelRegistry: { ...C.DEFAULT_MODEL_REGISTRY },
    });
    const A = globalThis.SN_ARCHIVED_TABS;
    const a = await A.archive({ url: 'https://a.test/', title: 'DocA' });
    const b = await A.archive({ url: 'https://b.test/', title: 'DocB' });
    const EM = C.DEFAULT_MODEL_REGISTRY['qwen-embed'].model;
    await A.update(a.id, { embedding: [127, 0], embedModel: EM, snippet: 'A' });
    await A.update(b.id, { embedding: [0, 127], embedModel: EM, snippet: 'B' });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [1, 0]) }); // coseno → DocA primo
    // Re-rank: l'LLM mette DocB davanti (head = [DocA, DocB], order [1,0]).
    globalThis.SN_PROVIDERS.completeWithFallback = async () => ({
      text: '{"order":[1,0]}', provider: 'openrouter', model: 'stub', usage: {},
    });
  });

  const page = await openTab('filo://newtab/');
  const r = await page.evaluate(async () =>
    await chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'x' }));
  expect(r.results[0].title).toBe('DocB'); // il re-rank ha vinto sul coseno
});

test('§5 — cancellazione multipla dall’archivio (DELETE_ARCHIVED_TABS)', async ({ app, openTab }) => {
  const ids = await app.evaluate(async () => {
    const A = globalThis.SN_ARCHIVED_TABS;
    const a = await A.archive({ url: 'https://x.test/', title: 'X1' });
    const b = await A.archive({ url: 'https://y.test/', title: 'X2' });
    const c = await A.archive({ url: 'https://z.test/', title: 'Keep' });
    return [a.id, b.id, c.id];
  });

  const page = await openTab('filo://newtab/');
  const res = await page.evaluate(async (delIds) =>
    await chrome.runtime.sendMessage({ type: 'delete_archived_tabs', ids: delIds }),
  [ids[0], ids[1]]);
  expect(res.removed).toBe(2);

  const left = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).map((x) => x.title));
  expect(left).toContain('Keep');
  expect(left).not.toContain('X1');
  expect(left).not.toContain('X2');
});

test('cambiando modello di indicizzazione, i vettori vecchi si rifanno da soli e la ricerca riparte', async ({ app, openTab }) => {
  // Le schede archiviate prima del cambio (o con l'API di Google, che non c'è
  // più) hanno vettori di un'altra "lingua": non si confrontano con quelli
  // nuovi. La ricerca deve ignorarli — e reindicizzarli in background, così
  // dalla ricerca dopo ci sono anche loro. Senza il fix: o si confrontano
  // vettori incompatibili (risultati a caso) o le schede vecchie spariscono
  // dalla ricerca per sempre.
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...C.DEFAULT_MODELS },
      modelRegistry: { ...C.DEFAULT_MODEL_REGISTRY },
    });
    const A = globalThis.SN_ARCHIVED_TABS;
    const vecchia = await A.archive({ url: 'https://vecchia.test/', title: 'Vecchia' });
    // Vettore di un altro modello (nessun embedModel = fatto prima del cambio).
    await A.update(vecchia.id, { embedding: [0, 127], snippet: 'pagina vecchia' });
    globalThis.__embedCalls = [];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => {
      globalThis.__embedCalls.push(texts);
      return { vectors: texts.map(() => [1, 0]) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async () => ({ text: '', provider: 'openrouter', model: 'stub', usage: {} });
  });

  const page = await openTab('filo://newtab/');
  const prima = await page.evaluate(async () =>
    await chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'vecchia' }));
  // Al primo giro il vettore incompatibile non conta: la scheda non è fra i risultati.
  expect(prima.ok).toBe(true);
  expect((prima.results || []).some((x) => x.title === 'Vecchia')).toBe(false);

  // …ma viene reindicizzata in background col modello in uso.
  const EM = await app.evaluate(() => globalThis.SN_CONST.DEFAULT_MODEL_REGISTRY['qwen-embed'].model);
  await expect.poll(async () => app.evaluate(async () => {
    const l = await globalThis.SN_ARCHIVED_TABS.list();
    const e = l.find((x) => x.title === 'Vecchia');
    return e ? e.embedModel || '' : '';
  }), { timeout: 8_000 }).toBe(EM);
  // Il testo mandato al modello è quello della scheda, non vuoto.
  const calls = await app.evaluate(() => globalThis.__embedCalls);
  expect(calls.some((texts) => texts.some((t) => /Vecchia|pagina vecchia/.test(t)))).toBe(true);

  // Dalla ricerca successiva la scheda c'è.
  const dopo = await page.evaluate(async () =>
    await chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'vecchia' }));
  expect((dopo.results || []).some((x) => x.title === 'Vecchia')).toBe(true);
});
