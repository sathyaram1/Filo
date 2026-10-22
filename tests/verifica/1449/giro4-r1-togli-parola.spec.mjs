// Verifica #1449 giro 4, rilievo 1: una correzione che toglie un pezzo si scrive col primo clic e col secondo deve
// tornare com'era, come ogni altra correzione proposta da «Valuta».

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

test('r1 la correzione che toglie una parola si annulla col secondo clic', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: false, spellcheckContext: false },
    });
    const finto = async ({ attempts }) => ({
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
      text: JSON.stringify({ text: 'Una parola di troppo.', correzioni: [{ prima: ' molto', dopo: '', perche: 'superfluo' }], status: 'done' }),
    });
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="padding:20px">
    <textarea id="ta" style="width:500px;height:80px">Era molto bello.</textarea></body>`);
  await page.locator('#ta').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Valuta')).toHaveCount(1, { timeout: 5000 });
  await menu.voce('Valuta').click();
  const correzione = page.locator('.sn-sidebar-correzione');
  await expect(correzione).toHaveCount(1, { timeout: 20_000 });
  await correzione.click();
  await expect(page.locator('#ta')).toHaveValue('Era bello.');
  await correzione.click();
  await expect(page.locator('#ta')).toHaveValue('Era molto bello.');
  await expect(correzione).not.toHaveClass(/sn-sidebar-correzione-fatta/);
});
