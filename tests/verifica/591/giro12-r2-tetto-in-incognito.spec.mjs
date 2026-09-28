// Verifica #591, giro 12 — dentro una finestra in incognito il limite di spesa del mese non esiste.
// Lì lo storage risponde «non c'è niente» a tutto ciò che non è configurazione, conto del mese compreso: il cancello
// legge zero speso e lascia passare, e quello che si spende lì sparisce alla chiusura della finestra.
// I messaggi di una finestra incognito il main li esegue dentro runIncognito: qui si fa lo stesso, col fornitore finto.

import { test, expect } from '../../fixtures/electron.mjs';

async function prepara(app) {
  await app.evaluate(async () => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...T.models },
      modelRegistry: T.registry,
      monthlyLimitEur: 5,
    });
    const P = globalThis.SN_PROVIDERS;
    const OR = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.__giro12 = { chiamate: [] };
    const finto = async ({ attempts, messages, onDelta }) => {
      const testo = JSON.stringify(messages || []);
      globalThis.__giro12.chiamate.push(testo.includes('Forbidden') ? 'geo' : 'chat');
      if (onDelta) onDelta('ok');
      return { text: testo.includes('Forbidden') ? 'geo_block' : 'ok', provider: attempts[0].provider, model: attempts[0].model, servedBy: 'DeepInfra', usage: { promptTokens: 100, completionTokens: 5, costUsd: 2 } };
    };
    P.completeWithFallback = finto;
    P.streamCompleteWithFallback = finto;
    OR.synthesizeSpeech = async () => {
      globalThis.__giro12.chiamate.push('voce');
      return { audioBase64: 'AAAA', mimeType: 'audio/pcm;rate=24000', generationId: null, usage: { costUsd: 2 } };
    };
  });
}

test('col mese esaurito, in incognito chat e lettura ad alta voce non chiamano il fornitore', async ({ app }) => {
  await prepara(app);
  const esito = await app.evaluate(async () => {
    const Storage = globalThis.__filoStorage;
    const { ACTIONS } = globalThis.SN_CONST;
    const H = globalThis.__filoHandlers;
    await globalThis.SN_COSTS.record({ action: 'filo_chat', provider: 'openrouter', model: 'x', usage: { costUsd: 50 }, usdToEur: 1 });
    const chat = () => H.handleStream({
      action: ACTIONS.EXPLAIN, payload: { messages: [{ role: 'user', content: 'ciao' }] }, origin: 'test', onDelta: () => {},
    }).then(() => 'partita', (e) => e.code || e.message);
    const voce = () => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.TTS_SYNTH, text: 'Buongiorno', lang: 'it' }, {})
      .then((r) => (r && r.ok ? 'partita' : 'fermata'));

    const normale = { chat: await chat(), voce: await voce(), chiamate: globalThis.__giro12.chiamate.length };
    const incognito = await Storage.runIncognito(async () => ({ chat: await chat(), voce: await voce() }));
    Storage.resetIncognito();
    return { normale, incognito, chiamate: globalThis.__giro12.chiamate.slice() };
  });
  // Riscontro: nella finestra normale il limite ferma tutto.
  expect(esito.normale.chat).toBe('LIMIT_REACHED');
  expect(esito.normale.voce).toBe('fermata');
  expect(esito.normale.chiamate).toBe(0);
  // In incognito lo stesso mese esaurito deve fermare le stesse chiamate.
  expect(esito.incognito, 'col mese esaurito, in incognito la chat e la voce devono fermarsi come fuori')
    .toEqual({ chat: 'LIMIT_REACHED', voce: 'fermata' });
  expect(esito.chiamate, 'nessuna chiamata deve arrivare al fornitore').toEqual([]);
});

test('quello che si spende in incognito resta nel conto del mese dopo la chiusura della finestra', async ({ app }) => {
  await prepara(app);
  const esito = await app.evaluate(async () => {
    const Storage = globalThis.__filoStorage;
    const { ACTIONS } = globalThis.SN_CONST;
    const H = globalThis.__filoHandlers;
    const prima = (await globalThis.SN_COSTS.getMonthly()).totalEur;
    await Storage.runIncognito(async () => {
      await H.handleStream({ action: ACTIONS.EXPLAIN, payload: { messages: [{ role: 'user', content: 'ciao' }] }, origin: 'test', onDelta: () => {} });
    });
    Storage.resetIncognito();
    const dopo = (await globalThis.SN_COSTS.getMonthly()).totalEur;
    return { prima, dopo, chiamate: globalThis.__giro12.chiamate.length };
  });
  expect(esito.chiamate, 'la chiamata in incognito è partita').toBe(1);
  expect(esito.dopo - esito.prima, 'la chiamata pagata in incognito deve comparire nel conto del mese').toBeGreaterThan(1);
});
