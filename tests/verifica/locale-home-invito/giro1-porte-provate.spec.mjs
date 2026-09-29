// Porte provate e chiuse nel giro 1 di home-invito: la home già aperta segue la chiave che arriva
// o se ne va, e un fornitore remoto «gemini» non spegne più le funzioni con chiave.
import { test, expect } from '../../fixtures/electron.mjs';
import { usaServerFinto, homePage, prepara, onboardingFatto, riscattaDaCrediti, testoHome } from './_crediti-finti.mjs';

const stato = usaServerFinto(test);
const INVITO = /codice d.invito|riscatta l.invito/i;
const FILO = { tab: { id: 8, url: 'filo://newtab/' }, url: 'filo://newtab/' };

async function homeSenzaChiave(app) {
  await onboardingFatto(app);
  const home = await homePage(app);
  await home.reload();
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 30_000 });
  return home;
}

test('già accolto: riscatto dalla pagina Crediti, e la home aperta si rifà col modello', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  await prepara(app, stato.base);
  const home = await homeSenzaChiave(app);
  await riscattaDaCrediti(openTab);
  await shell.locator('.tab').first().click();
  await expect(home.locator('#homeMessage')).toContainText('HOME-DAL-MODELLO', { timeout: 30_000 });
  expect(await testoHome(home)).not.toMatch(INVITO);
});

test('già accolto: invito dal collegamento filo://invito con la home aperta', async ({ app }) => {
  test.setTimeout(150_000);
  await prepara(app, stato.base);
  const home = await homeSenzaChiave(app);
  const out = await app.evaluate(async () => globalThis.SN_WALLET_MAIN.redeemFromInvite('ABCD-EFGH'));
  expect(out.ok).toBe(true);
  await expect(home.locator('#homeMessage')).toContainText('HOME-DAL-MODELLO', { timeout: 30_000 });
});

test('identità annullata e chiave propria tolta: la home aperta torna a chiedere l’invito', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await prepara(app, stato.base);
  const home = await homeSenzaChiave(app);
  await riscattaDaCrediti(openTab);
  await expect(home.locator('#homeMessage')).toContainText('HOME-DAL-MODELLO', { timeout: 30_000 });
  stato.redeemed = false;
  const cr = { tab: { id: 6, url: 'filo://credits/credits.html' }, url: 'filo://credits/credits.html' };
  await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'wallet_reset_identity' }, s), cr);
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 25_000 });
  await riscattaDaCrediti(openTab);
  await expect.poll(() => testoHome(home), { timeout: 25_000 }).not.toMatch(INVITO);

  const opt = { tab: { id: 5, url: 'filo://options/options.html' }, url: 'filo://options/options.html' };
  await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'wallet_reset_identity' }, s), cr);
  await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { apiKeys: { openrouter: 'sk-or-v1-mia' } } }, s), opt);
  await expect.poll(() => testoHome(home), { timeout: 25_000 }).not.toMatch(INVITO);
  await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { apiKeys: { openrouter: '' } } }, s), opt);
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 25_000 });
});

test('config remota rimasta su «gemini»: coi crediti la home si genera e l’intervista è pronta', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  stato.modelsDoc = {
    fields: {
      provider: { stringValue: 'gemini' },
      geminiDirect: { booleanValue: true },
      modelRegistry: { mapValue: { fields: { base: { mapValue: { fields: { provider: { stringValue: 'openrouter' }, model: { stringValue: 'test/base' } } } } } } },
      models: { mapValue: { fields: { filo_chat: { stringValue: 'base' }, filo_dashboard: { stringValue: 'base' }, filo_lesson: { stringValue: 'base' }, filo_compact: { stringValue: 'base' } } } },
    },
  };
  await prepara(app, stato.base);
  await app.evaluate(async () => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    await req('./services/defaultsStore').refresh();
  });
  const home = await homeSenzaChiave(app);
  await riscattaDaCrediti(openTab);
  await shell.locator('.tab').first().click();
  await expect(home.locator('#homeMessage')).toContainText('HOME-DAL-MODELLO', { timeout: 30_000 });
  const onb = await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'filo_get_onboarding', peek: true }, s), FILO);
  expect(onb.ready).toBe(true);

  // Chi sceglie i modelli da sé, con un fornitore «gemini» salvato da una versione vecchia.
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, provider: 'gemini', apiKeys: { openrouter: 'sk-or-v1-mia' }, models: { filo_chat: 'deepseek-flash', filo_dashboard: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry });
  });
  const onb2 = await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'filo_get_onboarding', peek: true }, s), FILO);
  expect(onb2.ready).toBe(true);
  const dash = await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'filo_generate_dashboard', force: true }, s), FILO);
  expect(String(dash.message || '')).toContain('HOME-DAL-MODELLO');
});
