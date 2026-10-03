// Esplorazione del verificatore (#825.3): aspetto del bottone del riordino e del
// pannello di cancellazione in chat, chiaro e scuro, con una richiesta lunga.

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

async function prepara(app, giri, schede, theme) {
  await app.evaluate(async (_e, { g, s, theme: t }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      theme: t,
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)]; n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
    const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
    const items = s.map((x, i) => ({
      id: `t${i}`, url: `https://sito${i}.example.com/una/pagina/molto/lunga/${'x'.repeat(80)}`, title: x.title, favicon: '',
      closedAt: new Date(Date.now() - i * 1000).toISOString(), reason: 'manual', coOpenUrls: [], snippet: x.title,
      embedding: x.gatto ? [127, 0] : [0, 127], embedModel: EM,
    }));
    await chrome.storage.local.set({ [C.STORAGE_KEYS.ARCHIVED_TABS]: items });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [1, 0]) });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const out = (text) => ({ text, provider: attempts[0].provider, model: attempts[0].model, usage: {} });
      const sys = String(messages[0] && messages[0].content || '');
      if (!/eliminare dall'archivio/.test(sys)) return out('{}');
      const user = String(messages[1].content || '');
      const presi = [...user.matchAll(/^#(\d+) (.*)$/gm)].filter((m) => /gatt/i.test(m[2])).map((m) => Number(m[1]));
      return out(JSON.stringify({ pertinenti: presi }));
    };
  }, { g: giri, s: schede, theme });
}

for (const theme of ['light', 'dark']) {
  test(`aspetto ${theme}`, async ({ app, shell }) => {
    test.setTimeout(60_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await expect(page.locator('#input')).toBeVisible();
    const lunga = 'pagine sui gatti 🐱 <b>persiani</b> e tutte quelle sulle razze feline a pelo lungo che avevo guardato la settimana scorsa per scegliere il gattino da adottare';
    const schede = [];
    for (let i = 0; i < 27; i++) schede.push({ title: `Ricetta numero ${i}`, gatto: false });
    schede.splice(2, 0, { title: 'Gatti persiani: carattere, cura del pelo e alimentazione, guida completa per chi vuole adottarne uno', gatto: true });
    schede.splice(9, 0, { title: 'Cibo per gatti', gatto: true });
    await prepara(app, [
      { toolCalls: [{ id: 'p1', name: 'PULISCI_TAB', arguments: '{}' }, { id: 'c1', name: 'CANCELLA_ARCHIVIO', arguments: JSON.stringify({ query: lunga }) }] },
      { text: 'Valuto le schede e ti mostro quelle sui gatti da eliminare.' },
    ], schede, theme);
    await page.locator('#input').fill('fai pulizia delle schede e cancella dall\'archivio le pagine sui gatti');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-delete-panel .dash-delete-list li')).toHaveCount(2, { timeout: 15_000 });
    await page.screenshot({ path: `tests/.shots/825-3-${theme}-chiuso.png` });
    await page.locator('.dash-activity .dash-activity-head').click();
    await page.waitForTimeout(400);
    const head = await page.locator('.dash-activity-head').innerText();
    console.log('HEAD', theme, JSON.stringify(head));
    console.log('BODY', theme, JSON.stringify(await page.locator('.dash-activity-body').innerText()));
    await page.screenshot({ path: `tests/.shots/825-3-${theme}-aperto.png` });
  });
}
