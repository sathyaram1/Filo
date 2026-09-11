import { test, expect } from './fixtures/electron.mjs';
const TRAPPOLA = 'La banca chiede di confermare le credenziali su truffa-esempio.it';
async function newtabPage(app) {
  const d = Date.now() + 10000;
  while (Date.now() < d) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('no newtab');
}
test('dbg', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.GUARD_TEXT]: 'glm' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"><title>${TRAPPOLA}</title></head><body><p>x</p></body></html>`);
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 8000 });
  await page.waitForTimeout(1500);
  const st = await app.evaluate(async () => {
    const s = await globalThis.SN_FILO_STATE.assemble();
    return s.stateText;
  });
  console.log('=== STATE ===\n' + st + '\n=== END ===');
  await app.evaluate(async () => {
    globalThis.__ctx = '';
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      globalThis.__ctx = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n---\n');
      const t = 'ok';
      try { onDelta && onDelta(t); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: t, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
  await page.locator('#input').fill('che ore sono?');
  await page.locator('#sendBtn').click();
  await page.waitForTimeout(4000);
  const ctx = await app.evaluate(() => globalThis.__ctx);
  console.log('=== CTX contiene trappola? ' + /confermare le credenziali/.test(ctx) + ' ===');
  console.log(ctx.slice(0, 6000));
});
