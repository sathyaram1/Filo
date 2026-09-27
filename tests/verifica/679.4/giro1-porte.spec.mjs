// Verifica #679.4 giro 1: le altre strade che cambiano la chiave Safe Browsing
// in uso (nuova chiave salvata dall'admin, rilevatore spento e riacceso, uscita e rientro rapidi).
import { test, expect } from '../../fixtures/electron.mjs';

async function prepara(app, { dentro }) {
  await app.evaluate(async (electron, dentro) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
    const auth = req(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    globalThis.__v679 = { admin: dentro, segreta: 'gsb-owner-1', chiavi: [] };
    auth.getIdToken = async () => (globalThis.__v679.admin ? 'finto' : null);
    auth.isAdmin = () => globalThis.__v679.admin;
    auth.isSignedIn = () => globalThis.__v679.admin;
    const esci = auth.signOut;
    auth.signOut = () => { globalThis.__v679.admin = false; try { esci(); } catch (_) {} };
    const risposta = (ok, corpo) => ({ ok, status: ok ? 200 : 404, async json() { return corpo; }, async text() { return ''; } });
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('config/secrets')) {
        if (init && init.method === 'PATCH') {
          const f = JSON.parse(init.body).fields || {};
          if (f.safeBrowsingKey) globalThis.__v679.segreta = f.safeBrowsingKey.stringValue;
          return risposta(true, {});
        }
        return risposta(true, { fields: { safeBrowsingKey: { stringValue: globalThis.__v679.segreta } } });
      }
      if (u.includes('safebrowsing.googleapis.com')) {
        globalThis.__v679.chiavi.push(new URL(u).searchParams.get('key'));
        return risposta(true, {});
      }
      return risposta(false, {});
    };
    await globalThis.__filoDefaults.refresh();
    await globalThis.__filoHandlers.wireSafebrowse();
  }, dentro);
}

const chiave = (app, host) => app.evaluate(async (_e, host) => {
  const prima = globalThis.__v679.chiavi.length;
  globalThis.SN_SAFEBROWSE.analyze(`https://${host}/`, {}, () => {});
  for (let i = 0; i < 50 && globalThis.__v679.chiavi.length === prima; i++) await new Promise((r) => setTimeout(r, 20));
  return globalThis.__v679.chiavi.length > prima ? globalThis.__v679.chiavi.at(-1) : null;
}, host);

const filo = { tab: { id: 1, url: 'filo://options/' }, url: 'filo://options/' };

test('nuova chiave salvata in Modelli predefiniti: la verifica dopo la usa subito', async ({ app }) => {
  await prepara(app, { dentro: true });
  expect(await chiave(app, 'v679-a1.com')).toBe('gsb-owner-1');
  await app.evaluate(() => globalThis.__filoDefaults.update({ safeBrowsingKey: 'gsb-owner-2' }, 'finto'));
  expect(await chiave(app, 'v679-a2.com')).toBe('gsb-owner-2');
});

test('rilevatore spento: nessuna verifica di rete; riacceso dopo l\'uscita: niente chiave dell\'admin', async ({ app }) => {
  await prepara(app, { dentro: true });
  await app.evaluate((_e, filo) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { security: { safeBrowse: { enabled: false } } } }, filo), filo);
  expect(await chiave(app, 'v679-b1.com')).toBe(null);
  await app.evaluate((_e, filo) => globalThis.SN_HANDLE_MESSAGE({ type: 'auth_signout' }, filo), filo);
  await app.evaluate((_e, filo) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { security: { safeBrowse: { enabled: true } } } }, filo), filo);
  expect(await chiave(app, 'v679-b2.com')).not.toBe('gsb-owner-1');
  const salvata = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings())?.security?.safeBrowse?.safeBrowsingKey || '');
  expect(salvata).toBe('');
});

test('uscita e rientro in fretta: la chiave segue ogni passaggio', async ({ app }) => {
  await prepara(app, { dentro: true });
  for (let i = 0; i < 3; i++) {
    await app.evaluate((_e, filo) => globalThis.SN_HANDLE_MESSAGE({ type: 'auth_signout' }, filo), filo);
    expect(await chiave(app, `v679-c-out${i}.com`)).not.toBe('gsb-owner-1');
    await app.evaluate(async () => { globalThis.__v679.admin = true; await globalThis.__filoDefaults.refresh(); });
    expect(await chiave(app, `v679-c-in${i}.com`)).toBe('gsb-owner-1');
  }
});
