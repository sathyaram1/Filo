// Verifica #1118 giro 2: la ricerca col classificatore sotto stress (troppe richieste, crediti finiti a metà,
// titoli con markup, clic durante la lettura): porte provate e chiuse.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function feedbacks() {
  const out = [];
  for (let i = 0; i < 40; i++) {
    out.push({
      _id: `fb-${i}`, name: `Feedback qualunque ${i}`, text: `Una richiesta che parla d'altro, numero ${i}.`,
      seq: 500 + i, subSeq: 0, status: i % 3 ? 'new' : 'archived',
      clientId: 't@example.com', createdAt: '2026-06-03T10:00:00Z', images: [],
    });
  }
  out[7] = { ...out[7], name: '<img src=x onerror="window.__xss=1">La X non chiude 🙃', text: 'Premo la crocetta in alto e la scheda resta lì.' };
  out[23] = { ...out[23], name: 'Pulsante di chiusura morto', text: 'Il tasto per chiudere non risponde.' };
  out[31] = { ...out[31], name: 'Chiudere è difficile', text: 'Forse il bottone di chiusura è troppo piccolo.' };
  return out;
}

async function preparaOwner(app, { modo = 'ok', latenza = 300 }) {
  await app.evaluate(async (electron, { modo, latenza }) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
    const auth = req(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    const g = globalThis.__v1118 = {
      docs: {
        'config/supportModels': { fields: { manageSearch: { stringValue: 'vendor/testo' } } },
        'config/judgeSecrets': { fields: { openrouterKey: { stringValue: 'sk-giudici' } } },
      },
      decisioni: 0, risposte429: 0, chat: 0,
    };
    auth.getIdToken = async () => 'finto';
    auth.isAdmin = () => true;
    auth.isSignedIn = () => true;
    auth.getProfile = () => ({ email: 'owner@example.com', name: 'Owner' });
    const risposta = (ok, corpo, status, headers) => ({
      ok, status: status || (ok ? 200 : 404), headers: new Map(Object.entries(headers || {})),
      clone() { return this; }, async json() { return corpo; }, async text() { return JSON.stringify(corpo); },
    });
    const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      const m = u.match(/documents\/(config\/[A-Za-z]+)/);
      if (m) return g.docs[m[1]] ? risposta(true, g.docs[m[1]]) : risposta(false, {}, 404);
      if (u.includes('/endpoints')) return risposta(true, { data: { endpoints: [{ provider_name: 'TypeSafe', tag: 'typesafe' }] } });
      if (u.includes('openrouter.ai/api/alpha/decisions')) {
        const body = JSON.parse(init.body || '{}');
        const n = ++g.decisioni;
        await pausa(latenza);
        if (modo === '429' && n <= 4) { g.risposte429++; return risposta(false, { error: { message: 'rate limited' } }, 429, { 'retry-after': '0.3' }); }
        if (modo === '402' && n > 1) return risposta(false, { error: { message: 'Insufficient credits' } }, 402);
        const answers = {};
        for (const [nome, q] of Object.entries(body.questions || {})) {
          const t = String(q.instructions || '');
          const p = /crocetta/.test(t) ? 0.97 : /chiudere non risponde/.test(t) ? 0.88 : /bottone di chiusura/.test(t) ? 0.71 : 0.04;
          answers[nome] = { type: 'noul', noul: p };
        }
        return risposta(true, { model: body.model, answers, usage: { input_tokens: 300, output_tokens: 0, cost: 0.00002 } });
      }
      if (u.includes('openrouter.ai/api/v1/chat/completions')) {
        const body = JSON.parse(init.body || '{}');
        if (JSON.stringify(body.messages || []).includes('motore di ricerca semantica')) g.chat++;
        const content = JSON.stringify([{ id: 'fb-23', reason: 'dal modello' }]);
        return risposta(true, { id: 'x', model: body.model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
      }
      return risposta(false, {}, 503);
    };
    req(path.join(electron.app.getAppPath(), 'src/main/services/supportModelsStore.js')).invalidaCache();
    await globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { apiKeys: { openrouter: 'sk-owner' } } }, { url: 'filo://options/options.html' });
  }, { modo, latenza });
}

async function cerca(page, testo) {
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), feedbacks());
  await page.click('#mgSearchToggle');
  await page.fill('#mgSearchInput', testo);
  await page.press('#mgSearchInput', 'Enter');
}

test('crediti finiti a metà: restano i risultati trovati e la pagina dice dove si è fermato', async ({ app, openTab }) => {
  await preparaOwner(app, { modo: '402' });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await cerca(page, 'la x per chiudere');
  await expect(page.locator('#mgSearchProgress')).toBeHidden({ timeout: 20000 });
  await expect(page.locator('#mgSearchMsg')).toContainText(/si è fermato dopo 16 feedback su 40/);
  await expect(page.locator('.mg-item--result')).toHaveCount(3);
});

test('titolo con markup ed emoji: si legge come testo, e il clic durante la lettura resta', async ({ app, openTab }) => {
  await preparaOwner(app, { latenza: 900 });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await cerca(page, 'la x per chiudere');
  const prima = page.locator('.mg-item--result').first();
  await expect(prima).toBeVisible({ timeout: 10000 });
  await prima.click();
  await expect(page.locator('#mgSearchProgress')).toBeHidden({ timeout: 20000 });
  await expect(page.locator('.mg-item--result')).toHaveCount(3);
  await expect(page.locator('.mg-item--result.mg-item--selected')).toHaveCount(1);
  await expect(page.locator('.mg-item--result').first()).toContainText('<img src=x');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});
