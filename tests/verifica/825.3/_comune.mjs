// Aiuti condivisi delle prove del giro 4 di #825.3: chat e giudice finti, archivio di prova.

export async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}
export async function configure(app, extra = {}) {
  await app.evaluate(async (_e, ex) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      ...ex,
    });
  }, extra);
}
export async function fakeChat(app, giri) {
  await app.evaluate(async (_electron, g) => {
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)]; n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, giri);
}
export async function seedArchive(app, schede, { tutte = false } = {}) {
  await app.evaluate(async (_electron, { s, tutte }) => {
    const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
    const items = s.map((x, i) => ({ id: `t${i}`, url: x.url || `https://sito${i}.example.com/`, title: x.title, favicon: '',
      closedAt: new Date(Date.now() - i * 1000).toISOString(), reason: 'manual', coOpenUrls: [], snippet: x.title,
      embedding: x.gatto ? [127, 0] : [0, 127], embedModel: EM }));
    await chrome.storage.local.set({ [globalThis.SN_CONST.STORAGE_KEYS.ARCHIVED_TABS]: items });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [1, 0]) });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const sys = String(messages[0] && messages[0].content || '');
      const out = (text) => ({ text, provider: attempts[0].provider, model: attempts[0].model, usage: {} });
      if (!/eliminare dall'archivio/.test(sys)) return out('{}');
      const user = String(messages[1].content || '');
      const presi = [...user.matchAll(/^#(\d+) (.*)$/gm)].filter((m) => tutte || /gatt/i.test(m[2])).map((m) => Number(m[1]));
      return out(JSON.stringify({ pertinenti: presi }));
    };
  }, { s: schede, tutte });
}
export async function chiedi(page, testo) { await page.locator('#input').fill(testo); await page.locator('#sendBtn').click(); }

