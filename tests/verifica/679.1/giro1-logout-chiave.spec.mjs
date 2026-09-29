// #679.1 giro 1 — dopo l'uscita dell'admin, le chiavi lette da admin non si usano più, subito.
import { test, expect } from '../../fixtures/electron.mjs';

async function comeAdmin(app) {
  await app.evaluate(async (electron) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const auth = createRequire(path.join(electron.app.getAppPath(), 'package.json'))(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    globalThis.__v679 = { admin: true };
    auth.getIdToken = async () => (globalThis.__v679.admin ? 'finto' : null);
    auth.isAdmin = () => globalThis.__v679.admin;
    auth.isSignedIn = () => globalThis.__v679.admin;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, o) => {
      const u = String(url);
      if (u.includes('config/secrets')) {
        return { ok: true, status: 200, async json() { return { fields: {
          apiKeys: { mapValue: { fields: { openrouter: { stringValue: 'sk-or-owner' }, tavily: { stringValue: 'tvly-owner' } } } },
          safeBrowsingKey: { stringValue: 'gsb-owner' } } }; }, async text() { return ''; } };
      }
      if (u.includes('config/models')) return { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
      return origFetch(url, o);
    };
    await globalThis.__filoDefaults.refresh();
  });
}

const chiavi = (app) => app.evaluate(async () => {
  const s = await globalThis.__filoHandlers.getEffectiveSettings();
  return { or: s.apiKeys.openrouter, tv: s.apiKeys.tavily, sb: s.security?.safeBrowse?.safeBrowsingKey || '' };
});

test('logout admin: chiamate AI e ricerca smettono subito di usare le sue chiavi', async ({ app }) => {
  await comeAdmin(app);
  expect(await chiavi(app)).toEqual({ or: 'sk-or-owner', tv: 'tvly-owner', sb: 'gsb-owner' });
  // Uscita: nessuna rilettura, nessuna attesa.
  await app.evaluate(() => { globalThis.__v679.admin = false; });
  const dopo = await chiavi(app);
  expect(dopo.or).not.toBe('sk-or-owner');
  expect(dopo.tv).not.toBe('tvly-owner');
  expect(dopo.sb).not.toBe('gsb-owner');
  // Riaccesso: tornano senza aspettare.
  await app.evaluate(() => { globalThis.__v679.admin = true; });
  expect((await chiavi(app)).or).toBe('sk-or-owner');
});
