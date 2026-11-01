// Verifica #1690, giro 1, rilievo 1: in «Valuta» il secondo clic rimette anche un pezzo che era da solo sulla sua riga
// di un editor ricco, o che era tutto il testo del campo (#1449.3).

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

async function prepara(app, correzioni) {
  await app.evaluate(async (_e, correzioni) => {
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
      text: JSON.stringify({ text: 'Una parte è di troppo.', correzioni, status: 'done' }),
    });
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, correzioni);
}

const PAGINA = `<!doctype html><meta charset="utf-8"><title>Messaggio</title>
<body style="margin:0;padding:20px;font:16px sans-serif">
  <textarea id="ta" style="display:block;width:520px;height:90px;font:16px sans-serif"></textarea>
  <div id="ce" contenteditable="true" style="width:520px;min-height:60px;border:1px solid #999;margin-top:12px"><div>Prima riga.</div><div>Riga di troppo.</div><div>Terza riga.</div></div>
</body>`;

const CASI = [
  ['#ce', 'una riga intera di un editor ricco', null, 'Riga di troppo.'],
  ['#ce', 'la prima riga di un editor ricco', null, 'Prima riga.'],
  ['#ta', 'tutto il testo del campo', 'Testo da buttare', 'Testo da buttare'],
];

for (const [sel, nome, testo, prima] of CASI) {
  test(`r1 ${nome}: il secondo clic rimette il pezzo tolto`, async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    await prepara(app, [{ prima, dopo: '', perche: 'di troppo' }]);
    const page = await testServer.openReady(openTab, PAGINA);
    if (testo !== null) await page.fill(sel, testo);
    const leggi = () => page.locator(sel).evaluate((el) => (el.tagName === 'TEXTAREA' ? el.value : el.innerText));
    const com0 = await leggi();
    await page.locator(sel).click({ button: 'right' });
    const menu = menuDi(page);
    await expect(menu.voce('Valuta')).toHaveCount(1, { timeout: 5000 });
    await menu.voce('Valuta').click();
    const A = await paginaDellAiuto(app, page);
    const bottone = A.locator('.sn-sidebar-correzione');
    await expect(bottone).toHaveCount(1, { timeout: 20_000 });
    await bottone.click();
    await expect(bottone).toHaveClass(/sn-sidebar-correzione-fatta/);
    expect(await leggi()).not.toContain(prima);
    await bottone.click();
    await expect.poll(leggi, { timeout: 5000 }).toBe(com0);
    await expect(bottone).not.toHaveClass(/sn-sidebar-correzione-fatta/);
    await expect(A.locator('.sn-sidebar-log-intera')).toHaveCount(0);
  });
}
