// Verifica #1823 giro 3: le porte dei giri passati ri-provate dalla scheda vera, e le strade vicine (Ctrl+clic,
// finestrella aperta da script) che portano un file da un altro dominio fuori dalla banca.

import { test, expect } from '../../fixtures/electron.mjs';

const SEGRETO = 'Saldo disponibile 12.345,67 euro bonifico a Mario Rossi';
const DALLE_PREFERENZE = { tab: { id: 5, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' };
const impostaDaFilo = (app, settings) => app.evaluate(async ({}, { s, da }) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: s }, da), { s: settings, da: DALLE_PREFERENZE });

async function modelliFinti(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__mandato = [];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [0.5, 0.2, 0.9, 0.1]) });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      globalThis.__mandato.push({ testo: JSON.stringify(messages) });
      return { text: '{"category":"Varie","isNew":true,"confidence":0.9}', provider: 'openrouter', model: 'stub', usage: {} };
    };
  });
}
const mandato = (app) => app.evaluate(() => globalThis.__mandato.slice());

test('link salvato per dopo da dentro una pagina delicata, dal content script della scheda: al modello solo il tipo', async ({ app, openTab, testServer }) => {
  await modelliFinti(app);
  await impostaDaFilo(app, { featureFlags: { categorize: true }, security: { pagineDelicate: { siti: ['sito-pubblico.test'] } } });
  await testServer.openReady(openTab, '<!doctype html><title>La mia posta</title><body><a id="l" href="https://it.wikipedia.org/wiki/Gatto?token=SEGRETO123">Conferma il bonifico di 3.000 euro a Mario Rossi</a></body>', { pubblico: true });
  const ok = await app.evaluate(async ({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    const tab = tm.tabs.find((t) => t.title === 'La mia posta');
    const code = `chrome.runtime.sendMessage({ type: 'save_link', url: document.getElementById('l').href, title: document.getElementById('l').textContent })`;
    const r = await tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }], true);
    return Boolean(r && r.ok);
  });
  expect(ok).toBe(true);
  await expect.poll(async () => (await mandato(app)).filter((m) => m.testo.includes('Categorizza')).length, { timeout: 10000 }).toBe(1);
  const [c] = (await mandato(app)).filter((m) => m.testo.includes('Categorizza'));
  for (const s of ['SEGRETO123', 'wikipedia', 'Mario Rossi', '3.000']) expect(c.testo).not.toContain(s);
});

async function servitoreFile() {
  const { createServer } = await import('node:http');
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(SEGRETO), 'Content-Disposition': 'attachment; filename="documento.txt"' });
    res.end(SEGRETO);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://cdn-documenti.test:${srv.address().port}/documento.txt`, chiudi: async () => { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

async function finito(shell, url) {
  let rec = null;
  await expect.poll(async () => {
    const r = await shell.evaluate(() => window.filoShell.downloads.list());
    rec = ((r && r.items) || []).find((it) => it.url === url) || null;
    return rec ? rec.state : null;
  }, { timeout: 20000 }).toBe('completed');
  return rec;
}

test.describe('file della banca su un altro dominio', () => {
  test.use({ hostInPiu: ['cdn-documenti.test'] });

  for (const [nome, corpo, gesto] of [
    ['Ctrl+clic sul link', (u) => `<a id="dl" href="${u}">Estratto conto</a>`, (p) => p.locator('#dl').click({ modifiers: ['Control'] })],
    ['finestrella aperta da script', (u) => `<button id="dl" onclick="window.open('${u}', 'doc', 'width=600,height=500')">Estratto conto</button>`, (p) => p.locator('#dl').click()],
    ['finestra vuota riempita dalla pagina', (u) => `<button id="dl" onclick="const w = window.open('about:blank'); w.location.href = '${u}'">Estratto conto</button>`, (p) => p.locator('#dl').click()],
  ]) {
    test(`${nome}: il file non va al modello dei nomi`, async ({ app, shell, openTab, testServer }) => {
      test.setTimeout(90_000);
      await modelliFinti(app);
      await impostaDaFilo(app, { nomiSensati: { scaricamenti: true }, security: { pagineDelicate: { siti: ['sito-pubblico.test'] } } });
      const s = await servitoreFile();
      try {
        const page = await testServer.openReady(openTab, `<!doctype html><title>La mia banca</title><body style="padding:40px">${corpo(s.url)}</body>`, { pubblico: true });
        await gesto(page);
        const rec = await finito(shell, s.url);
        await new Promise((r) => setTimeout(r, 4000));
        expect((await mandato(app)).filter((m) => m.testo.includes('12.345,67'))).toEqual([]);
        const r = await shell.evaluate(() => window.filoShell.downloads.list());
        expect((((r && r.items) || []).find((it) => it.id === rec.id) || {}).filename).toBe('documento.txt');
      } finally { await s.chiudi(); }
    });
  }
});
