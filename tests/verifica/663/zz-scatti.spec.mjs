import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
const OUT = 'tests/.shots/663';
mkdirSync(OUT, { recursive: true });

async function configCondivisa(app, patch) {
  await app.evaluate(async (_e, cfg) => {
    const D = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || D.get;
    globalThis.__filoDefaultsOrigGet = orig;
    D.get = () => ({ ...orig(), ...cfg });
  }, patch);
}
async function impostazioni(app, p) { await app.evaluate(async (_e, x) => { await globalThis.SN_STORAGE.updateSettings(x); }, p); }
async function accoglienzaGiaFatta(app) {
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY; const O = globalThis.SN_ONBOARDING;
    await M.setOnboarding(O.close(O.emptyState(), new Date().toISOString()));
  });
}
async function newtab(app) {
  const fine = Date.now() + 10_000;
  while (Date.now() < fine) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}
async function scena(app, nome, tema) {
  const page = await newtab(app);
  await impostazioni(app, { theme: tema });
  await accoglienzaGiaFatta(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
  await page.waitForTimeout(2500);
  console.log(`[SCATTO ${nome}/${tema}]`, JSON.stringify(await page.locator('#homeMessage').textContent()));
  await page.screenshot({ path: `${OUT}/fix-${nome}-${tema}.png` });
}

test('scatti dopo la correzione: nessuna chiave', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configCondivisa(app, { provider: 'gemini', apiKeys: {} });
  await impostazioni(app, { apiKeys: { openrouter: '' } });
  await scena(app, 'senza-chiave', 'light');
  await scena(app, 'senza-chiave', 'dark');
});

test('scatti dopo la correzione: pesi aperti, con la chat', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const a = await app.evaluate(() => { const A = globalThis.SN_CONST.ACTIONS; return { chat: A.FILO_CHAT, home: A.FILO_DASHBOARD }; });
  await configCondivisa(app, {
    provider: 'openrouter',
    models: { [a.chat]: 'chiuso', [a.home]: 'chiuso' },
    modelRegistry: { chiuso: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' } },
  });
  await impostazioni(app, { apiKeys: { openrouter: 'sk-or-vera' }, openWeightsOnly: true });
  await scena(app, 'pesi-aperti', 'light');
  const page = await newtab(app);
  await page.fill('#input', 'ciao');
  await page.press('#input', 'Enter');
  await page.waitForTimeout(5000);
  console.log('[SCATTO chat]', JSON.stringify(await page.locator('.dash-bubble-filo').last().textContent()));
  await page.screenshot({ path: `${OUT}/fix-chat-pesi-aperti.png` });
});
