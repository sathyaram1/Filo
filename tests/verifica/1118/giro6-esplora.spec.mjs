// Verifica #1118 giro 6: ricerche in fila, chiusura a metà, riapertura: porte provate e chiuse.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function feedbacks(n = 40) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      _id: `fb-${i}`, name: `Feedback qualunque ${i}`, text: `Una richiesta che parla d'altro, numero ${i}.`,
      seq: 500 + i, subSeq: 0, status: i % 3 ? 'new' : 'archived',
      clientId: 't@example.com', createdAt: '2026-06-03T10:00:00Z', images: [],
    });
  }
  out[7] = { ...out[7], name: 'La X non chiude', text: 'Premo la crocetta in alto e la scheda resta lì.' };
  out[23] = { ...out[23], name: 'Pulsante di chiusura morto', text: 'Il tasto per chiudere non risponde.' };
  out[31] = { ...out[31], name: 'Chiudere è difficile', text: 'Forse il bottone di chiusura è troppo piccolo.' };
  out[12] = { ...out[12], name: 'Tema scuro illeggibile', text: 'Col tema scuro le scritte grigie non si leggono.' };
  return out;
}

async function preparaOwner(app, { latenza = 300 } = {}) {
  await app.evaluate(async (electron, { latenza }) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
    const auth = req(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    const g = globalThis.__v1118 = {
      docs: {
        'config/supportModels': { fields: { manageSearch: { stringValue: 'vendor/testo' } } },
        'config/judgeSecrets': { fields: { openrouterKey: { stringValue: 'sk-giudici' } } },
      },
      decisioni: 0, chat: 0, latenza,
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
        g.decisioni++;
        await pausa(g.latenza);
        const ricerca = String((body.state && body.state.ricerca) || '');
        const answers = {};
        for (const [nome, q] of Object.entries(body.questions || {})) {
          const t = String(q.instructions || '');
          let p = 0.04;
          if (/chiud/.test(ricerca)) p = /crocetta/.test(t) ? 0.97 : /chiudere non risponde/.test(t) ? 0.88 : /bottone di chiusura/.test(t) ? 0.71 : 0.04;
          else if (/scuro/.test(ricerca)) p = /tema scuro/i.test(t) ? 0.93 : 0.03;
          answers[nome] = { type: 'noul', noul: p };
        }
        return risposta(true, { model: body.model, answers, usage: { input_tokens: 300, output_tokens: 0, cost: 0.00002 } });
      }
      if (u.includes('openrouter.ai/api/v1/chat/completions')) {
        const body = JSON.parse(init.body || '{}');
        g.chat++;
        const content = JSON.stringify([{ id: 'fb-23', reason: 'dal modello' }]);
        return risposta(true, { id: 'x', model: body.model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
      }
      return risposta(false, {}, 503);
    };
    req(path.join(electron.app.getAppPath(), 'src/main/services/supportModelsStore.js')).invalidaCache();
    await globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { apiKeys: { openrouter: 'sk-owner' } } }, { url: 'filo://options/options.html' });
  }, { latenza });
}

async function apri(app, openTab, n, opts) {
  await preparaOwner(app, opts);
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), feedbacks(n));
  await page.click('#mgSearchToggle');
  return page;
}

async function invia(page, testo) {
  await page.fill('#mgSearchInput', testo);
  await page.press('#mgSearchInput', 'Enter');
}

test('due ricerche in fila: restano solo i risultati della seconda', async ({ app, openTab }) => {
  const page = await apri(app, openTab, 400, { latenza: 700 });
  await invia(page, 'la x per chiudere');
  await page.waitForTimeout(1000);
  await invia(page, 'tema scuro illeggibile');
  await expect(page.locator('#mgSearchProgress')).toBeHidden({ timeout: 30000 });
  await page.waitForTimeout(1500);
  const titoli = await page.locator('.mg-item--result .mg-item-title').allInnerTexts();
  console.log('seconda:', titoli, 'msg:', await page.locator('#mgSearchMsg').innerText());
  expect(titoli).toEqual(['Tema scuro illeggibile']);
});

test('ricerca chiusa a metà: il classificatore smette di chiedere', async ({ app, openTab }) => {
  const page = await apri(app, openTab, 800, { latenza: 500 });
  await invia(page, 'la x per chiudere');
  await page.waitForTimeout(1500);
  await page.click('#mgSearchClose');
  await page.waitForTimeout(800);
  const a = await app.evaluate(() => globalThis.__v1118.decisioni);
  await page.waitForTimeout(3000);
  const b = await app.evaluate(() => globalThis.__v1118.decisioni);
  console.log('richieste alla chiusura', a, 'dopo 3 s', b);
  expect(b).toBe(a);
});

test('riaperta e rifatta subito: la stessa ricerca ridà gli stessi risultati', async ({ app, openTab }) => {
  const page = await apri(app, openTab, 200, { latenza: 300 });
  await invia(page, 'la x per chiudere');
  await page.waitForTimeout(300);
  await page.click('#mgSearchClose');
  await page.click('#mgSearchToggle');
  await invia(page, 'la x per chiudere');
  await expect(page.locator('#mgSearchProgress')).toBeHidden({ timeout: 30000 });
  await expect(page.locator('.mg-item--result')).toHaveCount(3);
  console.log('msg:', await page.locator('#mgSearchMsg').innerText());
});
