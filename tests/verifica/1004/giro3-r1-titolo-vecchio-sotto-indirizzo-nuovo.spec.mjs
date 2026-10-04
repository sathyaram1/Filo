// #1004 giro 3, rilievo 1: dalla pagina delicata la scheda va su una pagina di un altro sito senza titolo. Il titolo della
// pagina delicata non deve arrivare al modello del riassunto né alla chat sotto l'indirizzo nuovo.
import { test, expect } from '../../fixtures/electron.mjs';

const TITOLO = 'Movimenti di Mario Rossi - IBAN IT60X0542811101000000123456';

test('il titolo di una pagina delicata non parte sotto l\'indirizzo della pagina successiva', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__mandato = [];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => { globalThis.__mandato.push(texts.join('\n')); return { vectors: texts.map(() => [0.5, 0.2, 0.9, 0.1]) }; };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => { globalThis.__mandato.push(JSON.stringify(messages)); return { text: 'Riassunto finto.', provider: 'openrouter', model: 'stub', usage: {} }; };
  });
  const senzaTitolo = testServer.html('<!doctype html><html><head></head><body><p>Una pagina qualunque senza titolo con un po di testo pubblico.</p></body></html>')
    .replace('127.0.0.1', 'blocked.test');
  const banca = await testServer.openReady(openTab,
    `<!doctype html><html><head><title>${TITOLO}</title></head><body><p>Saldo</p>`
    + `<form><input name="utente"><input type="password" name="pw"></form><a id="via" href="${senzaTitolo}">vai</a></body></html>`,
    { pubblico: true });
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
  await banca.waitForTimeout(800);
  await banca.click('#via');
  await expect.poll(() => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return (s.tabs.find((t) => t.id === s.activeId) || {}).url || '';
  }), { timeout: 8_000 }).toContain('blocked.test');
  await banca.waitForTimeout(1500);
  const snap = await shell.evaluate(async () => { const s = await window.filoShell.tabs.snapshot(); return s.tabs.find((t) => t.id === s.activeId); });
  const stato = await app.evaluate(async () => (await globalThis.SN_FILO_STATE.assemble({ sistema: false })).stateText);
  expect(stato.includes('IT60X'), 'il titolo della pagina delicata è nel contesto della chat').toBe(false);
  const id = snap.id;
  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), id);
  await expect.poll(async () => (await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).length)), { timeout: 8_000 }).toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 2500));
  const partito = await app.evaluate(() => globalThis.__mandato.slice());
  expect(partito.some((t) => t.includes('IT60X')), 'il titolo della pagina delicata è arrivato al modello del riassunto').toBe(false);
});
