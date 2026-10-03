// Giro 5: riaperta e continuata, la chat manda al modello un turno di Filo vuoto e non gli dice cosa è stato eliminato.
import { test, expect } from '../../fixtures/electron.mjs';
import { fillConfirmInput, clickConfirm } from '../../helpers/confirm.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('chat riaperta dopo una cancellazione confermata: al modello nessun turno vuoto, e la cancellazione la sa', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
    const items = [['Gatti persiani', [127, 0]], ['Torta', [0, 127]]].map(([title, embedding], i) => ({
      id: `t${i}`, url: `https://sito${i}.example.com/`, title, favicon: '', closedAt: new Date(Date.now() - i * 1000).toISOString(),
      reason: 'manual', coOpenUrls: [], snippet: title, embedding, embedModel: EM,
    }));
    await chrome.storage.local.set({ [C.STORAGE_KEYS.ARCHIVED_TABS]: items });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [1, 0]) });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const user = String(messages[1] && messages[1].content || '');
      const presi = [...user.matchAll(/^#(\d+) (.*)$/gm)].filter((m) => /gatt/i.test(m[2])).map((m) => Number(m[1]));
      return { text: JSON.stringify({ pertinenti: presi }), provider: attempts[0].provider, model: attempts[0].model, usage: {} };
    };
    globalThis.__chatCalls = [];
    let n = 0;
    const giri = [
      { toolCalls: [{ id: 'c1', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"gatti"}' }] },
      { text: 'Ecco.' },
      { text: 'Sì, le ho eliminate.' },
    ];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__chatCalls.push(JSON.parse(JSON.stringify(messages)));
      const g = giri[Math.min(n, giri.length - 1)];
      n += 1;
      const calls = g.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (g.text) { try { onDelta && onDelta(g.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: g.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  });

  await page.locator('#input').fill('cancella dall\'archivio le pagine sui gatti');
  await page.locator('#sendBtn').click();
  const panel = page.locator('.dash-delete-panel');
  await expect(panel.locator('.dash-delete-list li')).toHaveCount(1, { timeout: 15_000 });
  await panel.locator('.dash-action-btn-danger').click();
  await fillConfirmInput(page, 'conferma');
  await clickConfirm(page, 'danger');
  await expect(panel.locator('.dash-delete-note')).toHaveText('✓ Eliminata definitivamente 1 scheda.', { timeout: 5_000 });
  const chat = () => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l[0]));
  await expect.poll(async () => (await chat()).messages.flatMap((m) => m.actions || []), { timeout: 5_000 }).toEqual(['CANCELLA_ARCHIVIO']);

  const { id } = await chat();
  await app.evaluate((_e, chatId) => globalThis.SN_CLOSE_FILO_CHAT(chatId), id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
  await expect(page.locator('.dash-bubble')).toHaveCount(2, { timeout: 8_000 });
  await page.locator('#input').fill('le hai eliminate davvero?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sì, le ho eliminate.' })).toBeVisible({ timeout: 10_000 });
  const ultimo = await app.evaluate(() => globalThis.__chatCalls[globalThis.__chatCalls.length - 1]);
  const vuoti = ultimo.filter((m) => m.role === 'assistant' && !String(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).trim());
  expect(vuoti, 'al modello è arrivato un turno di Filo vuoto').toEqual([]);
});
