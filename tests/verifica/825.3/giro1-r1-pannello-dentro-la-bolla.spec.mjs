// Verifica #825.3, giro 1, rilievo 1: con il titolo lungo di una pagina (il caso
// comune) il pannello di cancellazione esce dal bordo destro della bolla di Filo.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('titolo lungo nell\'elenco: il pannello di cancellazione resta dentro la bolla', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const giri = [
      { toolCalls: [{ id: 'c1', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"gatti"}' }] },
      { text: 'Ecco le schede sui gatti.' },
    ];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = giri[Math.min(n, giri.length - 1)]; n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
    const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
    const titoli = ['Gatti persiani: carattere, cura del pelo e alimentazione, guida completa per chi vuole adottarne uno', 'Cibo per gatti', 'Ricetta della torta'];
    const items = titoli.map((title, i) => ({
      id: `t${i}`, url: `https://sito${i}.example.com/`, title, favicon: '', snippet: title,
      closedAt: new Date(Date.now() - i * 1000).toISOString(), reason: 'manual', coOpenUrls: [],
      embedding: /gatt/i.test(title) ? [127, 0] : [0, 127], embedModel: EM,
    }));
    await chrome.storage.local.set({ [C.STORAGE_KEYS.ARCHIVED_TABS]: items });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [1, 0]) });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const out = (text) => ({ text, provider: attempts[0].provider, model: attempts[0].model, usage: {} });
      if (!/eliminare dall'archivio/.test(String(messages[0] && messages[0].content || ''))) return out('{}');
      const user = String(messages[1].content || '');
      return out(JSON.stringify({ pertinenti: [...user.matchAll(/^#(\d+) (.*)$/gm)].filter((m) => /gatt/i.test(m[2])).map((m) => Number(m[1])) }));
    };
  });

  await page.locator('#input').fill('cancella dall\'archivio le pagine sui gatti');
  await page.locator('#sendBtn').click();
  const panel = page.locator('.dash-delete-panel');
  await expect(panel.locator('.dash-delete-list li')).toHaveCount(2, { timeout: 15_000 });
  const destra = (loc) => loc.evaluate((el) => el.getBoundingClientRect().right);
  const bolla = page.locator('.dash-bubble-filo', { has: panel });
  expect(await destra(panel)).toBeLessThanOrEqual(await destra(bolla));
});
