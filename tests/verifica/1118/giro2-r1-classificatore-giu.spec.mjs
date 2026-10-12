// Verifica #1118 giro 2, rilievo 1: col classificatore che risponde con un guasto del server (o non raggiungibile),
// la ricerca resta su «Letti 0 di N» per secondi prima di mostrare i risultati del modello della ricerca.
import { test, expect } from '../../fixtures/electron.mjs';

const FBS = [
  { _id: 'fb-a', name: 'Pulsante X rotto', text: 'Il tasto di chiusura non fa nulla.', seq: 1, subSeq: 0, status: 'new', clientId: 't@example.com', createdAt: '2026-06-03T10:00:00Z', images: [] },
  { _id: 'fb-b', name: 'Schede con audio', text: 'Le schede che suonano non si vedono.', seq: 2, subSeq: 0, status: 'new', clientId: 't@example.com', createdAt: '2026-06-04T10:00:00Z', images: [] },
];

for (const guasto of ['503', 'rete']) {
  test(`r1 classificatore giù (${guasto}): i risultati del modello arrivano in pochi secondi`, async ({ app, openTab }) => {
    await app.evaluate(async (electron, guasto) => {
      const { createRequire } = process.getBuiltinModule('module');
      const path = process.getBuiltinModule('path');
      const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
      const auth = req(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
      const docs = {
        'config/supportModels': { fields: { manageSearchClassifier: { stringValue: 'typesafe/jev-1.13' }, manageSearch: { stringValue: 'vendor/testo' } } },
        'config/judgeSecrets': { fields: { openrouterKey: { stringValue: 'sk-giudici' } } },
      };
      auth.getIdToken = async () => 'finto';
      auth.isAdmin = () => true;
      auth.isSignedIn = () => true;
      auth.getProfile = () => ({ email: 'owner@example.com', name: 'Owner' });
      const risposta = (ok, corpo, status) => ({ ok, status: status || (ok ? 200 : 404), headers: new Map(), clone() { return this; }, async json() { return corpo; }, async text() { return JSON.stringify(corpo); } });
      globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        const m = u.match(/documents\/(config\/[A-Za-z]+)/);
        if (m) return docs[m[1]] ? risposta(true, docs[m[1]]) : risposta(false, {}, 404);
        if (u.includes('/endpoints')) return risposta(true, { data: { endpoints: [{ provider_name: 'TypeSafe', tag: 'typesafe' }] } });
        if (u.includes('openrouter.ai/api/alpha/decisions')) {
          if (guasto === 'rete') throw new TypeError('fetch failed');
          return risposta(false, { error: { message: 'upstream error' } }, 503);
        }
        if (u.includes('openrouter.ai/api/v1/chat/completions')) {
          const body = JSON.parse(init.body || '{}');
          const content = JSON.stringify([{ id: 'fb-a', reason: 'dal modello' }]);
          return risposta(true, { id: 'x', model: body.model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
        }
        return risposta(false, {}, 503);
      };
      req(path.join(electron.app.getAppPath(), 'src/main/services/supportModelsStore.js')).invalidaCache();
      await globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { apiKeys: { openrouter: 'sk-owner' } } }, { url: 'filo://options/options.html' });
    }, guasto);
    const page = await openTab('filo://manage/manage.html');
    await page.waitForFunction(() => window.filo && window.__mgTest);
    await page.evaluate((fbs) => window.__mgTest.setData(fbs), FBS);
    await page.click('#mgSearchToggle');
    await page.fill('#mgSearchInput', 'tasto chiusura');
    const t0 = Date.now();
    await page.press('#mgSearchInput', 'Enter');
    await expect(page.locator('.mg-item--result')).toHaveCount(1, { timeout: 30000 });
    const secondi = (Date.now() - t0) / 1000;
    await expect(page.locator('#mgSearchMsg')).toContainText('Classificatore:');
    expect(secondi, `risultati dopo ${secondi.toFixed(1)} s`).toBeLessThan(4);
  });
}
