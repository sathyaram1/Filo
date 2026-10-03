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

test('esplora: chat con messaggi su più righe, cancellata, resta altrove?', async ({ app }) => {
  test.setTimeout(90_000);
  await configura(app, 'Ecco cosa penso della tua situazione:\n\n- primo punto SEGRETO-88 importante\n- secondo punto\n\nFammi sapere.');
  await app.evaluate((_e, a) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: a, threadHistory: [], chatId: 'chat-privata' }),
    'La mia diagnosi è arrivata oggi.\nIl medico dice PRIVATO-77, cosa ne pensi?');
  await app.evaluate(async () => { await globalThis.SN_CLOSE_FILO_CHAT('chat-privata'); });
  const salvata = await app.evaluate(async () => (await globalThis.SN_FILO_CHATS.get('chat-privata'))?.messages);
  console.log('SALVATA', JSON.stringify(salvata));
  await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.FILO_CHAT_DELETE, id: 'chat-privata' }, { url: 'filo://archive/archive.html' }));
  const dove = await app.evaluate(async () => {
    const tutto = await globalThis.chrome.storage.local.get(null);
    const out = {};
    for (const k of Object.keys(tutto)) {
      const s = JSON.stringify(tutto[k]);
      for (const t of ['PRIVATO-77', 'SEGRETO-88']) {
        let i = s.indexOf(t);
        if (i >= 0) out[k + ':' + t] = s.slice(Math.max(0, i - 200), i + 60);
      }
    }
    return out;
  });
  console.log('DOVE', JSON.stringify(dove, null, 1));
  expect(Object.keys(dove)).toEqual([]);
});
