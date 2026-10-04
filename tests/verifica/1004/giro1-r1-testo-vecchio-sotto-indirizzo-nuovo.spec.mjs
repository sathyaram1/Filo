// #1004 giro 1, rilievo 1: dalla banca la scheda va su un altro sito la cui pagina non ha testo (un'immagine, un PDF,
// una pagina ancora in caricamento) e si chiude. Al riassunto non deve arrivare il testo della banca.

import { test, expect } from '../../fixtures/electron.mjs';

const SEGRETO = 'Saldo disponibile 98.765,43 euro bonifico a Lucia Bianchi';

test('il testo di una pagina delicata non parte sotto l\'indirizzo della pagina successiva', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__mandato = [];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => {
      globalThis.__mandato.push(texts.join('\n'));
      return { vectors: texts.map(() => [0.5, 0.2, 0.9, 0.1]) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      globalThis.__mandato.push(JSON.stringify(messages));
      return { text: 'Riassunto finto.', provider: 'openrouter', model: 'stub', usage: {} };
    };
  });

  // Un altro sito pubblico (blocked.test risponde dal mini server), con una pagina senza testo.
  const vuota = testServer.html('<!doctype html><html><head><title>Immagine</title></head><body></body></html>')
    .replace('127.0.0.1', 'blocked.test');
  const banca = await testServer.openReady(openTab,
    `<!doctype html><html><head><title>Il mio conto</title></head><body><p>${SEGRETO}</p>`
    + `<form><input name="utente"><input type="password" name="pw"></form><a id="via" href="${vuota}">vai</a></body></html>`,
    { pubblico: true });
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
  // Il testo della banca è già stato letto dalla scheda.
  await banca.waitForTimeout(800);

  await banca.click('#via');
  await expect.poll(() => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return (s.tabs.find((t) => t.id === s.activeId) || {}).url || '';
  }), { timeout: 8_000 }).toContain('blocked.test');
  await banca.waitForTimeout(800);

  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), id);

  await expect.poll(async () => (await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).length)), { timeout: 8_000 })
    .toBeGreaterThan(0);
  await banca.waitForTimeout?.(0).catch(() => {});
  await new Promise((r) => setTimeout(r, 2_000));
  const partito = await app.evaluate(() => globalThis.__mandato.slice());
  expect(partito.some((t) => t.includes('Saldo disponibile')), 'il testo della banca è arrivato al modello del riassunto').toBe(false);
});
