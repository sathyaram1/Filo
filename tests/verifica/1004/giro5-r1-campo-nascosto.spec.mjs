// #1004 giro 5 — rilievo 1: un campo password mai mostrato non rende delicato un sito.
import { test, expect } from '../../fixtures/electron.mjs';

async function modelliFinti(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__mandato = [];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => {
      globalThis.__mandato.push({ tipo: 'indice', testo: texts.join('\n') });
      return { vectors: texts.map(() => [0.5, 0.2, 0.9, 0.1]) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      const testo = JSON.stringify(messages);
      globalThis.__mandato.push({ tipo: /Riassumi in italiano/.test(testo) ? 'riassunto' : 'altro', testo });
      return { text: 'Riassunto finto della pagina.', provider: 'openrouter', model: 'stub', usage: {} };
    };
  });
}

test('un modulo di accesso nascosto, mai mostrato, non rende delicato il sito', async ({ app, shell, openTab, testServer }) => {
  await modelliFinti(app);
  await testServer.openReady(openTab,
    '<!doctype html><html><head><title>Ricetta del pane</title></head><body><p>Farina, acqua e lievito madre per il pane.</p>'
    + '<div id="login" style="display:none"><form><input name="u"><input type="password" name="p"></form></div></body></html>',
    { pubblico: true });
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await new Promise((r) => setTimeout(r, 3000));
  const campi = await app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test'));
  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), id);
  await new Promise((r) => setTimeout(r, 3000));
  const voce = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).find((x) => x.title === 'Ricetta del pane'));

  expect(campi).toBe(false);
  expect(voce && voce.delicata).toBeFalsy();
});

