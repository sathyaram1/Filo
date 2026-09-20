import { test, expect } from '../../fixtures/electron.mjs';
const ARCHIVE = 'filo://archive/archive.html';
async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}
async function stubProvider(app, triage) {
  await app.evaluate(async (_e, { triage }) => {
    globalThis.__filoTriage = triage;
    const rispondi = async ({ attempts, messages }) => {
      const joined = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (joined.includes('Classifichi le conversazioni')) {
        for (const [ago, risposta] of Object.entries(globalThis.__filoTriage || {})) if (joined.includes(ago)) return { ...base, text: JSON.stringify(risposta) };
        return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Senza etichetta' }) };
      }
      return { ...base, text: JSON.stringify({ text: 'Va bene, ci penso.', actions: [] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  }, { triage });
}
const turno = (app, chatId, userMessage) => app.evaluate((_e, { chatId, userMessage }) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage, threadHistory: [], chatId }), { chatId, userMessage });
const chiudi = (app, id) => app.evaluate((_e, i) => globalThis.SN_CLOSE_FILO_CHAT(i), id);

test('debug comandi', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await configura(app);
  await stubProvider(app, { zabaione: { tipo: 'comando', titolo: 'Sveglia zabaione' }, coscienza: { tipo: 'conversazione', titolo: 'La coscienza' } });
  await turno(app, 'c-cmd', 'Metti una sveglia per lo zabaione');
  await chiudi(app, 'c-cmd');
  await turno(app, 'c-talk', 'Secondo te la coscienza è emergente?');
  await chiudi(app, 'c-talk');
  const store = await app.evaluate(() => globalThis.SN_FILO_CHATS.list());
  console.log('STORE:', JSON.stringify(store.map((c) => ({ id: c.id, t: c.title, k: c.kind, n: c.messages.length, closed: !!c.closedAt }))));
  const page = await openTab(ARCHIVE);
  await page.waitForTimeout(2000);
  console.log('SECTION hidden:', await page.evaluate(() => document.getElementById('chatsSection').hidden));
  console.log('rows:', await page.locator('.arc-chat').count());
  console.log('empty:', await page.locator('#chatEmpty').textContent());
  console.log('toggle:', await page.locator('#showCommandsText').textContent(), 'hidden:', await page.evaluate(() => document.getElementById('showCommandsLabel').hidden));
  await page.locator('#search').fill('zabaione');
  await page.waitForTimeout(1500);
  console.log('AFTER SEARCH rows:', await page.locator('.arc-chat').count());
  console.log('AFTER SEARCH empty:', await page.evaluate(() => ({ hidden: document.getElementById('chatEmpty').hidden, t: document.getElementById('chatEmpty').textContent })));
  console.log('AFTER SEARCH toggle:', await page.locator('#showCommandsText').textContent(), 'hidden:', await page.evaluate(() => document.getElementById('showCommandsLabel').hidden));
  console.log('count label:', await page.locator('#chatsCount').textContent());
});
