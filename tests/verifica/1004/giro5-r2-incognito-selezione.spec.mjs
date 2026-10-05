// #1004 giro 5 — rilievo 2: la pagina Privacy promette che in incognito non parte niente; la selezione parte.
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

test('in incognito selezionare del testo non manda niente a un modello, come promette la pagina Privacy', async ({ app, shell, testServer }) => {
  await modelliFinti(app);
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    !!BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)), { timeout: 15_000 }).toBe(true);
  const url = testServer.html('<!doctype html><title>Privata</title><body><p id="p">Il mio IBAN segreto è IT60X0542811101000000123456 per il bonifico.</p></body>', { pubblico: true });
  await app.evaluate(async ({ BrowserWindow }, url) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs);
    const tm = win._filoTabs;
    const id = tm.openTab(url);
    const t0 = Date.now();
    let tab = null;
    while (Date.now() - t0 < 10000) {
      tab = tm.tabs.find((t) => t.id === id);
      if (tab && tab.url === url && /Privata/.test(tab.title || '')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 1500));
    await tab.view.webContents.executeJavaScript(`(function(){const p=document.getElementById('p');const r=document.createRange();r.selectNodeContents(p.firstChild);r.setStart(p.firstChild,20);r.setEnd(p.firstChild,47);const s=getSelection();s.removeAllRanges();s.addRange(r);return String(s);})()`);
  }, url);
  await new Promise((r) => setTimeout(r, 3000));
  const partito = await app.evaluate(() => globalThis.__mandato.slice());

  expect(partito.some((m) => m.testo.includes('IT60X0542811101000000123456'))).toBe(false);
});
