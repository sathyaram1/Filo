// Verifica #1449 giro 1, rilievo 1: in un editor che il sito mette in un riquadro suo (gli editor classici dei CMS e dei
// forum), il tasto destro sul campo scritto non offre «Valuta».
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

test('r1 in un editor dentro un riquadro dello stesso sito «Valuta» c’è e apre l’Aiuto col testo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: false, spellcheckContext: false },
    });
    const finto = async ({ attempts }) => ({ model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: JSON.stringify({ text: 'Ok.', status: 'done' }) });
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const page = await testServer.openReady(openTab,
    '<!doctype html><meta charset="utf-8"><body><iframe id="ed" width="600" height="200" srcdoc="<textarea id=ta style=width:500px;height:80px>Testo da valutare con un erore.</textarea>"></iframe></body>');
  const fr = page.frameLocator('#ed');
  await fr.locator('#ta').click({ button: 'right' });
  const menu = menuDi(fr);
  await expect(menu.pannelli.first()).toBeVisible({ timeout: 5000 });
  await expect(menu.voce('Valuta')).toHaveCount(1);
  await menu.voce('Valuta').click();
  await expect(page.locator('.sn-sidebar-msg-user')).toContainText('Testo da valutare con un erore.', { timeout: 8000 });
});
