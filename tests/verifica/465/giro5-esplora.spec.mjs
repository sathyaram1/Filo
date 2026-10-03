// Verifica #465 giro 5: esplorazione sul main vero (owner, Firestore e OpenRouter finti).
import { test, expect } from '../../fixtures/electron.mjs';

const CATALOGO = [
  { id: 'moonshotai/kimi-k2.6', name: 'Kimi', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, created: 3 },
  { id: 'deepseek/deepseek-v4-flash', name: 'DS', architecture: { input_modalities: ['text'], output_modalities: ['text'] }, created: 2 },
];

async function preparaOwner(app, { supportDoc, defaults }) {
  await app.evaluate(async (electron, { supportDoc, defaults, catalogo }) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
    const auth = req(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    const toFs = (v) => {
      if (typeof v === 'string') return { stringValue: v };
      if (typeof v === 'boolean') return { booleanValue: v };
      const fields = {}; for (const [k, x] of Object.entries(v)) fields[k] = toFs(x);
      return { mapValue: { fields } };
    };
    const g = globalThis.__g465 = {
      docs: {
        'config/models': { fields: toFs(defaults).mapValue.fields },
        'config/supportModels': { fields: toFs(supportDoc).mapValue.fields },
        'config/judgeSecrets': { fields: { openrouterKey: { stringValue: 'sk-giudici' } } },
      },
      modelli: [], patch: [],
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
          g.patch.push({ doc: m[1], body });
          const cur = g.docs[m[1]] || { fields: {} };
          for (const k of new URL(u).searchParams.getAll('updateMask.fieldPaths')) cur.fields[k] = body.fields[k];
          g.docs[m[1]] = cur;
          return risposta(true, cur);
        }
        return g.docs[m[1]] ? risposta(true, g.docs[m[1]]) : risposta(false, {}, 404);
      }
      if (u.includes('openrouter.ai/api/v1/models')) {
        return risposta(true, { data: u.includes('output_modalities') ? [] : catalogo });
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
  }, { supportDoc, defaults, catalogo: CATALOGO });
}

const DEFAULTS = {
  provider: 'openrouter',
  models: { manage_search: 'vecchio', explain: 'vecchio' },
  modelRegistry: { vecchio: { provider: 'openrouter', model: 'vendor/vecchio' } },
};

test('Gestione Modelli, catalogo vero dal main: giudice, ricerca e registro propongono mentre scrivi', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { judge1: 'flash' }, defaults: DEFAULTS });
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await page.locator('.mg-tab[data-tab="models"]').click();
  await expect(page.locator('#mgSmEditor')).toBeVisible({ timeout: 8000 });

  await page.click('#mgSmRegistryAdd');
  const riga = page.locator('#mgSmRegistryList .sn-model-row:not(.sn-model-row-head)').last();
  await riga.locator('.sn-model-nick').fill('<b>grassetto</b>');
  const campo = riga.locator('.sn-model-id');
  await campo.click();
  await campo.pressSequentially('kimi');
  const tendina = riga.locator('.sn-select-pop');
  await expect(tendina).toBeVisible();
  const opz = await tendina.locator('.sn-select-option').evaluateAll((els) => els.map((e) => e.dataset.value));
  console.log('REGISTRO opzioni', JSON.stringify(opz));
  await tendina.locator('.sn-select-option').first().dispatchEvent('mousedown');
  await expect(campo).toHaveValue('moonshotai/kimi-k2.6');

  // Il giudice 1 propone il nickname appena scritto, come testo.
  const g1 = page.locator('.mg-sm-slot[data-slot="judge1"] .sn-chain-input').first();
  await g1.fill('');
  await g1.pressSequentially('<');
  const pop1 = page.locator('.mg-sm-slot[data-slot="judge1"] .sn-select-pop');
  await expect(pop1).toBeVisible();
  const html1 = await pop1.innerHTML();
  console.log('GIUDICE pop', html1.slice(0, 400));
  expect(await pop1.locator('b').count()).toBe(0);
  await page.screenshot({ path: 'tests/.shots/465-g5-giudice-chiaro.png' });

  const ric = page.locator('.mg-sm-slot[data-slot="manageSearch"] .sn-chain-input').first();
  await expect(ric).toHaveValue('vecchio');
  await ric.fill('');
  await ric.pressSequentially('v');
  const popR = page.locator('.mg-sm-slot[data-slot="manageSearch"] .sn-select-pop');
  await expect(popR).toBeVisible();
  console.log('RICERCA opzioni', JSON.stringify(await popR.locator('.sn-select-option').evaluateAll((els) => els.map((e) => e.dataset.value))));
  await page.screenshot({ path: 'tests/.shots/465-g5-ricerca-chiaro.png' });

  await page.emulateMedia({ colorScheme: 'dark' });
  await app.evaluate(async () => { await globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { theme: 'dark' } }, { url: 'filo://options/options.html' }); });
  await page.waitForTimeout(500);
  await ric.fill('');
  await ric.pressSequentially('v');
  await expect(popR).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/465-g5-ricerca-scuro.png' });
  await campo.click();
  await campo.fill('');
  await campo.pressSequentially('deep');
  await expect(tendina).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/465-g5-registro-scuro.png' });
});

test('Modelli predefiniti e Opzioni non mostrano più la ricerca fra i feedback', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { judge1: 'flash' }, defaults: DEFAULTS });
  const ad = await openTab('filo://admin-defaults/admin-defaults.html');
  await ad.waitForLoadState('domcontentloaded');
  await ad.waitForTimeout(2500);
  const testoAd = await ad.evaluate(() => document.body.innerText);
  console.log('ADMIN contiene ricerca:', testoAd.includes('ricerca fra i feedback'), testoAd.includes('Ricerca fra i feedback'));
  await ad.screenshot({ path: 'tests/.shots/465-g5-admin.png' });
  const op = await openTab('filo://options/options.html');
  await op.waitForLoadState('domcontentloaded');
  await op.waitForTimeout(2000);
  const testoOp = await op.evaluate(() => document.body.innerText);
  console.log('OPZIONI contiene ricerca:', testoOp.includes('ricerca fra i feedback'), testoOp.includes('Ricerca fra i feedback'));
  const idx = testoOp.toLowerCase().indexOf('ricerca fra i feedback');
  if (idx >= 0) console.log('OPZIONI contesto:', testoOp.slice(Math.max(0, idx - 200), idx + 200));
});

test('ricerca vera dalla barra di Gestione col modello impostato in Gestione', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { judge1: 'flash', manageSearch: 'cerca', judgeRegistry: { cerca: { provider: 'openrouter', model: 'vendor/cerca' } } }, defaults: DEFAULTS });
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await page.evaluate(() => window.__mgTest.setData([
    { _id: 'fb-a', name: 'Pulsante X rotto', text: 'Il tasto di chiusura non fa nulla.', seq: 1, subSeq: 0, status: 'new', clientId: 't@example.com', createdAt: '2026-06-03T10:00:00Z', images: [] },
  ]));
  await page.click('#mgSearchToggle');
  await page.fill('#mgSearchInput', 'tasto chiusura');
  await page.press('#mgSearchInput', 'Enter');
  await page.waitForTimeout(3000);
  const msg = await page.locator('#mgSearchMsg').innerText().catch(() => '');
  const modelli = await app.evaluate(() => globalThis.__g465.modelli);
  console.log('RICERCA msg:', msg, 'modelli:', JSON.stringify(modelli));
  expect(modelli).toContain('vendor/cerca');
});
