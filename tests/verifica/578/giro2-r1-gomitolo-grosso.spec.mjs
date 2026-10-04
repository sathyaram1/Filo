// Verifica #578, giro 2, rilievo 1: dopo un lavoro lungo il gomitolo arriva a toccare il riassunto accanto.
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

test('un gomitolo grosso lascia aria fra sé e il riassunto, come uno piccolo', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const M = globalThis.SN_FILO_MEMORY;
    await M.setOnboarding(globalThis.SN_ONBOARDING.close(await M.getOnboarding()));
  });
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    let n = 0;
    P.streamCompleteWithFallback = async ({ attempts, onReasoning, onDelta, onToolCall }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const i = n++;
      if (onReasoning) onReasoning(`Passo ${i} del lavoro lungo. `);
      await new Promise((r) => setTimeout(r, 120));
      if (i < 10) {
        const s = { id: `l${i}`, name: 'TIMER', arguments: `{"secondi":${100 + i},"etichetta":"T${i}"}` };
        if (onToolCall) onToolCall({ id: s.id, name: s.name });
        return { ...base, text: '', toolCalls: [s], finishReason: 'tool_calls' };
      }
      if (onDelta) onDelta('Dieci timer.');
      return { ...base, text: 'Dieci timer.', toolCalls: [], finishReason: 'stop' };
    };
  });
  await page.locator('#input').fill('dieci timer');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Dieci timer.' })).toBeVisible({ timeout: 20_000 });
  const blocco = page.locator('.dash-activity');
  await expect(blocco).toHaveAttribute('data-filo', 'gomitolo');
  await page.waitForTimeout(500);
  const aria = await blocco.evaluate((b) => {
    const filo = b.querySelector('.dash-activity-filo-tratto').getBoundingClientRect();
    const testo = b.querySelector('.dash-activity-label').getBoundingClientRect();
    return testo.left - filo.right;
  });
  await page.screenshot({ path: 'tests/.shots/v578g2-r1-gomitolo-grosso.png' });
  expect(aria).toBeGreaterThanOrEqual(5);
});
