// Verifica #1823 giro 1: un link salvato per dopo DA una pagina delicata (il collegamento in una mail) porta al modello
// delle categorie il testo del link e il suo indirizzo, che la pagina delicata ha mostrato. Conta la pagina da cui viene.
import { test, expect } from '../../fixtures/electron.mjs';

const DA_PREFERENZE = { tab: { id: 5, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' };

test('r1 il link salvato da una pagina delicata non manda al modello delle categorie testo e indirizzo del link', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async ({}, da) => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    await globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { featureFlags: { categorize: true }, security: { pagineDelicate: { siti: ['sito-pubblico.test'] } } } }, da);
    globalThis.__cat = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      const testo = JSON.stringify(messages);
      if (testo.includes('Categorizza')) globalThis.__cat.push(testo);
      return { text: '{"category":"Varie","confidence":0.9,"isNew":true}', provider: 'openrouter', model: 'stub', usage: {} };
    };
  }, DA_PREFERENZE);
  const LINK = 'https://esempio.org/reimposta-password?token=SEGRETO123';
  const TESTO = 'Conferma il bonifico di 3.000 euro a Mario Rossi';
  await testServer.openReady(openTab,
    `<!doctype html><html><head><title>Posta</title></head><body><a id="l" href="${LINK}">${TESTO}</a></body></html>`,
    { pubblico: true });
  // Il messaggio che manda «Salva link per dopo» dal tasto destro, dal mondo dei content script della scheda.
  await app.evaluate(async ({ BrowserWindow }, { link, testo }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    const tab = tm.tabs.find((t) => t.title === 'Posta');
    const code = `chrome.runtime.sendMessage({ type: 'save_link', url: ${JSON.stringify(link)}, title: ${JSON.stringify(testo)} })`;
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }], true);
  }, { link: LINK, testo: TESTO });
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).length), { timeout: 8000 }).toBe(1);
  await new Promise((r) => setTimeout(r, 2500));
  const partite = await app.evaluate(() => globalThis.__cat.slice());
  for (const t of partite) {
    expect(t).not.toContain('SEGRETO123');
    expect(t).not.toContain('Mario Rossi');
  }
});
