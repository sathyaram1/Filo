// Verifica #465 giro 4: il cammino dell'owner sul main vero (Firestore, catalogo e OpenRouter finti).
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
        g.modelli.push(body.model);
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
  models: { manage_search: 'vecchio', explain: 'vecchio' },
  modelRegistry: { vecchio: { provider: 'openrouter', model: 'vendor/vecchio' } },
};

const FBS = [
  { _id: 'fb-a', name: 'Pulsante X rotto', text: 'Il tasto di chiusura non fa nulla.', seq: 1, subSeq: 0, status: 'new', clientId: 't@example.com', createdAt: '2026-06-03T10:00:00Z', images: [] },
  { _id: 'fb-b', name: 'Schede con audio', text: 'Le schede che suonano non si vedono.', seq: 2, subSeq: 0, status: 'new', clientId: 't@example.com', createdAt: '2026-06-04T10:00:00Z', images: [] },
];

test('owner: registra un modello dal catalogo, lo sceglie per la ricerca, salva e la ricerca lo usa', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { judge1: 'flash' }, defaults: DEFAULTS });
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await page.locator('.mg-tab[data-tab="models"]').click();
  await expect(page.locator('#mgSmEditor')).toBeVisible({ timeout: 8000 });

  await page.click('#mgSmRegistryAdd');
  const riga = page.locator('#mgSmRegistryList .sn-model-row:not(.sn-model-row-head)').last();
  await riga.locator('.sn-model-nick').fill('cerca');
  const campo = riga.locator('.sn-model-id');
  await campo.click();
  await campo.pressSequentially('kimi');
  const tendina = riga.locator('.sn-select-pop');
  await expect(tendina).toBeVisible({ timeout: 8000 });
  await page.screenshot({ path: 'tests/.shots/465-g4-registro-chiaro.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'tests/.shots/465-g4-registro-scuro.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await campo.press('ArrowDown');
  await campo.press('Enter');
  await expect(campo).toHaveValue('moonshotai/kimi-k2.6');

  const slot = page.locator('.mg-sm-slot[data-slot="manageSearch"]');
  const input = slot.locator('.sn-chain-input').first();
  await expect(input).toHaveValue('vecchio');
  await input.click();
  await input.fill('');
  await input.pressSequentially('cer');
  const tendinaSlot = slot.locator('.sn-select-pop');
  await expect(tendinaSlot).toBeVisible();
  await slot.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/465-g4-slot-chiaro.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'tests/.shots/465-g4-slot-scuro.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  const proposti = await tendinaSlot.locator('.sn-select-option').evaluateAll((els) => els.map((e) => e.dataset.value));
  expect(proposti).toContain('cerca');
  await input.press('ArrowDown');
  await input.press('Enter');
  await input.press('Tab');
  await expect(input).toHaveValue('cerca');
  await page.click('#mgSmSaveBtn');
  await expect(page.locator('#mgSmStatus')).toHaveText('Salvato.', { timeout: 5000 });

  await page.locator('.mg-tab[data-tab="received"]').click().catch(() => {});
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), FBS);
  await page.click('#mgSearchToggle');
  await page.fill('#mgSearchInput', 'schede che suonano');
  await page.press('#mgSearchInput', 'Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__g465.modelli.slice()), { timeout: 10000 }).toContain('moonshotai/kimi-k2.6');
  const chiavi = await app.evaluate(() => globalThis.__g465.chiaviUsate.slice());
  console.log('chiavi usate', chiavi, 'msg', await page.locator('#mgSearchMsg').textContent());
  await page.screenshot({ path: 'tests/.shots/465-g4-ricerca.png' });
});

test('Modelli predefiniti e Opzioni non mostrano più la ricerca fra i feedback', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { judge1: 'flash' }, defaults: DEFAULTS });
  const ad = await openTab('filo://admin-defaults/admin-defaults.html');
  await ad.waitForLoadState('domcontentloaded');
  await ad.waitForTimeout(2500);
  const testoAd = await ad.evaluate(() => document.body.innerText);
  expect(testoAd).not.toMatch(/ricerca fra i feedback/i);
  await ad.screenshot({ path: 'tests/.shots/465-g4-admin-defaults.png', fullPage: true });
  const op = await openTab('filo://options/options.html');
  await op.waitForLoadState('domcontentloaded');
  await op.waitForTimeout(2000);
  const testoOp = await op.evaluate(() => document.body.innerText);
  expect(testoOp).not.toMatch(/ricerca fra i feedback/i);
});

test('stress: soli spazi e testo lunghissimo nel campo della ricerca', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { judge1: 'flash' }, defaults: DEFAULTS });
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await page.locator('.mg-tab[data-tab="models"]').click();
  await expect(page.locator('#mgSmEditor')).toBeVisible({ timeout: 8000 });
  const slot = page.locator('.mg-sm-slot[data-slot="manageSearch"]');
  const input = slot.locator('.sn-chain-input').first();
  await input.fill('<b>x</b>' + 'a'.repeat(400));
  await input.press('Tab');
  await slot.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/465-g4-lungo.png' });
  const title = await input.getAttribute('title');
  console.log('title lungo', title && title.slice(0, 200));
  await input.fill('   ');
  await input.press('Tab');
  await page.click('#mgSmSaveBtn');
  await expect(page.locator('#mgSmStatus')).not.toHaveText('', { timeout: 5000 });
  console.log('stato', await page.locator('#mgSmStatus').textContent());
  const doc = await app.evaluate(() => JSON.stringify(globalThis.__g465.docs['config/supportModels'].fields.manageSearch || null));
  console.log('doc manageSearch', doc);
});
