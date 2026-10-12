// Sonde del verificatore #1193: tastiera, salvataggio rifiutato, lettura lenta, scelte su tendine diverse.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function server(app, { routines = {}, getRitardo = 0, patchStatus = 200 } = {}) {
  await app.evaluate(async (electron, cfg) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
    const auth = req(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    auth.getIdToken = async () => 'finto';
    auth.isAdmin = () => true;
    auth.isSignedIn = () => true;
    auth.getProfile = () => ({ email: 'owner@example.com', name: 'Owner' });
    const toFs = (v) => {
      if (typeof v === 'string') return { stringValue: v };
      if (typeof v === 'boolean') return { booleanValue: v };
      if (typeof v === 'number') return { integerValue: String(v) };
      const fields = {};
      for (const [k, x] of Object.entries(v)) fields[k] = toFs(x);
      return { mapValue: { fields } };
    };
    const g = globalThis.__v1193 = { doc: { fields: toFs(cfg.routines).mapValue.fields }, patch: [], getRitardo: cfg.getRitardo, patchStatus: cfg.patchStatus, patchRitardi: [] };
    const risposta = (ok, corpo, status) => ({ ok, status, headers: new Map(), async json() { return corpo; }, async text() { return JSON.stringify(corpo); } });
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (!/documents\/config\/routines\?/.test(u)) return risposta(false, {}, 503);
      if ((init.method || 'GET') !== 'PATCH') {
        await new Promise((r) => setTimeout(r, g.getRitardo));
        return risposta(true, JSON.parse(JSON.stringify(g.doc)), 200);
      }
      const mask = new URL(u).searchParams.getAll('updateMask.fieldPaths');
      g.patch.push({ mask, body: JSON.parse(init.body) });
      await new Promise((r) => setTimeout(r, g.patchRitardi.shift() || 0));
      if (g.patchStatus !== 200) return risposta(false, { error: { message: 'PERMISSION_DENIED' } }, g.patchStatus);
      // Solo per le sonde: applica foglie semplici ruolo.campo (trattino tolto dagli apici).
      for (const m of mask) {
        const [, ruolo, campo] = m.split('.').map((s) => s.replace(/`/g, ''));
        const body = JSON.parse(init.body).fields || {};
        const v = body.roleModels?.mapValue?.fields?.[ruolo]?.mapValue?.fields?.[campo];
        g.doc.fields.roleModels = g.doc.fields.roleModels || { mapValue: { fields: {} } };
        const rm = g.doc.fields.roleModels.mapValue.fields;
        rm[ruolo] = rm[ruolo] || { mapValue: { fields: {} } };
        if (v) rm[ruolo].mapValue.fields[campo] = v; else delete rm[ruolo].mapValue.fields[campo];
      }
      return risposta(true, JSON.parse(JSON.stringify(g.doc)), 200);
    };
  }, { routines, getRitardo, patchStatus });
}

const tendina = (page, ruolo, campo) => page.locator('.sn-select-wrap', { has: page.locator(`select[data-ruolo="${ruolo}"][data-campo="${campo}"]`) });

async function apri(openTab) {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.SN_ROUTINE_MODELLI);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="automation"]').click();
  return page;
}

test('tastiera: una scelta fatta coi tasti si salva come col mouse', async ({ app, openTab }) => {
  await server(app);
  const page = await apri(openTab);
  const t = tendina(page, 'verifier', 'effort');
  await t.locator('.sn-select-button').focus();
  await page.keyboard.press('Enter');
  await expect(t.locator('.sn-select-pop')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#mgRoleModelsMsg')).toHaveText('Verifica: salvato.');
  const p = await app.evaluate(() => globalThis.__v1193.patch);
  expect(p.length).toBe(1);
  expect(p[0].mask).toEqual(['roleModels.verifier.effort']);
});

test('salvataggio rifiutato: la tendina torna al valore di prima e la pagina lo dice', async ({ app, openTab }) => {
  await server(app, { routines: { roleModels: { fixer: { model: 'opus' } } }, patchStatus: 403 });
  const page = await apri(openTab);
  const t = tendina(page, 'fixer', 'model');
  await expect(t.locator('.sn-select-value')).toHaveText('Opus');
  await t.locator('.sn-select-button').click();
  await t.locator('.sn-select-option', { hasText: 'Haiku' }).click();
  await expect(page.locator('#mgRoleModelsMsg')).toContainText('salvataggio fallito');
  await expect(t.locator('.sn-select-value')).toHaveText('Opus');
  await expect(page.locator('select[data-ruolo="fixer"][data-campo="model"]')).toHaveValue('opus');
});

test('lettura lenta: prima della risposta nessuna tendina finge «definizione dell\'agente»', async ({ app, openTab }) => {
  await server(app, { routines: { roleModels: { secaudit: { model: 'sonnet' } } }, getRitardo: 4000 });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.SN_ROUTINE_MODELLI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.waitForTimeout(800);
  const prima = await tendina(page, 'secaudit', 'model').locator('.sn-select-value').textContent();
  await page.locator('#mgRoleModelsBlock').screenshot({ path: 'tests/.shots/1193-v-lettura-lenta.png' });
  await expect(tendina(page, 'secaudit', 'model').locator('.sn-select-value')).toHaveText('Sonnet', { timeout: 10000 });
  expect(prima).not.toBe('Definizione dell\'agente');
});

test('due tendine diverse in fretta: tutte e due sul server e sullo schermo', async ({ app, openTab }) => {
  await server(app);
  const page = await apri(openTab);
  await app.evaluate(() => { globalThis.__v1193.patchRitardi = [800, 0, 0]; });
  for (const [r, c, v] of [['new-work', 'model', 'Haiku'], ['prober', 'effort', 'low'], ['new-work', 'effort', 'xhigh']]) {
    const t = tendina(page, r, c);
    await t.locator('.sn-select-button').click();
    await t.locator('.sn-select-option', { hasText: v }).click();
  }
  await expect(page.locator('#mgRoleModelsMsg')).toHaveText('Primo lavoro: salvato.');
  await expect(tendina(page, 'new-work', 'model').locator('.sn-select-value')).toHaveText('Haiku');
  await expect(tendina(page, 'prober', 'effort').locator('.sn-select-value')).toHaveText('low');
  await expect(tendina(page, 'new-work', 'effort').locator('.sn-select-value')).toHaveText('xhigh');
  const masks = (await app.evaluate(() => globalThis.__v1193.patch)).map((p) => p.mask[0]);
  expect(masks).toEqual(['roleModels.`new-work`.model', 'roleModels.prober.effort', 'roleModels.`new-work`.effort']);
});
