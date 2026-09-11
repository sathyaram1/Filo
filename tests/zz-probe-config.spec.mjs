import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('probe: guardiano senza modello / stesso modello della chat', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, // guard_text NON impostato
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_WEB_SEARCH.search = async () => ({
      provider: 'finto',
      results: [{ title: 'X', url: 'https://x.it/', snippet: 'roba scritta da altri' }],
    });
    let giro = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      giro++;
      if (giro === 1) {
        return { ...base, text: '', finishReason: 'tool_calls', reasoningDetails: [],
          toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: '{"query":"x"}' }] };
      }
      const t = 'Ecco cosa ho trovato sul portale.';
      try { onDelta && onDelta(t); } catch (_) {}
      return { ...base, text: t, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });

  await page.locator('#input').fill('cerca il portale');
  await page.locator('#sendBtn').click();
  await page.waitForTimeout(6000);
  const bolle = await page.locator('.dash-bubble-filo').allTextContents();
  console.log('BOLLE (guard_text assente):', JSON.stringify(bolle));
  const coda = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listPendingNotifications());
  console.log('CODA:', coda.length, JSON.stringify(coda.map((c) => c.ultimoMotivo)));
  expect(true).toBe(true);
});
