// Verifica #1467 giro 1, r3: la home senza un modello che la scriva (la chat invece funziona) si conta col suo motivo.
import { test, expect } from '../../fixtures/electron.mjs';

const home = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const out = {};
  for (const ora of Object.values(s.ore || {})) for (const [c, n] of Object.entries(ora.home || {})) out[c] = (out[c] || 0) + n;
  return out;
});

test('r3 la home col suo modello che non esiste più conta senza_ai_modelli anche se la chat funziona', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'modello-che-non-esiste' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  const ok = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const s = await globalThis.SN_STORAGE.getSettings();
    return { home: C.canServeAction(s, C.ACTIONS.FILO_DASHBOARD), chat: C.canServeAction(s, C.ACTIONS.FILO_CHAT) };
  });
  expect(ok).toEqual({ home: false, chat: true });
  const prima = (await home(app)).senza_ai_modelli || 0;
  await openTab('filo://newtab/?prova=r3');
  await expect.poll(async () => (await home(app)).senza_ai_modelli || 0, { timeout: 8_000 }).toBe(prima + 1);
});
