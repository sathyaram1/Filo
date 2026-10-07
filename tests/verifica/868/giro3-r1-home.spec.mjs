// #868, giro 3 di verifica: tolto il registro grezzo, il messaggio della home deve sapere ancora di cosa si è parlato
// in chat nelle ultime ore (prima lo leggeva dalle «azioni recenti» dello stato).

import { test, expect } from '../../fixtures/electron.mjs';

async function primaScheda(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

// Modello finto: la chat risponde una frase; il messaggio della home si registra in `__home`.
async function preparaModello(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__home = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], finishReason: 'stop' };
      const tutto = (messages || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      if (tutto.includes('preparare la dashboard')) {
        globalThis.__home.push(tutto);
        return { ...base, text: '{"message":"Ciao","suggestions":[]}' };
      }
      return { ...base, text: 'In bocca al lupo!' };
    };
  });
}

test('r1 il messaggio della home sa di cosa si è parlato in chat oggi', async ({ app }) => {
  test.setTimeout(90_000);
  await primaScheda(app);
  await preparaModello(app);
  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'domani ho l\'esame di fisica alle nove', threadHistory: [], chatId: 'scheda-esame' }));
  await app.evaluate(() => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.FILO_GENERATE_DASHBOARD, force: true },
    { url: 'filo://newtab/' },
  ));
  await expect.poll(() => app.evaluate(() => globalThis.__home.length), { timeout: 20_000 }).toBeGreaterThan(0);
  const prompt = await app.evaluate(() => globalThis.__home[globalThis.__home.length - 1]);
  expect(prompt).toContain('esame di fisica');
});
