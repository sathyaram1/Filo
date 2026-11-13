// Esplorazione del giro 11: dopo il buongiorno di Filo, una lezione automatica in home parte ancora?
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

async function prepara(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'default' } });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
        [C.ACTIONS.FILO_LESSON]: 'deepseek-flash', [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash',
      },
    });
    globalThis.__lezioniChieste = 0;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const tutto = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      if (tutto.includes('preparare la dashboard')) return { ...base, text: JSON.stringify({ message: 'Buongiorno.', suggestions: [] }) };
      if (tutto.includes('analizzare l\'ultima interazione')) {
        globalThis.__lezioniChieste += 1;
        return { ...base, text: 'LEZIONE: L’utente è vegetariano.' };
      }
      return { ...base, text: '{}' };
    };
  });
}

const lezioni = (app) => app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.getLessonsBuffer()).map((l) => l.text));

for (const buongiorno of [false, true]) {
  test(`esplora: lezione automatica in home ${buongiorno ? 'dopo' : 'senza'} il buongiorno`, async ({ app }) => {
    const page = await home(app);
    await modelloFinto(app, [{ text: 'Ne terrò conto.' }]);
    await prepara(app);
    try {
      if (buongiorno) {
        await app.evaluate(() => globalThis.SN_FILO_PARLA.giro({ subito: [{ tipo: 'giornata' }] }));
        await expect(page.locator('.dash-bubble-filo[data-spontaneo="1"]', { hasText: 'Buongiorno.' })).toBeVisible({ timeout: 15000 });
      }
      await chiedi(page, 'sono vegetariano');
      await expect(page.locator('.dash-bubble-filo', { hasText: 'Ne terrò conto.' })).toBeVisible({ timeout: 15000 });
      await expect.poll(() => lezioni(app), { timeout: 10000 }).toEqual(['L’utente è vegetariano.']);
    } finally {
      await ripristina(app);
    }
  });
}
