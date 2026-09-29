// Verifica #771 giro 1, rilievo 2: senza fornitore la chat non dà per fatto «apri da un altro paese».
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

async function copione(app, script) {
  await app.evaluate(async (_e, script) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__captured = [];
    let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const step = script[Math.min(i++, script.length - 1)];
      globalThis.__captured.push({ messages: JSON.parse(JSON.stringify(messages)) });
      await new Promise((r) => setTimeout(r, 40));
      for (const c of step.toolCalls || []) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (step.text) { try { onDelta && onDelta(step.text); } catch (_) {} }
      return {
        text: step.text || '', toolCalls: step.toolCalls || [], reasoningDetails: [],
        model: attempts[0].model, provider: attempts[0].provider, usage: {}, finishReason: step.toolCalls ? 'tool_calls' : 'stop',
      };
    };
  }, script);
}

// La frase scritta insieme alla chiamata («Fatto, da ora…») con un ultimo giro
// muto diventa la risposta: senza fornitore è una promessa falsa.
test('senza fornitore, la frase «fatto» scritta con l\'azione non diventa la risposta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await copione(app, [
    {
      text: 'PROMESSA: fatto, da ora netflix si apre sempre dagli Stati Uniti.',
      toolCalls: [{ id: 'r1', name: 'REGOLA_PROXY_DOMINIO', arguments: '{"country":"us","dominio":"netflix.com"}' }],
    },
    { text: '' },
  ]);
  await page.locator('#input').fill('apri sempre netflix dagli USA');
  await page.locator('#sendBtn').click();
  await expect.poll(() => app.evaluate(() => globalThis.__captured.length), { timeout: 15_000 }).toBe(2);
  await page.waitForTimeout(1500);
  const regole = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listProxyRules());
  expect(Object.keys(regole || {})).toEqual([]);
  await page.screenshot({ path: 'tests/.shots/771-v-giro-muto.png' }).catch(() => {});
  await expect(page.locator('.dash-bubble-filo', { hasText: 'PROMESSA' })).toHaveCount(0);
});
