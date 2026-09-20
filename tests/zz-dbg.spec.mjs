import { test, expect } from '/home/user/Filo/tests/fixtures/electron.mjs';

test('dbg', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const joined = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (joined.includes('Classifichi le conversazioni')) return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'T' }) };
      return { ...base, text: JSON.stringify({ text: 'Va bene, ci penso.', actions: [] }) };
    };
  });
  await app.evaluate((_e, id) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'Ciao come va', threadHistory: [], chatId: id }), 'cx');
  await app.evaluate((_e, id) => globalThis.SN_CLOSE_FILO_CHAT(id), 'cx');
  const dash = await openTab('filo://dashboard/dashboard.html?chat=cx');
  dash.on('console', (m) => console.log('[REND]', m.text()));
  await expect(dash.locator('.dash-bubble')).toHaveCount(2);
  await dash.locator('#input').fill('E poi?');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble')).toHaveCount(4);
  await new Promise((r) => setTimeout(r, 1500));
  console.log('BOLLE', JSON.stringify(await dash.locator('.dash-bubble').allTextContents()));
  const chats = await app.evaluate(() => globalThis.SN_FILO_CHATS.list());
  console.log('DBG', JSON.stringify(chats.map((c) => ({ id: c.id, n: c.messages.length, m: c.messages.map((x) => `${x.role}:${x.text.slice(0, 20)}`) })), null, 1));
});
