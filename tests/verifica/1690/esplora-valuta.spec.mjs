// Esplorazione della verifica #1690 sul secondo clic di «Valuta» (#1449.3).

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

async function valuta(page, sel) {
  await page.locator(sel).click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Valuta')).toHaveCount(1, { timeout: 5000 });
  await menu.voce('Valuta').click();
}

const CASI = [
  ['#ta', 'in testa', 'Ciao. Ieri sono andato al mare.', 'Ciao. '],
  ['#ta', 'in fondo', 'Ieri sono andato al mare. PS a domani', ' PS a domani'],
  ['#ta', 'una riga intera', 'Prima riga.\nRiga di troppo.\nTerza riga.', 'Riga di troppo.\n'],
  ['#ta', 'tutto il testo', 'Testo da buttare', 'Testo da buttare'],
  ['#ce', 'una riga intera', null, 'Riga di troppo.'],
  ['#ce', 'la prima riga', null, 'Prima riga.'],
];

for (const [sel, nome, testo, prima] of CASI) {
  test(`${sel} ${nome}: il secondo clic rimette il pezzo tolto`, async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    await prepara(app, [{ prima, dopo: '', perche: 'di troppo' }]);
    const page = await testServer.openReady(openTab, PAGINA);
    if (testo !== null) await page.fill(sel, testo);
    const leggi = () => page.locator(sel).evaluate((el) => (el.tagName === 'TEXTAREA' ? el.value : el.innerText));
    const prima0 = await leggi();
    const html0 = await page.locator(sel).evaluate((el) => el.innerHTML);
    await valuta(page, sel);
    const A = await paginaDellAiuto(app, page);
    const bottone = A.locator('.sn-sidebar-correzione');
    await expect(bottone).toHaveCount(1, { timeout: 20_000 });
    await bottone.click();
    await expect(bottone).toHaveClass(/sn-sidebar-correzione-fatta/);
    const tolto = await leggi();
    console.log(sel, nome, 'tolto:', JSON.stringify(tolto));
    await bottone.click();
    await page.waitForTimeout(500);
    const dopo = await leggi();
    console.log(sel, nome, 'rimesso:', JSON.stringify(dopo), 'log:', await A.locator('.sn-sidebar-log-intera').allInnerTexts());
    if (sel === '#ce') console.log('html prima', html0, '\nhtml dopo', await page.locator(sel).evaluate((el) => el.innerHTML));
    expect(dopo).toBe(prima0);
  });
}
