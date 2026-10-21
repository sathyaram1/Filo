// Verifica #1449 giro 1: «Valuta» con una ricerca web in mezzo, e in un editor dentro un riquadro dello stesso sito.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

async function prepara(app, risposte) {
  await app.evaluate(async (_e, risposte) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: false, spellcheckContext: false },
    });
    globalThis.__chiamate = [];
    globalThis.SN_WEB_SEARCH.search = async () => ({ provider: 'finto', results: [{ title: 'Everest', url: 'https://example.com/e', content: 'Everest 8849 m' }] });
    let n = 0;
    const finto = async ({ attempts, messages }) => {
      globalThis.__chiamate.push({ model: attempts[0].model, messages: JSON.parse(JSON.stringify(messages)) });
      const text = risposte[Math.min(n, risposte.length - 1)];
      n += 1;
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, risposte);
}

test('un fatto dubbio controllato sul web: il parere arriva col modello della chat e la correzione si scrive', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, [
    JSON.stringify({ action: 'web_search', query: 'altezza Everest' }),
    JSON.stringify({ text: 'L\'altezza è sbagliata.', correzioni: [{ prima: '9000 metri', dopo: '8849 metri', perche: 'misura ufficiale' }], status: 'done' }),
  ]);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><body><textarea id="ta" style="width:500px;height:80px"></textarea></body>');
  await page.fill('#ta', 'L\'Everest è alto 9000 metri.');
  await page.locator('#ta').click({ button: 'right' });
  await menuDi(page).voce('Valuta').click();
  await expect(page.locator('.sn-sidebar-log', { hasText: 'ricerca web' })).toBeVisible({ timeout: 20_000 });
  const c = page.locator('.sn-sidebar-correzione');
  await expect(c).toHaveCount(1, { timeout: 20_000 });
  const ch = await app.evaluate(() => globalThis.__chiamate);
  expect(ch.map((x) => x.model)).toEqual(['deepseek/deepseek-v4-pro', 'deepseek/deepseek-v4-pro']);
  await c.click();
  await expect(page.locator('#ta')).toHaveValue('L\'Everest è alto 8849 metri.');
});

test('in un editor dentro un riquadro dello stesso sito «Valuta» c’è', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await prepara(app, [JSON.stringify({ text: 'Ok.', status: 'done' })]);
  const page = await testServer.openReady(openTab,
    '<!doctype html><meta charset="utf-8"><body><iframe id="ed" width="600" height="200" srcdoc="<textarea id=ta style=width:500px;height:80px>Testo da valutare con un erore.</textarea>"></iframe></body>');
  const fr = page.frameLocator('#ed');
  await fr.locator('#ta').click({ button: 'right' });
  const menu = menuDi(fr);
  await expect(menu.pannelli.first()).toBeVisible({ timeout: 5000 });
  await expect(menu.voce('Valuta')).toHaveCount(1);
});
