// Preparazione comune alle prove del giro 3 di #825.3: chat, indice e giudice finti.

export async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

// `schede`: [{ title, gatto, url? }]; `chiamate`: i tool chiamati al primo giro;
// `indiceGiu`: l'indicizzazione risponde con un errore di rete.
export async function prepara(app, schede, { chiamate, indiceGiu = false } = {}) {
  await app.evaluate(async (_e, { s, calls, giu }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const giri = [{ toolCalls: calls }, { text: 'Ecco.' }];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = giri[Math.min(n, giri.length - 1)]; n += 1;
      const tc = giro.toolCalls || [];
      for (const c of tc) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: tc, reasoningDetails: [], finishReason: tc.length ? 'tool_calls' : 'stop' };
    };
    const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
    const items = s.map((x, i) => ({
      id: `t${i}`, url: x.url || `https://sito${i}.example.com/`, title: x.title, favicon: '',
      closedAt: new Date(Date.now() - i * 1000).toISOString(), reason: 'manual', coOpenUrls: [], snippet: x.title,
      embedding: x.gatto ? [127, 0] : [0, 127], embedModel: EM,
    }));
    await chrome.storage.local.set({ [C.STORAGE_KEYS.ARCHIVED_TABS]: items });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => {
      if (giu) throw Object.assign(new Error('fetch failed'), { status: 0 });
      return { vectors: texts.map(() => [1, 0]) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const out = (text) => ({ text, provider: attempts[0].provider, model: attempts[0].model, usage: {} });
      if (!/eliminare dall'archivio/.test(String(messages[0] && messages[0].content || ''))) return out('{}');
      const user = String(messages[1].content || '');
      return out(JSON.stringify({ pertinenti: [...user.matchAll(/^#(\d+) (.*)$/gm)].filter((m) => /gatt/i.test(m[2])).map((m) => Number(m[1])) }));
    };
  }, { s: schede, calls: chiamate, giu: indiceGiu });
}

export async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}
