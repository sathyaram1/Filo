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

test('guasto dopo la home chiesta dalla home: il riepilogo non la conta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await app.evaluate(async (_e, g) => {
    globalThis.__fakeX_calls = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__fakeX_calls.push(JSON.parse(JSON.stringify(messages)));
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      if (giro.errore) throw new Error(giro.errore);
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, [
    { toolCalls: [
      { id: 'x1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' },
      { id: 'x2', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"Pasta"}' },
      { id: 'x3', name: 'CAPACITA_DETTAGLIO', arguments: '{"ids":["save-for-later"]}' },
    ] },
    { errore: 'fetch failed' },
    { text: 'Fatto.' },
  ]);
  await page.locator('#input').fill('portami alla home e metti un timer per la pasta');
  await page.locator('#sendBtn').click();
  const retry = page.locator('.dash-action-btn', { hasText: 'Riprova' });
  await expect(retry).toBeVisible({ timeout: 15_000 });
  await retry.click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 15_000 });
  const calls = await app.evaluate(() => globalThis.__fakeX_calls);
  const ultimo = JSON.stringify(calls[calls.length - 1]);
  const pezzo = ultimo.slice(ultimo.indexOf('ERANO GIÀ STATE FATTE'), ultimo.indexOf('ERANO GIÀ STATE FATTE') + 400);
  console.log('RIEPILOGO:', pezzo);
  expect(ultimo).toContain('ERANO GIÀ STATE FATTE');
  expect(pezzo).toContain('timer');
  expect(pezzo).not.toMatch(/home/i);
});
