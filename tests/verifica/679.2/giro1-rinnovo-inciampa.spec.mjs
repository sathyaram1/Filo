// #679.2 giro 1 — un rinnovo della sessione che inciampa non spegne la configurazione dell'owner, su nessuna delle tre porte.
import { test, expect } from '../../fixtures/electron.mjs';

// Server finto con le regole vere: senza token i documenti dell'owner dicono 403,
// `config/models` è pubblico. `rinnovo`: 'ok' | 'chiude' (fallisce e chiude la
// sessione, come google-auth su un rinnovo rifiutato) | 'rete' (fallisce, sessione intatta).
async function prepara(app) {
  await app.evaluate(async (electron) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
    const root = electron.app.getAppPath();
    const auth = req(path.join(root, 'src/main/auth/google-auth.js'));
    const Support = req(path.join(root, 'src/main/services/supportModelsStore.js'));
    const s = { aperta: true, rinnovo: 'ok', rete: true, t: 10_000_000, letture: [] };
    globalThis.__v6792 = { s, Support };
    auth.isSignedIn = () => s.aperta;
    auth.isAdmin = () => s.aperta;
    auth.getProfile = () => (s.aperta ? { email: 'owner@esempio.it' } : null);
    auth.getIdToken = async () => {
      if (!s.aperta) return null;
      if (s.rinnovo === 'chiude') { s.aperta = false; throw new Error('refresh sessione fallito (503)'); }
      if (s.rinnovo === 'rete') throw new Error('fetch failed');
      return 'token-vero';
    };
    Support._setAdesso(() => s.t);
    Support.invalidaCache();
    globalThis.__filoDefaults._setAdesso(() => s.t);
    const risp = (status, fields) => ({ ok: status < 300, status, async json() { return { fields }; }, async text() { return ''; } });
    globalThis.fetch = async (url, o = {}) => {
      const u = String(url);
      const tok = Boolean(o.headers && (o.headers.Authorization || o.headers.authorization));
      if ((o.method || 'GET') === 'PATCH') return risp(200, {});
      if (!s.rete) throw new Error('rete giù');
      s.letture.push({ u: u.split('/documents/')[1].split('?')[0], tok });
      if (u.includes('config/models')) return risp(200, { models: { mapValue: { fields: { chat: { stringValue: 'owner-chat' } } } } });
      if (!tok) return risp(403, {});
      if (u.includes('config/secrets')) return risp(200, { apiKeys: { mapValue: { fields: { openrouter: { stringValue: 'sk-or-ruotata' } } } } });
      if (u.includes('config/judgeSecrets')) return risp(200, { openrouterKey: { stringValue: 'sk-giudici' } });
      if (u.includes('config/supportModels')) return risp(200, { judge1: { stringValue: 'scelto-owner' } });
      return risp(404, {});
    };
  });
}

const set = (app, patch) => app.evaluate((_e, p) => Object.assign(globalThis.__v6792.s, p), patch);
const avanti = (app, ms) => app.evaluate((_e, d) => { globalThis.__v6792.s.t += d; }, ms);
const supporto = (app) => app.evaluate(async () => {
  const m = await globalThis.__v6792.Support.get();
  return { judge1: m.judge1, chiave: m.openrouterKeyPresent };
});
const chiaveAI = (app) => app.evaluate(async () => (await globalThis.__filoHandlers.getEffectiveSettings()).apiKeys.openrouter);

test('porta 1: sessione caduta e tornata, la schermata dei modelli di supporto torna subito giusta', async ({ app }) => {
  await prepara(app);
  expect(await supporto(app)).toEqual({ judge1: 'scelto-owner', chiave: true });
  await avanti(app, 6 * 60 * 1000);
  await set(app, { rinnovo: 'chiude' });
  await supporto(app);
  await set(app, { rinnovo: 'ok', aperta: true });
  expect(await supporto(app)).toEqual({ judge1: 'scelto-owner', chiave: true });
});

test('porta 1 bis: il rinnovo cade per la rete e la sessione resta, nessun vuoto e rilettura appena torna', async ({ app }) => {
  await prepara(app);
  await supporto(app);
  await avanti(app, 6 * 60 * 1000);
  await set(app, { rinnovo: 'rete' });
  expect(await supporto(app)).toEqual({ judge1: 'scelto-owner', chiave: true });
  await set(app, { rinnovo: 'ok', letture: [] });
  expect(await supporto(app)).toEqual({ judge1: 'scelto-owner', chiave: true });
  const l = await app.evaluate(() => globalThis.__v6792.s.letture);
  expect(l.filter((x) => x.tok).length).toBe(2);
});

test('porta 2: configurazione condivisa, dopo l\'inciampo si spende la chiave ruotata, non quella del build', async ({ app }) => {
  await prepara(app);
  await app.evaluate(() => globalThis.__filoDefaults.refresh());
  expect(await chiaveAI(app)).toBe('sk-or-ruotata');
  await avanti(app, 31 * 60 * 1000);
  // Inciampo che lascia la sessione: la chiave ruotata resta in uso.
  await set(app, { rinnovo: 'rete' });
  await app.evaluate(() => globalThis.__filoDefaults.refreshIfStale());
  expect(await chiaveAI(app)).toBe('sk-or-ruotata');
  // Torna il token: la rilettura parte subito, non fra mezz'ora.
  await set(app, { rinnovo: 'ok', letture: [] });
  await app.evaluate(() => globalThis.__filoDefaults.refreshIfStale());
  const l = await app.evaluate(() => globalThis.__v6792.s.letture);
  expect(l.some((x) => x.u === 'config/secrets' && x.tok)).toBe(true);
  // Inciampo che chiude la sessione, poi riaccesso (che rilegge come fa l'accesso vero).
  await avanti(app, 31 * 60 * 1000);
  await set(app, { rinnovo: 'chiude' });
  await app.evaluate(() => globalThis.__filoDefaults.refreshIfStale());
  await set(app, { rinnovo: 'ok', aperta: true });
  expect(await chiaveAI(app)).toBe('sk-or-ruotata');
});

test('porta 3: salvataggio e poi rete giù, la schermata mostra il salvato e la chiave presente', async ({ app }) => {
  await prepara(app);
  await supporto(app);
  const dopo = await app.evaluate(async () => {
    const { s, Support } = globalThis.__v6792;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, o = {}) => {
      const r = await origFetch(url, o);
      if ((o.method || 'GET') === 'PATCH') s.rete = false;
      return r;
    };
    const m = await Support.update({ judge2: '  nuovo-giudice  ' }, 'token-vero');
    const riaperta = await Support.get();
    return { m: [m.judge1, m.judge2, m.openrouterKeyPresent], r: [riaperta.judge1, riaperta.judge2, riaperta.openrouterKeyPresent] };
  });
  expect(dopo.m).toEqual(['scelto-owner', 'nuovo-giudice', true]);
  expect(dopo.r).toEqual(['scelto-owner', 'nuovo-giudice', true]);
});
