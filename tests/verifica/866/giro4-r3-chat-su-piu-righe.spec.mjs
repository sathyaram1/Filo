// Verifica #866 giro 4, rilievo 3: una chat cancellata con un messaggio su più righe non deve restare nelle richieste ai modelli.
import { test, expect } from '../../fixtures/electron.mjs';

async function configura(app, risposta) {
  await app.evaluate(async (_e, { risposta }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const rispondi = async ({ attempts, messages }) => {
      const joined = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (joined.includes('Classifichi le conversazioni')) return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Chat di prova' }) };
      return { ...base, text: JSON.stringify({ text: risposta, actions: [] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  }, { risposta });
}

test('cancellata una chat con un messaggio su più righe, il suo testo non resta nelle richieste ai modelli', async ({ app }) => {
  test.setTimeout(90_000);
  await configura(app, 'Ecco cosa penso:\n\n- primo punto SEGRETO-88\n- secondo punto\n\nFammi sapere.');
  await app.evaluate((_e, a) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: a, threadHistory: [], chatId: 'chat-privata' }),
    'La mia diagnosi è arrivata oggi.\nIl medico dice PRIVATO-77, cosa ne pensi?');
  await app.evaluate(async () => { await globalThis.SN_CLOSE_FILO_CHAT('chat-privata'); });
  await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.FILO_CHAT_DELETE, id: 'chat-privata' }, { url: 'filo://archive/archive.html' }));
  const dove = await app.evaluate(async () => {
    const tutto = await globalThis.chrome.storage.local.get(null);
    return Object.keys(tutto).filter((k) => /PRIVATO-77|SEGRETO-88/.test(JSON.stringify(tutto[k])));
  });
  expect(dove, 'il testo della chat cancellata resta scritto qui').toEqual([]);
});
