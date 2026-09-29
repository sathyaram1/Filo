// Verifica #825 giro 4, rilievo 1: l'indice in sottofondo si ferma a un errore del fornitore e non riparte, e non riparte
// nemmeno quando il modello predefinito cambia senza toccare le impostazioni. La prima ricerca fatta intanto lo aspetta.
// Si asserisce lo stato che la prima ricerca presuppone: l'archivio indicizzato col modello in uso, senza cercare niente.

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
      if (globalThis.__embedFail > 0) {
        globalThis.__embedFail--;
        throw Object.assign(new Error('429 troppe richieste'), { status: 429 });
      }
      return { vectors: texts.map(() => [0, 1]) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async () => ({ text: '', provider: 'openrouter', model: 'stub', usage: {} });
  }, predefiniti);
}

const quanteCol = (app, modello) => app.evaluate(async (_e, m) =>
  (await globalThis.SN_ARCHIVED_TABS.list()).filter((t) => t.embedModel === m).length, modello);

test('un errore passeggero del fornitore: l\'indice in sottofondo riprova da solo', async ({ app }) => {
  test.setTimeout(120_000);
  await prepara(app, { predefiniti: false });
  const EM = await app.evaluate(() => globalThis.SN_TEST_MODELS.registry['qwen-embed'].model);
  await app.evaluate(async () => {
    globalThis.__embedFail = 1;
    const voci = [];
    for (let i = 0; i < 300; i++) voci.push({ id: `f${i}`, url: `https://errore-${i}.test/`, title: `Errore ${i}` });
    await globalThis.SN_ARCHIVED_TABS.importa(voci);
  });
  // Nessuna scheda chiusa, nessuna ricerca, nessuna impostazione cambiata: solo il tempo.
  await expect.poll(() => quanteCol(app, EM), { timeout: 60_000, intervals: [2000] }).toBe(300);
});

test('modelli predefiniti: cambiato il modello di indicizzazione, l\'archivio si rifà da solo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await prepara(app, { predefiniti: true });
  const EM = await app.evaluate(async () => {
    const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
    const voci = [];
    for (let i = 0; i < 300; i++) voci.push({ id: `p${i}`, url: `https://predefinito-${i}.test/`, title: `Predefinito ${i}` });
    await globalThis.SN_ARCHIVED_TABS.importa(voci);
    return EM;
  });
  // Controllo: coi modelli predefiniti l'indice in sottofondo funziona.
  await expect.poll(() => quanteCol(app, EM), { timeout: 30_000 }).toBe(300);

  // L'owner cambia il modello predefinito; Filo rilegge la configurazione quando si aprono le Opzioni.
  await app.evaluate(() => {
    const reg = globalThis.SN_TEST_MODELS.registry;
    globalThis.SN_TEST_MODELS.registry = { ...reg, 'qwen-embed': { ...reg['qwen-embed'], model: 'qwen/altro-embed' } };
  });
  const page = await openTab('filo://newtab/');
  await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'default_models_public' }));
  await expect.poll(() => quanteCol(app, 'qwen/altro-embed'), { timeout: 30_000, intervals: [2000] }).toBe(300);
});
