// #948 giro 3, rilievo 1: nella home la casella della chat non deve passare a due righe alla prima lettera,
// né restare alta dopo l'invio.
import { test, expect } from '../../fixtures/electron.mjs';

test('home: una parola corta lascia la casella su una riga, e dopo l\'invio torna com\'era', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      try { onDelta && onDelta('Ok.'); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: 'Ok.', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
  const deadline = Date.now() + 10_000;
  let page = null;
  while (!page && Date.now() < deadline) {
    page = app.windows().find((w) => w.url().startsWith('filo://newtab') && !w.url().includes('incognito'));
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  await page.waitForLoadState('domcontentloaded');
  const input = page.locator('#input');
  await expect(input).toBeVisible();
  const vuota = await input.evaluate((i) => i.offsetHeight);
  await input.click();
  await page.keyboard.type('ciao');
  expect(await input.evaluate((i) => i.offsetHeight)).toBe(vuota);
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-bubble-user', { hasText: 'ciao' })).toBeVisible({ timeout: 8_000 });
  await expect(input).toHaveValue('');
  expect(await input.evaluate((i) => i.offsetHeight)).toBe(vuota);
});
