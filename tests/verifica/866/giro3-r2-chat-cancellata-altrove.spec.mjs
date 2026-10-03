// Verifica #866 giro 3, rilievo 2 — una chat cancellata dalla Cronologia non resta scritta altrove su disco:
// né nel registro grezzo, né nella cronologia delle richieste ai modelli, né nella cache delle risposte.
import { test, expect } from '../../fixtures/electron.mjs';

test('cancellata la chat, il suo testo non resta in nessun archivio di Filo', async ({ app }) => {
  test.setTimeout(90_000);
  const dove = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const r = async ({ attempts }) => ({ model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: JSON.stringify({ text: 'Capito, PRIVATO-RISP.', actions: [] }) });
    globalThis.SN_PROVIDERS.completeWithFallback = r;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = r;
    await globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'La mia diagnosi PRIVATO-77', threadHistory: [], chatId: 'c-priv' });
    await globalThis.SN_CLOSE_FILO_CHAT('c-priv');
    await globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.FILO_CHAT_DELETE, id: 'c-priv' }, { url: 'filo://archive/archive.html' });
    const all = await globalThis.chrome.storage.local.get(null);
    const resta = await globalThis.SN_FILO_CHATS.get('c-priv');
    if (resta) return ['chat non cancellata'];
    return Object.keys(all).filter((k) => /PRIVATO-(77|RISP)/.test(JSON.stringify(all[k])));
  });
  expect(dove).toEqual([]);
});
