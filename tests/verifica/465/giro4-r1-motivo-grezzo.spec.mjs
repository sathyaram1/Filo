// Verifica #465 giro 4, rilievo 1: quando la ricerca fra i feedback ripiega sul testo, il motivo
// mostrato è una frase per chi legge, non l'errore tecnico grezzo («fetch failed», JSON del fornitore).
import { test, expect } from '../../fixtures/electron.mjs';

const CATALOGO_OR = [
  { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6', created: 1780000000, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', created: 1779000000, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', created: 1778000000, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
];

async function preparaOwner(app, { supportDoc, defaults, catalogo = true }) {
  await app.evaluate(async (electron, { supportDoc, defaults, catalogo, CAT }) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
    const auth = req(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    const toFs = (v) => {
      if (typeof v === 'string') return { stringValue: v };
      const fields = {}; for (const [k, x] of Object.entries(v)) fields[k] = toFs(x);
      return { mapValue: { fields } };
    };
    globalThis.__toFs465 = toFs;
    const g = globalThis.__g465 = {
      docs: {
        'config/models': { fields: toFs(defaults).mapValue.fields },
        'config/supportModels': { fields: toFs(supportDoc).mapValue.fields },
        'config/judgeSecrets': { fields: { openrouterKey: { stringValue: 'sk-giudici' } } },
      },
      modelli: [],
      chiaviUsate: [],
    };
    auth.getIdToken = async () => 'finto';
    auth.isAdmin = () => true;
    auth.isSignedIn = () => true;
    auth.getProfile = () => ({ email: 'owner@example.com', name: 'Owner' });
    const risposta = (ok, corpo, status) => ({ ok, status: status || (ok ? 200 : 404), headers: new Map(), async json() { return corpo; }, async text() { return JSON.stringify(corpo); } });
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      const m = u.match(/documents\/(config\/[A-Za-z]+)/);
      if (m) {
        if ((init.method || 'GET') === 'PATCH') {
          const body = JSON.parse(init.body);
          const cur = g.docs[m[1]] || { fields: {} };
          for (const k of new URL(u).searchParams.getAll('updateMask.fieldPaths')) cur.fields[k] = body.fields[k];
          g.docs[m[1]] = cur;
          return risposta(true, cur);
        }
        return g.docs[m[1]] ? risposta(true, g.docs[m[1]]) : risposta(false, {}, 404);
      }
      if (u.includes('openrouter.ai/api/v1/models')) {
        if (!catalogo) return risposta(false, {}, 503);
        return risposta(true, { data: u.includes('output_modalities') ? [] : CAT });
      }
      if (u.includes('openrouter.ai/api/v1/chat/completions')) {
        const body = JSON.parse(init.body || '{}');
        g.modelli.push(body.model); (g.corpi = g.corpi || []).push(JSON.stringify(body).slice(0, 300));
        const h = init.headers || {};
        g.chiaviUsate.push(String(h.Authorization || h.authorization || ''));
        return risposta(true, { id: 'x', model: body.model, choices: [{ message: { role: 'assistant', content: '["fb-b"]' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
      }
      return risposta(false, {}, 503);
    };
    req(path.join(electron.app.getAppPath(), 'src/main/services/supportModelsStore.js')).invalidaCache();
    await globalThis.__filoDefaults.refresh();
    await globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { apiKeys: { openrouter: 'sk-owner' } } }, { url: 'filo://options/options.html' });
  }, { supportDoc, defaults, catalogo, CAT: CATALOGO_OR });
}

const DEFAULTS = {
  provider: 'openrouter',
  models: { manage_search: 'vecchio' },
  modelRegistry: { vecchio: { provider: 'openrouter', model: 'vendor/vecchio' } },
};

const FBS = [
  { _id: 'fb-a', name: 'Pulsante X rotto', text: 'Il tasto di chiusura non fa nulla.', seq: 1, subSeq: 0, status: 'new', clientId: 't@example.com', createdAt: '2026-06-03T10:00:00Z', images: [] },
  { _id: 'fb-b', name: 'Schede con audio', text: 'Le schede che suonano non si vedono.', seq: 2, subSeq: 0, status: 'new', clientId: 't@example.com', createdAt: '2026-06-04T10:00:00Z', images: [] },
];

async function cercaConGuasto(app, openTab, guasto) {
  await preparaOwner(app, { supportDoc: { judge1: 'flash', manageSearch: 'vecchio' }, defaults: DEFAULTS });
  await app.evaluate((_e, guasto) => {
    const prima = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('chat/completions')) {
        if (guasto === 'rete') throw new TypeError('fetch failed');
        return new Response('{"error":{"message":"No auth credentials found","code":401}}', { status: 401, headers: { 'content-type': 'application/json' } });
      }
      return prima(url, init);
    };
  }, guasto);
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), FBS);
  await page.click('#mgSearchToggle');
  await page.fill('#mgSearchInput', 'tasto chiusura');
  await page.press('#mgSearchInput', 'Enter');
  const msg = page.locator('#mgSearchMsg');
  await expect(msg).toContainText('risultati per testo', { timeout: 15000 });
  // I risultati per testo arrivano comunque.
  await expect(page.locator('#mgList')).toContainText('Pulsante X rotto');
  return (await msg.textContent()) || '';
}

test('senza rete la ricerca dice che manca la connessione, non «fetch failed»', async ({ app, openTab }) => {
  const testo = await cercaConGuasto(app, openTab, 'rete');
  expect(testo).not.toContain('fetch failed');
  expect(testo).toMatch(/rete|connessione/i);
});

test('chiave rifiutata: la ricerca lo dice a parole, senza il JSON del fornitore', async ({ app, openTab }) => {
  const testo = await cercaConGuasto(app, openTab, 'chiave');
  expect(testo).not.toContain('{"error"');
  expect(testo).not.toMatch(/OpenRouter 401/);
  expect(testo).toMatch(/chiave/i);
});
