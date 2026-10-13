// Verifica #974 giro 2: chiusa la conversazione della home con /home, la riga nata dentro di lei non resta nella home
// vuota (dopo un ricaricamento non c'è: le due viste devono dire la stessa cosa).
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';

async function editorFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EDITOR_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const text = sistema.includes('assistente di scrittura dentro un editor') ? 'Il capitolo va accorciato.' : '{"message":"","suggestions":[]}';
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async (o) => risposta(o);
  });
}

test('r2 dopo /home la riga della conversazione appena chiusa non resta nella home vuota', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const casa = await home(app);
  await modelloFinto(app, [{ text: 'Ciao, dimmi.' }]);
  await chiedi(casa, 'ciao Filo');
  await expect(casa.locator('.dash-bubble-filo', { hasText: 'Ciao, dimmi.' })).toBeVisible({ timeout: 15_000 });
  await editorFinto(app);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('.ed-switch-icon').nth(1).click();
  const chat = editor.locator('.ed-module[data-type="chat"]');
  await chat.locator('[data-chat="input"]').fill('E il capitolo?');
  await chat.locator('[data-chat="send"]').click();
  await expect(chat.locator('.ed-chat-msg.assistant', { hasText: 'accorciato' })).toBeVisible({ timeout: 10_000 });
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => String(x.url || '').startsWith('filo://newtab'));
    if (t) await window.filoShell.tabs.activate(t.id);
  });
  await expect(casa.locator('#bubbles .dash-riga-app')).toHaveCount(1, { timeout: 10_000 });
  await casa.locator('#input').fill('/home');
  await casa.locator('#input').press('Enter');
  await casa.waitForTimeout(1500);
  const subito = await casa.locator('#righeApp .dash-riga-app').count();
  await casa.reload();
  await expect(casa.locator('#input')).toBeVisible();
  await casa.waitForTimeout(1500);
  const ricaricata = await casa.locator('#righeApp .dash-riga-app').count();
  expect(subito, 'la home vuota dice la stessa cosa prima e dopo un ricaricamento').toBe(ricaricata);
});
