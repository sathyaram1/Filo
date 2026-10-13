// Verifica #974 giro 2: uno scambio lungo aperto nella home vuota scorre in un riquadro solo, non in due annidati.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

test('r3 scambio lungo aperto nella home vuota: una barra di scorrimento sola', async ({ app, openTab, shell }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EDITOR_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    P.completeWithFallback = async ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const text = sistema.includes('assistente di scrittura dentro un editor') ? `Ecco. ${'parola '.repeat(400)}` : '{"message":"","suggestions":[]}';
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
  const casa = await home(app);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('.ed-switch-icon').nth(1).click();
  const chat = editor.locator('.ed-module[data-type="chat"]');
  await chat.locator('[data-chat="input"]').fill('scrivimi tanto');
  await chat.locator('[data-chat="send"]').click();
  await expect(chat.locator('.ed-chat-msg.assistant', { hasText: 'Ecco.' })).toBeVisible({ timeout: 10_000 });
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => String(x.url || '').startsWith('filo://newtab'));
    if (t) await window.filoShell.tabs.activate(t.id);
  });
  const riga = casa.locator('#righeApp .dash-riga-app');
  await expect(riga).toHaveCount(1, { timeout: 10_000 });
  await riga.locator('.dash-riga-app-testa').click();
  await expect(riga.locator('.dash-riga-app-msg-filo')).toBeVisible();
  const scorrono = await casa.evaluate(() => ['#righeApp', '#righeApp .dash-riga-app-corpo'].filter((s) => {
    const el = document.querySelector(s);
    return el && el.scrollHeight > el.clientHeight + 1;
  }));
  expect(scorrono.length, `riquadri che scorrono uno dentro l'altro: ${scorrono.join(', ')}`).toBeLessThanOrEqual(1);
});
