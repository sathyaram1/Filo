// La chiave Safe Browsing dell'admin segue la sessione (#679.4): accesso e uscita
// cambiano la chiave con cui partono le verifiche dei siti, senza toccare le preferenze.
import { test, expect } from './fixtures/electron.mjs';

// Admin finto (email e token) e rete finta: config/secrets risponde con la sua
// chiave, e ogni richiesta a Safe Browsing lascia scritta la chiave usata.
async function preparaAdmin(app, { dentro }) {
  await app.evaluate(async (electron, dentro) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
    const auth = req(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    globalThis.__sb679 = { admin: dentro, chiavi: [] };
    auth.getIdToken = async () => (globalThis.__sb679.admin ? 'finto' : null);
    auth.isAdmin = () => globalThis.__sb679.admin;
    auth.isSignedIn = () => globalThis.__sb679.admin;
    const esci = auth.signOut;
    auth.signOut = () => { globalThis.__sb679.admin = false; try { esci(); } catch (_) {} };
    const risposta = (ok, corpo) => ({ ok, status: ok ? 200 : 404, async json() { return corpo; }, async text() { return ''; } });
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('config/secrets')) return risposta(true, { fields: { safeBrowsingKey: { stringValue: 'gsb-owner' } } });
      if (u.includes('safebrowsing.googleapis.com')) {
        globalThis.__sb679.chiavi.push(new URL(u).searchParams.get('key'));
        return risposta(true, {});
      }
      return risposta(false, {});
    };
    await globalThis.__filoDefaults.refresh();
  }, dentro);
}

// Cambia una preferenza qualunque dalla pagina Preferenze (stessa strada del salvataggio).
const cambiaPreferenza = (app) => app.evaluate(async () => {
  const filo = { tab: { id: 1, url: 'filo://options/' }, url: 'filo://options/' };
  const s = await globalThis.SN_STORAGE.getSettings();
  await globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { openWeightsOnly: !s.openWeightsOnly } }, filo);
});

// Chiave con cui parte la verifica di un sito mai visto (null: nessuna richiesta a Safe Browsing).
const chiaveDellaVerifica = (app, host) => app.evaluate(async (_e, host) => {
  const prima = globalThis.__sb679.chiavi.length;
  globalThis.SN_SAFEBROWSE.analyze(`https://${host}/`, {}, () => {});
  for (let i = 0; i < 50 && globalThis.__sb679.chiavi.length === prima; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  return globalThis.__sb679.chiavi.length > prima ? globalThis.__sb679.chiavi.at(-1) : null;
}, host);

test('uscita dell\'admin: le verifiche dei siti smettono subito di usare la sua chiave', async ({ app }) => {
  await preparaAdmin(app, { dentro: true });
  await cambiaPreferenza(app);
  expect(await chiaveDellaVerifica(app, 'prova-679-prima.com')).toBe('gsb-owner');

  const esito = await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE({ type: 'auth_signout' }, { tab: { id: 1, url: 'filo://options/' }, url: 'filo://options/' }));
  expect(esito.ok).toBe(true);
  expect(await chiaveDellaVerifica(app, 'prova-679-dopo.com')).not.toBe('gsb-owner');
});

test('accesso dell\'admin: la sua chiave arriva alle verifiche senza cambiare preferenze', async ({ app }) => {
  await preparaAdmin(app, { dentro: false });
  await app.evaluate(() => globalThis.__filoHandlers.wireSafebrowse());
  expect(await chiaveDellaVerifica(app, 'prova-679-fuori.com')).not.toBe('gsb-owner');

  // Come fa l'accesso: la sessione c'è, la config condivisa si rilegge.
  await app.evaluate(async () => { globalThis.__sb679.admin = true; await globalThis.__filoDefaults.refresh(); });
  expect(await chiaveDellaVerifica(app, 'prova-679-dentro.com')).toBe('gsb-owner');
});
