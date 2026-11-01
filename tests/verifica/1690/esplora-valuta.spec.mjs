// Esplorazione del giro 2 su #1449.3: pezzi tolti in altri punti e forme.

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

const pagina = (corpo) => `<!doctype html><meta charset="utf-8"><title>Messaggio</title>
<body style="margin:0;padding:20px;font:16px sans-serif">${corpo}</body>`;
const TA = (t) => `<textarea id="f" style="display:block;width:520px;height:90px;font:16px sans-serif">${t}</textarea>`;
const CE = (h) => `<div id="f" contenteditable="true" style="width:520px;min-height:60px;border:1px solid #999">${h}</div>`;

const CASI = [
  ['ta doppione', TA('Era molto molto bello, davvero.'), [{ prima: 'molto ', dopo: '' }]],
  ['ta in testa', TA('Allora, ieri sono andato al mare.'), [{ prima: 'Allora, ', dopo: '' }]],
  ['ta in coda', TA('Ieri sono andato al mare, insomma.'), [{ prima: ', insomma', dopo: '' }]],
  ['ce grassetto', CE('<div>Ciao a <b>proprio</b> tutti.</div>'), [{ prima: ' proprio', dopo: '' }]],
  ['ce una riga tutto', CE('Testo da buttare via'), [{ prima: 'Testo da buttare via', dopo: '' }]],
  ['ce br', CE('Prima riga.<br>Riga di troppo.<br>Terza riga.'), [{ prima: 'Riga di troppo.', dopo: '' }]],
  ['ce p', CE('<p>Prima riga.</p><p>Riga di troppo.</p><p>Terza riga.</p>'), [{ prima: 'Riga di troppo.', dopo: '' }]],
  ['ce ultima', CE('<div>Prima riga.</div><div>Ultima di troppo.</div>'), [{ prima: 'Ultima di troppo.', dopo: '' }]],
  ['ta due correzioni', TA('Ieri sono proprio andato al mare con un amica.'), [{ prima: ' proprio', dopo: '' }, { prima: 'un amica', dopo: "un'amica" }]],
  ['ta riga intera', TA('Prima riga.\nRiga di troppo.\nTerza riga.'), [{ prima: 'Riga di troppo.', dopo: '' }]],
];

for (const [nome, corpo, correzioni] of CASI) {
  test(`esplora ${nome}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    await prepara(app, correzioni.map((c) => ({ ...c, perche: 'di troppo' })));
    const page = await testServer.openReady(openTab, pagina(corpo));
    const leggi = () => page.locator('#f').evaluate((el) => (el.tagName === 'TEXTAREA' ? el.value : el.innerHTML));
    const com0 = await leggi();
    await page.locator('#f').click({ button: 'right' });
    const menu = menuDi(page);
    await expect(menu.voce('Valuta')).toHaveCount(1, { timeout: 5000 });
    await menu.voce('Valuta').click();
    const A = await paginaDellAiuto(app, page);
    const bottoni = A.locator('.sn-sidebar-correzione');
    await expect(bottoni).toHaveCount(correzioni.length, { timeout: 20_000 });
    for (let i = 0; i < correzioni.length; i++) await bottoni.nth(i).click();
    const dopo1 = await leggi();
    await bottoni.nth(0).click();
    await page.waitForTimeout(500);
    const dopo2 = await leggi();
    const log = await A.locator('.sn-sidebar-log-intera').allInnerTexts();
    console.log(`${nome}\n  prima: ${JSON.stringify(com0)}\n  tolto: ${JSON.stringify(dopo1)}\n  rimesso: ${JSON.stringify(dopo2)}\n  avviso: ${JSON.stringify(log)}`);
    if (correzioni.length === 1) expect(dopo2).toBe(com0);
  });
}
