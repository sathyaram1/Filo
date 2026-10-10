// #465: la ricerca fra i feedback prende il modello da Gestione → Modelli di supporto, sul main vero
// (owner, Firestore e OpenRouter finti). Un salvataggio non sceglie per lei; senza modello la pagina dice dove si imposta.
import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

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
  await apriScheda(page, 'models');
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

const FBS = [
  { _id: 'fb-a', name: 'Pulsante X rotto', text: 'Il tasto di chiusura non fa nulla.', seq: 1, subSeq: 0, status: 'new', clientId: 't@example.com', createdAt: '2026-06-03T10:00:00Z', images: [] },
  { _id: 'fb-b', name: 'Schede con audio', text: 'Le schede che suonano non si vedono.', seq: 2, subSeq: 0, status: 'new', clientId: 't@example.com', createdAt: '2026-06-04T10:00:00Z', images: [] },
];

test('ricerca senza modello impostato: la pagina dice dove si imposta', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { judge1: 'flash', manageSearch: '' }, defaults: { provider: 'openrouter', models: { manage_search: 'vecchio' }, modelRegistry: { vecchio: { provider: 'openrouter', model: 'vendor/vecchio' } } } });
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), FBS);
  await page.click('#mgSearchToggle');
  await page.fill('#mgSearchInput', 'tasto chiusura');
  await page.press('#mgSearchInput', 'Enter');
  // I risultati per testo arrivano comunque; il messaggio deve dire dove rimettere il modello.
  await expect(page.locator('#mgSearchMsg')).toContainText('Modelli di supporto', { timeout: 8000 });
});

test('mai impostata in Gestione: segue la catena in uso finché l\'owner non la cambia, e la sua scelta si salva', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { judge1: 'flash' }, defaults: { ...DEFAULTS, modelRegistry: { ...DEFAULTS.modelRegistry, nuovo: { provider: 'openrouter', model: 'vendor/nuovo' } } } });
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await apriScheda(page, 'models');
  await expect(page.locator('#mgSmEditor')).toBeVisible({ timeout: 8000 });
  const campo = page.locator('.mg-sm-slot[data-slot="manageSearch"] .sn-chain-input').first();
  await expect(campo).toHaveValue('vecchio');

  await campo.fill('nuovo');
  await campo.press('Tab');
  await page.click('#mgSmSaveBtn');
  await expect(page.locator('#mgSmStatus')).toHaveText('Salvato.', { timeout: 5000 });
  await expect(campo).toHaveValue('nuovo');

  const modello = await app.evaluate(async () => {
    const r = await globalThis.SN_HANDLE_MESSAGE({ type: 'ai_request', action: 'manage_search', payload: { messages: [{ role: 'user', content: 'cerca' }] } }, { url: 'filo://manage/manage.html' });
    return r && r.model;
  });
  expect(modello).toBe('vendor/nuovo');
});
