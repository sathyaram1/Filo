// Verifica #1690, giro 2: in «Valuta» il secondo clic rimette il pezzo con gli apici curvi di chi scrive (r2) e col
// suo grassetto (r3), non con quello che ha scritto il modello.

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
      text: JSON.stringify({ text: 'Una parte è da cambiare.', correzioni, status: 'done' }),
    });
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, correzioni);
}

const pagina = (corpo) => `<!doctype html><meta charset="utf-8"><title>Messaggio</title>
<body style="margin:0;padding:20px;font:16px sans-serif">${corpo}</body>`;

async function applicaETogli(app, page, leggi) {
  const com0 = await leggi();
  await page.locator('#f').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Valuta')).toHaveCount(1, { timeout: 5000 });
  await menu.voce('Valuta').click();
  const A = await paginaDellAiuto(app, page);
  const b = A.locator('.sn-sidebar-correzione');
  await expect(b).toHaveCount(1, { timeout: 20_000 });
  await b.click();
  await expect(b).toHaveClass(/sn-sidebar-correzione-fatta/);
  return { com0, b };
}

test('r2 una correzione col modello che scrive l’apice dritto: applicata tiene quello curvo, e il secondo clic rimette il testo com’era', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, [{ prima: "l'albro", dopo: "l'albero", perche: 'refuso' }]);
  const page = await testServer.openReady(openTab, pagina('<textarea id="f" style="width:520px;height:90px;font:16px sans-serif">Ho visto l’albro alto.</textarea>'));
  const leggi = () => page.locator('#f').inputValue();
  const { com0, b } = await applicaETogli(app, page, leggi);
  await expect.poll(leggi).toBe('Ho visto l’albero alto.');
  await b.click();
  await expect.poll(leggi).toBe(com0);
});

test('r3 una parola in grassetto tolta da una correzione torna in grassetto col secondo clic', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, [{ prima: ' proprio', dopo: '', perche: 'di troppo' }]);
  const page = await testServer.openReady(openTab, pagina('<div id="f" contenteditable="true" style="width:520px;min-height:60px;border:1px solid #999"><div>Ciao a <b>proprio</b> tutti.</div></div>'));
  const leggi = () => page.locator('#f').innerHTML();
  const { b } = await applicaETogli(app, page, leggi);
  await expect(page.locator('#f')).toHaveText(/^Ciao a\s+tutti\.$/);
  await b.click();
  await expect(page.locator('#f')).toHaveText('Ciao a proprio tutti.');
  await expect(page.locator('#f b')).toHaveText('proprio');
});
