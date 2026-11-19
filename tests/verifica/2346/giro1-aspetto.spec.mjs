// Verifica #2346 giro 1: la citazione nel campo e nella bolla, prima e dopo, chiaro e scuro (foto per il confronto).

import { test, expect } from '../../fixtures/electron.mjs';

test('aspetto della citazione nel campo e nella bolla', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const testi = ['Il blu con testo bianco è il default del sistema, non una scelta ragionata del browser. Viene dai vecchi terminali, dove la selezione era un\'inversione dei colori.', 'Va bene.'];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = !!messages[0] && messages[0].role === 'system' && String(messages[0].content || '').startsWith(globalThis.SN_CONST.PROMPTS.filoChatStatic());
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      const t = testi.shift() || 'ok';
      try { onDelta && onDelta(t); } catch (_) {}
      return { ...base, text: t, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
  const home = await openTab('filo://newtab/');
  const input = home.locator('#input');
  await expect(input).toBeEditable({ timeout: 15_000 });
  await input.fill('perché il blu?');
  await input.press('Enter');
  const risposta = home.locator('#bubbles > .dash-bubble-filo', { hasText: 'vecchi terminali' });
  await expect(risposta).toHaveAttribute('data-key', /^m:/, { timeout: 20_000 });
  await risposta.hover();
  await risposta.getByRole('button', { name: 'Rispondi' }).click();
  await expect(home.locator('#citazione')).toBeVisible();
  await home.mouse.move(5, 5);
  await home.screenshot({ path: 'tests/.shots/v2346-aspetto-campo-chiaro.png' });
  await input.fill('e il rosa?');
  await input.press('Enter');
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Va bene.' })).toBeVisible({ timeout: 20_000 });
  await home.mouse.move(5, 5);
  await home.screenshot({ path: 'tests/.shots/v2346-aspetto-bolla-chiaro.png' });
  await home.evaluate(() => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }));
  await expect(home.locator('html')).toHaveAttribute('data-sn-theme', 'dark');
  await home.screenshot({ path: 'tests/.shots/v2346-aspetto-bolla-scuro.png' });
  await risposta.hover();
  await risposta.getByRole('button', { name: 'Rispondi' }).click();
  await home.mouse.move(5, 5);
  await home.screenshot({ path: 'tests/.shots/v2346-aspetto-campo-scuro.png' });
});
