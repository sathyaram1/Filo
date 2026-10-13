// Verifica #784.2 giro 1: dal canale vero di un sito, con la sessione dell'owner finta, le porte del
// proprietario rifiutano per provenienza; le pagine vere di Filo passano. r1: l'annullo di un feedback.
import { test, expect } from '../../fixtures/electron.mjs';

async function finginOwner(app) {
  await app.evaluate(async () => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    ga.isAdmin = () => true;
    ga.isSignedIn = () => true;
    ga.getIdToken = async () => 'token-finto-dell-owner';
    globalThis.__usciteOwner = [];
    const fetchVera = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const u = String((url && url.url) || url || '');
      const h = init && init.headers ? JSON.stringify(init.headers) : '';
      if (/cloudfunctions\.net|openrouter\.ai\/api\/|firestore\.googleapis\.com/.test(u)) {
        globalThis.__usciteOwner.push({ u, conToken: h.includes('token-finto-dell-owner') });
        throw new Error('rete finta');
      }
      return fetchVera(url, init);
    };
  });
}

test('dal mondo isolato di un sito le sei porte del proprietario rifiutano per provenienza e non escono', async ({ app, shell, openTab, testServer }) => {
  void shell;
  await testServer.openReady(openTab, '<html><head><title>Sito</title></head><body><p>sito</p></body></html>', { pubblico: true });
  await finginOwner(app);
  const out = await app.evaluate(async ({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const b = tm.tabs.find((t) => /sito-pubblico\.test/.test(t.url || ''));
    const manda = (m) => b.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `chrome.runtime.sendMessage(${JSON.stringify(m)})` }]);
    const r = {
      gen: await manda({ type: 'redteam_gen_codes', count: 3 }),
      list: await manda({ type: 'redteam_list_codes' }),
      revoke: await manda({ type: 'redteam_revoke_code', code: 'ABCD' }),
      prova: await manda({ type: 'test_default_model', model: 'x/y' }),
      provaNick: await manda({ type: 'test_default_model', nickname: 'qualsiasi' }),
      catalogo: await manda({ type: 'default_models_list' }),
      fornitori: await manda({ type: 'default_providers_list' }),
    };
    return { r, uscite: globalThis.__usciteOwner.splice(0) };
  });
  for (const [k, v] of Object.entries(out.r)) expect(v, k).toEqual({ ok: false, code: 'forbidden', error: 'forbidden' });
  expect(out.uscite).toEqual([]);
});

test('dalle pagine vere di Filo, con l\'owner dentro, codici e catalogo arrivano alla rete', async ({ app, shell, openTab }) => {
  void shell;
  await finginOwner(app);
  const rt = await openTab('filo://redteam/redteam.html');
  const ad = await openTab('filo://admin-defaults/admin-defaults.html');
  const a = await rt.evaluate(async () => ({
    gen: await chrome.runtime.sendMessage({ type: 'redteam_gen_codes', count: 1 }),
    list: await chrome.runtime.sendMessage({ type: 'redteam_list_codes' }),
  }));
  const b = await ad.evaluate(async () => ({
    catalogo: await chrome.runtime.sendMessage({ type: 'default_models_list' }),
    fornitori: await chrome.runtime.sendMessage({ type: 'default_providers_list' }),
    prova: await chrome.runtime.sendMessage({ type: 'test_default_model', model: 'x/y' }),
  }));
  for (const [k, v] of Object.entries({ ...a, ...b })) {
    expect(String(v.code || ''), k).not.toMatch(/forbidden|not_admin/);
  }
});

test('r1 un sito visitato non annulla un feedback con le credenziali dell\'owner', async ({ app, shell, openTab, testServer }) => {
  void shell;
  await testServer.openReady(openTab, '<html><head><title>Sito</title></head><body><p>sito</p></body></html>', { pubblico: true });
  await finginOwner(app);
  const out = await app.evaluate(async ({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const b = tm.tabs.find((t) => /sito-pubblico\.test/.test(t.url || ''));
    const r = await b.view.webContents.executeJavaScriptInIsolatedWorld(999, [{
      code: 'chrome.runtime.sendMessage({ type: "cancel_auto_feedback", id: "fb-di-un-altro" })',
    }]);
    return { r, uscite: globalThis.__usciteOwner.splice(0) };
  });
  expect(out.uscite.filter((x) => x.conToken), 'la richiesta del sito è partita col token dell\'owner').toEqual([]);
  expect(out.r && out.r.code).toBe('forbidden');
});
