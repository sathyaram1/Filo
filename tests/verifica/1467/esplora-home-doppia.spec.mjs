import { test, expect } from '../../fixtures/electron.mjs';

test('esplora: quando si conta la home', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(() => {
    globalThis.__conteggiHome = [];
    const M = globalThis.SN_CONTATORI_MAIN;
    const orig = M.attivita.bind(M);
    M.attivita = (m, info, o) => {
      if (m === 'home') globalThis.__conteggiHome.push({ t: Date.now(), esito: info && info.esito });
      return orig(m, info, o);
    };
    globalThis.__t0 = Date.now();
  });
  const urls0 = app.windows().map((w) => w.url());
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'modello-che-non-esiste' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__tSet = Date.now();
  });
  await openTab('filo://newtab/?prova=home-senza-modello');
  await new Promise((r) => setTimeout(r, 3000));
  const r = await app.evaluate(() => ({ t0: globalThis.__t0, tSet: globalThis.__tSet, c: globalThis.__conteggiHome }));
  console.log('URLS0', JSON.stringify(urls0), 'URLS1', JSON.stringify(app.windows().map((w) => w.url())));
  console.log('CONTEGGI', JSON.stringify(r.c.map((x) => ({ dt: x.t - r.t0, esito: x.esito }))), 'tSet', r.tSet - r.t0);
  expect(true).toBe(true);
});
