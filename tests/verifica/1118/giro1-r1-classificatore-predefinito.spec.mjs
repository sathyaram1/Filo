// #1118 giro 1 — la ricerca dell'owner usa il classificatore senza doverlo prima scegliere: con lo slot mai
// impostato (il caso di chi ha appena aggiornato) la ricerca deve comunque mandare le domande al classificatore.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function feedbacks() {
  const out = [];
  for (let i = 0; i < 40; i++) {
    out.push({
      _id: `fb-${i}`, name: `Feedback qualunque ${i}`, text: `Una richiesta che parla d'altro, numero ${i}.`,
      seq: 500 + i, subSeq: 0, status: 'new', clientId: 't@example.com', createdAt: '2026-06-03T10:00:00Z', images: [],
    });
  }
  out[7] = { ...out[7], name: 'La X non chiude', text: 'Premo la crocetta in alto e la scheda resta lì.' };
  return out;
}

async function preparaOwner(app, supportDoc) {
  await app.evaluate(async (electron, supportDoc) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
    const auth = req(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    const toFs = (v) => {
      if (typeof v === 'string') return { stringValue: v };
      const fields = {}; for (const [k, x] of Object.entries(v)) fields[k] = toFs(x);
      return { mapValue: { fields } };
    };
    const g = globalThis.__v1118 = {
      docs: {
        'config/supportModels': { fields: toFs(supportDoc).mapValue.fields },
        'config/judgeSecrets': { fields: { openrouterKey: { stringValue: 'sk-giudici' } } },
      },
      decisioni: [], chat: [],
    };
    auth.getIdToken = async () => 'finto';
    auth.isAdmin = () => true;
    auth.isSignedIn = () => true;
    auth.getProfile = () => ({ email: 'owner@example.com', name: 'Owner' });
    const risposta = (ok, corpo, status) => ({
      ok, status: status || (ok ? 200 : 404), headers: new Map(),
      clone() { return this; }, async json() { return corpo; }, async text() { return JSON.stringify(corpo); },
    });
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      const m = u.match(/documents\/(config\/[A-Za-z]+)/);
      if (m) return g.docs[m[1]] ? risposta(true, g.docs[m[1]]) : risposta(false, {}, 404);
      if (u.includes('/endpoints')) return risposta(true, { data: { endpoints: [{ provider_name: 'TypeSafe', tag: 'typesafe' }] } });
      if (u.includes('openrouter.ai/api/alpha/decisions')) {
        const body = JSON.parse(init.body || '{}');
        g.decisioni.push(body);
        const answers = {};
        for (const [nome, q] of Object.entries(body.questions || {})) {
          answers[nome] = { type: 'noul', noul: /crocetta/.test(String(q.instructions || '')) ? 0.95 : 0.03 };
        }
        return risposta(true, { model: body.model, answers, usage: { input_tokens: 300, output_tokens: 0, cost: 0.00002 } });
      }
      if (u.includes('openrouter.ai/api/v1/chat/completions')) {
        const body = JSON.parse(init.body || '{}');
        if (JSON.stringify(body.messages || []).includes('motore di ricerca semantica')) g.chat.push(body.model);
        const content = JSON.stringify([{ id: 'fb-7', reason: 'dal modello' }]);
        return risposta(true, { id: 'x', model: body.model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
      }
      return risposta(false, {}, 503);
    };
    req(path.join(electron.app.getAppPath(), 'src/main/services/supportModelsStore.js')).invalidaCache();
    await globalThis.SN_HANDLE_MESSAGE({
      type: 'update_settings', settings: { apiKeys: { openrouter: 'sk-owner' } },
    }, { url: 'filo://options/options.html' });
  }, supportDoc);
}

test('r1 con il classificatore mai scelto la ricerca lo usa lo stesso', async ({ app, openTab }) => {
  // L'owner ha scelto solo il modello della ricerca, come prima di questo lavoro.
  await preparaOwner(app, { manageSearch: 'vendor/testo' });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), feedbacks());
  await page.click('#mgSearchToggle');
  await page.fill('#mgSearchInput', 'la x per chiudere');
  await page.press('#mgSearchInput', 'Enter');
  await expect(page.locator('.mg-item--result')).toHaveCount(1, { timeout: 10000 });
  const g = await app.evaluate(() => ({ decisioni: globalThis.__v1118.decisioni.length, chat: globalThis.__v1118.chat }));
  expect(g.decisioni, 'la ricerca non ha chiesto niente al classificatore').toBeGreaterThan(0);
});
