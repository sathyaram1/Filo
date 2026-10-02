// #465 giro 3, rilievo 1: un salvataggio in Gestione fatto prima che arrivino i Modelli predefiniti
// non deve cancellare la catena con cui la ricerca fra i feedback girava. Owner, Firestore e OpenRouter finti nel main.
import { test, expect } from '../../fixtures/electron.mjs';

const DEFAULTS = {
  provider: 'openrouter',
  models: { manage_search: 'vecchio', explain: 'vecchio' },
  modelRegistry: { vecchio: { provider: 'openrouter', model: 'vendor/vecchio' } },
};

async function preparaOwner(app, { supportDoc, defaults }) {
  await app.evaluate(async (electron, { supportDoc, defaults }) => {
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
      if (u.includes('openrouter.ai/api/v1/chat/completions')) {
        const body = JSON.parse(init.body || '{}');
        g.modelli.push(body.model);
        return risposta(true, { id: 'x', model: body.model, choices: [{ message: { role: 'assistant', content: '[]' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
      }
      return risposta(false, {}, 503);
    };
    req(path.join(electron.app.getAppPath(), 'src/main/services/supportModelsStore.js')).invalidaCache();
    await globalThis.__filoDefaults.refresh();
    await globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { apiKeys: { openrouter: 'sk-owner' } } }, { url: 'filo://options/options.html' });
  }, { supportDoc, defaults });
}

test('salvare Gestione mentre i Modelli predefiniti non sono ancora arrivati lascia alla ricerca la catena di prima', async ({ app, openTab }) => {
  // Nell'app vera, finché i predefiniti non arrivano, le catene sono vuote: qui si toglie quella di prova.
  await app.evaluate(() => { if (globalThis.SN_TEST_MODELS) delete globalThis.SN_TEST_MODELS.models.manage_search; });
  // La ricerca non è mai stata impostata in Gestione: vale la scelta di prima, nei predefiniti.
  await preparaOwner(app, { supportDoc: { judge1: 'flash' }, defaults: { provider: 'openrouter' } });

  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await page.locator('.mg-tab[data-tab="models"]').click();
  await expect(page.locator('#mgSmEditor')).toBeVisible({ timeout: 8000 });
  // L'owner cambia solo un giudice e salva.
  const giudice = page.locator('.mg-sm-slot[data-slot="judge2"] .sn-chain-input').first();
  await giudice.fill('flash');
  await giudice.press('Tab');
  await page.click('#mgSmSaveBtn');
  await expect(page.locator('#mgSmStatus')).toHaveText('Salvato.', { timeout: 5000 });

  // La rete torna e i predefiniti arrivano, con la catena di sempre.
  await app.evaluate(async (_e, d) => {
    globalThis.__g465.docs['config/models'] = { fields: globalThis.__toFs465(d).mapValue.fields };
    await globalThis.__filoDefaults.refresh();
  }, DEFAULTS);

  const esito = await app.evaluate(async () => {
    try {
      const r = await globalThis.SN_HANDLE_MESSAGE({ type: 'ai_request', action: 'manage_search', payload: { messages: [{ role: 'user', content: 'cerca' }] } }, { url: 'filo://manage/manage.html' });
      return { modello: r && r.model };
    } catch (e) { return { errore: String((e && e.message) || e) }; }
  });
  expect(esito).toEqual({ modello: 'vendor/vecchio' });
});
