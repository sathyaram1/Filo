// Verifica #1461 giro 8, rilievo 1: la prova «nascondere e rimettere una conversazione dal tasto destro contano
// l'attesa dell'azione» fa il clic destro sulla bolla appena compare, mentre la home la sposta ancora di circa 200 px:
// il clic cade nel vuoto e il menu non si apre. Qui gli stessi passi, ripetuti: rossa finché la prova resta instabile.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const HOME = 'filo://newtab/';

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
        [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await app.evaluate(async () => {
    const rispondi = async ({ attempts, messages }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const tutto = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      if (tutto.includes('Classifichi le conversazioni')) return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Hegel' }) };
      return { ...base, text: 'Va bene, ci penso.', toolCalls: [], finishReason: 'stop' };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  });
}

test('r1 il clic destro sulla bolla appena comparsa apre ogni volta il menu della conversazione', async ({ app, openTab }) => {
  test.setTimeout(240_000);
  await configura(app);
  const riuscite = [];
  for (let i = 0; i < 8; i++) {
    const id = `c-hegel-${i}`;
    await app.evaluate((_e, x) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'Parliamo di Hegel e della dialettica', threadHistory: [], chatId: x }), id);
    await app.evaluate((_e, x) => globalThis.SN_CLOSE_FILO_CHAT(x), id);
    await expect.poll(async () => ((await app.evaluate(() => globalThis.SN_FILO_CHATS.list({ nascoste: true }))).find((c) => c.id === id) || {}).kind || null,
      { timeout: 30_000 }).toBe('conversazione');
    const home = await openTab(HOME);
    const bolla = home.locator(`.dash-bubble[data-chat="${id}"]`).first();
    await expect(bolla).toBeVisible({ timeout: 15_000 });
    await bolla.click({ button: 'right' });
    const ok = await menuDi(home).voce('Nascondi la conversazione').first().waitFor({ timeout: 5_000 }).then(() => true, () => false);
    riuscite.push(ok);
    await home.keyboard.press('Escape').catch(() => {});
    await home.close().catch(() => {});
  }
  expect(riuscite, 'ogni clic destro apre il menu della bolla').toEqual(riuscite.map(() => true));
});
