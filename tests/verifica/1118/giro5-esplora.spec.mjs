// Verifica #1118 giro 5: la ricerca col classificatore su tanti feedback (come quelli dell'owner), con troppe
// richieste all'avvio o di continuo, col posto del classificatore svuotato, e il suo aspetto nei due temi.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function feedbacks(n) {
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
  return out;
}

async function preparaOwner(app, { supportDoc, modo = 'ok', latenza = 400 }) {
  await app.evaluate(async (electron, { supportDoc, modo, latenza }) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
    const auth = req(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    const fields = {};
    for (const [k, v] of Object.entries(supportDoc)) fields[k] = { stringValue: v };
    const g = globalThis.__v1118g5 = {
      docs: {
        'config/supportModels': { fields },
        'config/judgeSecrets': { fields: { openrouterKey: { stringValue: 'sk-giudici' } } },
      },
      decisioni: 0, inVolo: 0, picco: 0, piccoDopo: 0, primo: 0, chat: 0,
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
        if (!g.primo) g.primo = Date.now();
        g.decisioni++;
        g.inVolo++; g.picco = Math.max(g.picco, g.inVolo);
        if (Date.now() - g.primo > 3000) g.piccoDopo = Math.max(g.piccoDopo, g.inVolo);
        try {
          await pausa(latenza);
          if (modo === 'raffica' && Date.now() - g.primo < 2000) return risposta(false, { error: { message: 'rate limited' } }, 429, {});
          if (modo === 'sempre429') return risposta(false, { error: { message: 'rate limited' } }, 429, {});
          const answers = {};
          for (const [nome, q] of Object.entries(body.questions || {})) {
            const t = String(q.instructions || '');
            const p = /crocetta/.test(t) ? 0.97 : /chiudere non risponde/.test(t) ? 0.88 : /bottone di chiusura/.test(t) ? 0.71 : 0.04;
            answers[nome] = { type: 'noul', noul: p };
          }
          return risposta(true, { model: body.model, answers, usage: { input_tokens: 300, output_tokens: 0, cost: 0.00002 } });
        } finally { g.inVolo--; }
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
  }, { supportDoc, modo, latenza });
}

async function cerca(page, testo, n) {
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), feedbacks(n));
  await page.click('#mgSearchToggle');
  await page.fill('#mgSearchInput', testo);
  await page.press('#mgSearchInput', 'Enter');
}

test('raffica di troppe richieste all\'avvio su 800 feedback: passata la raffica si torna a leggere in parallelo', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { manageSearchClassifier: 'typesafe/jev-1.13', manageSearch: 'vendor/testo' }, modo: 'raffica' });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  const t0 = Date.now();
  await cerca(page, 'la x per chiudere', 800);
  await expect(page.locator('#mgSearchProgress')).toBeHidden({ timeout: 90000 });
  const secondi = (Date.now() - t0) / 1000;
  const g = await app.evaluate(() => globalThis.__v1118g5);
  console.log(`raffica: ${secondi.toFixed(1)} s, picco ${g.picco}, picco dopo la raffica ${g.piccoDopo}, richieste ${g.decisioni}`);
  await expect(page.locator('.mg-item--result')).toHaveCount(3);
  expect(g.piccoDopo, 'dopo la raffica le richieste tornano a partire insieme').toBeGreaterThanOrEqual(6);
});

test('troppe richieste di continuo su 800 feedback: quanto si aspetta prima di vedere qualcosa', async ({ app, openTab }) => {
  test.setTimeout(400000);
  await preparaOwner(app, { supportDoc: { manageSearchClassifier: 'typesafe/jev-1.13', manageSearch: 'vendor/testo' }, modo: 'sempre429' });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  const t0 = Date.now();
  await cerca(page, 'la x per chiudere', 800);
  await expect(page.locator('.mg-item--result').first()).toBeVisible({ timeout: 360000 });
  const secondi = (Date.now() - t0) / 1000;
  console.log(`sempre429: primo risultato dopo ${secondi.toFixed(1)} s; messaggio: ${await page.locator('#mgSearchMsg').textContent()}`);
  expect(secondi).toBeLessThan(20);
});

test('posto del classificatore svuotato: la ricerca usa il modello e non parla del classificatore', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { manageSearchClassifier: '', manageSearch: 'vendor/testo' } });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await cerca(page, 'la x per chiudere', 40);
  await expect(page.locator('.mg-item--result')).toHaveCount(1, { timeout: 10000 });
  await expect(page.locator('#mgSearchMsg')).toHaveText('');
  const g = await app.evaluate(() => globalThis.__v1118g5);
  expect(g.decisioni).toBe(0);
  expect(g.chat).toBe(1);
});

test('aspetto nei due temi: barra di avanzamento e risultati', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { manageSearchClassifier: 'typesafe/jev-1.13' }, latenza: 1500 });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  for (const tema of ['light', 'dark']) {
    await page.evaluate(async (t) => {
      await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } });
    }, tema);
    await page.waitForTimeout(300);
    if (tema === 'light') await cerca(page, 'la x per chiudere', 400);
    else { await page.fill('#mgSearchInput', 'pulsante chiusura'); await page.press('#mgSearchInput', 'Enter'); }
    await expect(page.locator('.mg-item--result').first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `tests/.shots/v1118-g5-corsa-${tema}.png` });
    await expect(page.locator('#mgSearchProgress')).toBeHidden({ timeout: 30000 });
    await page.screenshot({ path: `tests/.shots/v1118-g5-fine-${tema}.png` });
  }
});
