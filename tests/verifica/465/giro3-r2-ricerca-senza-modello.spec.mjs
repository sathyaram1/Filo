// #465 giro 3, rilievo 2: quando la ricerca fra i feedback non ha un modello usabile, la pagina dice perché
// e dove si imposta adesso, invece del solo «Modello non disponibile». Owner e Firestore finti nel main.
import { test, expect } from '../../fixtures/electron.mjs';

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
