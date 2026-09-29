// Verifica #825 giro 4 (esplorazione): schede senza il vettore del modello in uso che l'indice in sottofondo non riprende.

import { test, expect } from '../../fixtures/electron.mjs';

async function prepara(app, { predefiniti }) {
  await app.evaluate(async (_e, predef) => {
    await globalThis.SN_STORAGE.updateSettings(predef
      ? { useDefaultModels: true, apiKeys: { openrouter: 'test-key', tavily: '' } }
      : {
        useDefaultModels: false,
        apiKeys: { openrouter: 'test-key', tavily: '' },
        models: { ...globalThis.SN_TEST_MODELS.models },
        modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
      });
    globalThis.__embedCalls = [];
    globalThis.__embedFail = 0;
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => {
      globalThis.__embedCalls.push(texts.length);
      if (globalThis.__embedFail > 0) { globalThis.__embedFail--; throw Object.assign(new Error('429 troppe richieste'), { status: 429 }); }
      return { vectors: texts.map(() => [0, 1]) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async () => ({ text: '', provider: 'openrouter', model: 'stub', usage: {} });
  }, predefiniti);
}

test('modelli predefiniti: l\'owner cambia il modello di indicizzazione, l\'archivio si rifà da solo', async ({ app }) => {
  test.setTimeout(60_000);
  await prepara(app, { predefiniti: true });
  const EM = await app.evaluate(async () => {
    const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
    const voci = [];
    for (let i = 0; i < 300; i++) voci.push({ id: `p${i}`, url: `https://pred-${i}.test/`, title: `Pred ${i}`, embedding: [0, 127], embedModel: EM });
    await globalThis.SN_ARCHIVED_TABS.importa(voci);
    return EM;
  });
  // Il controllo: con quel modello non c'è niente da rifare.
  await new Promise((ok) => setTimeout(ok, 4000));
  const primaDelCambio = await app.evaluate(() => globalThis.__embedCalls.length);
  // Cambio dei modelli predefiniti (quello che arriva dal documento dell'owner): le impostazioni dell'utente non cambiano.
  await app.evaluate(() => {
    const reg = globalThis.SN_TEST_MODELS.registry;
    globalThis.SN_TEST_MODELS.registry = { ...reg, 'qwen-embed': { ...reg['qwen-embed'], model: 'qwen/altro-embed' } };
  });
  let rifatte = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 20_000) {
    rifatte = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).filter((t) => t.embedModel === 'qwen/altro-embed').length);
    if (rifatte === 300) break;
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  console.log('[giro4] predefiniti: EM', EM, 'chiamate prima del cambio', primaDelCambio, 'rifatte dopo 20s', rifatte);
  expect(rifatte).toBe(300);
});

test('un errore passeggero dell\'indicizzazione: l\'indice riprova da solo', async ({ app }) => {
  test.setTimeout(60_000);
  await prepara(app, { predefiniti: false });
  await app.evaluate(async () => {
    globalThis.__embedFail = 1;
    const voci = [];
    for (let i = 0; i < 300; i++) voci.push({ id: `f${i}`, url: `https://fail-${i}.test/`, title: `Fail ${i}` });
    await globalThis.SN_ARCHIVED_TABS.importa(voci);
  });
  let mancanti = 300;
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    mancanti = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).filter((t) => !t.embedModel).length);
    if (mancanti === 0) break;
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  const chiamate = await app.evaluate(() => globalThis.__embedCalls);
  console.log('[giro4] errore passeggero: mancanti dopo 30s', mancanti, 'chiamate', JSON.stringify(chiamate));
  expect(mancanti).toBe(0);
});
