// #870 giro 2, rilievo 2: le istruzioni generali di Filo non devono dire che le carte di sinistra non passano dallo
// strumento delle carte, che invece le sposta e le toglie: due indicazioni opposte sulla stessa richiesta.
import { test, expect } from '../../fixtures/electron.mjs';
import { homeTab } from './_comune.mjs';

async function modelloSpia(app, risposte) {
  await app.evaluate(async (_e, risp) => {
    const C = globalThis.SN_CONST;
    await chrome.storage.local.set({ filo_onboarding: { done: true } });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__giro = 0;
    globalThis.__visti = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      globalThis.__visti.push(JSON.stringify(messages));
      const r = risp[Math.min(globalThis.__giro++, risp.length - 1)];
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (r.testo) { try { onDelta && onDelta(r.testo); } catch (_) {} }
      return { ...base, text: r.testo || '', toolCalls: r.strumenti || [], finishReason: r.strumenti ? 'tool_calls' : 'stop' };
    };
  }, risposte);
}

test('le istruzioni generali non escludono le carte di sinistra dallo strumento delle carte', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await homeTab(app);
  await modelloSpia(app, [{ testo: 'Ok.' }]);
  await page.locator('#input').fill('metti il timer della pasta in cima');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ok' })).toBeVisible({ timeout: 10_000 });
  const visti = await app.evaluate(() => globalThis.__visti);
  expect(visti[0]).toContain('CARTA_HOME');
  expect(visti[0], 'le istruzioni dicono che le carte di sinistra non passano da CARTA_HOME').not.toMatch(/Riguarda le carte di destra|si tolgono togliendo la cosa/);
});
