// Verifica #2096 giro 1, rilievo 2: «Modifica» sotto il proprio messaggio, premuto due volte, raddoppia il testo nel
// campo invece di rimetterlo una volta sola. Il modello è finto.
import { test, expect } from '../../fixtures/electron.mjs';

async function preparaModello(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = !!messages[0] && messages[0].role === 'system' && String(messages[0].content || '').startsWith(globalThis.SN_CONST.PROMPTS.filoChatStatic());
      const text = chat ? 'Risposta.' : '{}';
      try { if (chat && onDelta) onDelta(text); } catch (_) {}
      return { ...base, text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
}

test('r2 Modifica premuto due volte non raddoppia il testo nel campo', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await preparaModello(app);
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await home.locator('#input').fill('ciao Filo');
  await home.locator('#input').press('Enter');
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Risposta.' })).toBeVisible({ timeout: 20_000 });
  const mia = home.locator('#bubbles > .dash-bubble-user', { hasText: 'ciao Filo' });
  for (let k = 0; k < 2; k += 1) {
    await mia.hover();
    await mia.locator('.dash-msg-azioni').getByRole('button', { name: 'Modifica' }).click();
  }
  await expect(home.locator('#input')).toHaveValue('ciao Filo');
});
