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

test('diagnostica del simulatore', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const logs = [];
  try { app.process().stdout.on('data', (d) => logs.push('[out] ' + d)); } catch (_) {}
  try { app.process().stderr.on('data', (d) => logs.push('[err] ' + d)); } catch (_) {}
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await app.evaluate(async () => {
    globalThis.__d = { calls: 0, errs: [], keys: [] };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (opts) => {
      try {
        globalThis.__d.calls++;
        globalThis.__d.keys.push(Object.keys(opts));
        const { attempts, onToolCall, onDelta } = opts;
        if (globalThis.__d.calls === 1) {
          try { onToolCall && onToolCall({ id: 'c1', name: 'TIMER' }); } catch (e) { globalThis.__d.errs.push('onToolCall:' + e.message); }
          return { text: '', toolCalls: [{ id: 'c1', name: 'TIMER', arguments: '{"secondi":600,"etichetta":"pasta"}' }], reasoningDetails: [], finishReason: 'tool_calls', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
        }
        try { onDelta && onDelta('FINE-DIAG'); } catch (e) { globalThis.__d.errs.push('onDelta:' + e.message); }
        return { text: 'FINE-DIAG', toolCalls: [], reasoningDetails: [], finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      } catch (e) { globalThis.__d.errs.push('stub:' + (e && e.stack || e)); throw e; }
    };
  });
  await page.locator('#input').fill('timer pasta 10 minuti');
  await page.locator('#sendBtn').click();
  await page.waitForTimeout(6000);
  const d = await app.evaluate(() => globalThis.__d);
  const hist = await app.evaluate(async () => (await globalThis.SN_HISTORY.list()).map((h) => ({ action: h.action, output: (h.output || '').slice(0, 300), model: h.model, timing: h.timing })));
  const dom = await page.evaluate(() => Array.from(document.querySelectorAll('.dash-bubble-filo')).map((b) => b.outerHTML.slice(0, 800)));
  console.log('DIAG', JSON.stringify({ d, hist, dom }, null, 1));
  console.log('LOGS', logs.join('').slice(-4000));
});
