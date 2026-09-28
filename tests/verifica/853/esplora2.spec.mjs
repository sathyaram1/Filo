import { test, expect } from '../../fixtures/electron.mjs';

const RISPOSTA = "Il **grassetto** resta. Vedi https://it.wikipedia.org/wiki/Valle_d'Aosta per la storia.";

async function preparaModello(app, t) {
  await app.evaluate(async (_e, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__origP = globalThis.__origP || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origP,
      complete: async () => ({ text: t, toolCalls: [], reasoningDetails: [], usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta(t); return { text: t, usage: {} }; },
    };
  }, t);
}

test('editor vero: testo scritto nel documento, selezione, tasto destro', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModello(app, RISPOSTA);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  const doc = page.locator('#doc');
  await doc.click();
  await page.keyboard.type('La fotosintesi clorofilliana trasforma la luce in zuccheri.');
  await page.waitForTimeout(300);
  await doc.dblclick();
  await page.evaluate(() => {
    const d = document.querySelector('#doc');
    const r = document.createRange(); r.selectNodeContents(d);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await doc.click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  const corpo = menu.locator('.sn-menu-inline-explain .sn-menu-inline-body');
  const c = await corpo.count();
  let html = '';
  if (c) { await expect(corpo).not.toHaveText(/Spiegazione…/, { timeout: 30_000 }); html = await corpo.innerHTML(); }
  console.log(JSON.stringify({ voci: await menu.locator('.sn-menu-item').allTextContents(), c, html }));
  await page.screenshot({ path: 'tests/.shots/853/editor-vero.png' });
});
